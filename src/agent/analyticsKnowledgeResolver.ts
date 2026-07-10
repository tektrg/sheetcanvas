import { BUILT_IN_ANALYTICS_KNOWLEDGE_PACKS } from './builtInAnalyticsKnowledge';
import type {
  AgentAnalyticsKnowledgeContext,
  AnalyticsKnowledgeLayer,
  AnalyticsKnowledgePack,
  AnalyticsKnowledgeResolutionAudit,
  AnalyticsKnowledgeResolutionInput,
  AnalyticsKnowledgeRule,
  AnalyticsKnowledgeRuleSource,
  AnalyticsKnowledgeTrigger,
  ResolvedAnalyticsKnowledgeContext,
  ResolvedAnalyticsKnowledgeRule,
  UserKnowledgeOverlay,
} from './analyticsKnowledgeTypes';

const LAYER_ORDER: Record<AnalyticsKnowledgeLayer, number> = {
  platform: 10,
  'general-analysis': 20,
  'user-context': 30,
};

function normalizeValues(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function triggerMatches(
  trigger: AnalyticsKnowledgeTrigger | undefined,
  input: Required<Pick<AnalyticsKnowledgeResolutionInput, 'connectors' | 'domains' | 'jobs' | 'tasks'>>,
): boolean {
  if (!trigger || trigger.always) return true;

  const triggerConnectors = normalizeValues(trigger.connectors);
  const triggerDomains = normalizeValues(trigger.domains);
  const triggerJobs = normalizeValues(trigger.jobs);
  const triggerTasks = normalizeValues(trigger.tasks);

  if (triggerConnectors.size > 0 && !input.connectors.some((value) => triggerConnectors.has(value))) {
    return false;
  }
  if (triggerDomains.size > 0 && !input.domains.some((value) => triggerDomains.has(value))) {
    return false;
  }
  if (triggerJobs.size > 0 && !input.jobs.some((value) => triggerJobs.has(value))) {
    return false;
  }
  if (triggerTasks.size > 0 && !input.tasks.some((value) => triggerTasks.has(value))) {
    return false;
  }

  return triggerConnectors.size + triggerDomains.size + triggerJobs.size + triggerTasks.size > 0;
}

function ruleSort(a: AnalyticsKnowledgeRule, b: AnalyticsKnowledgeRule): number {
  return LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || b.priority - a.priority || a.id.localeCompare(b.id);
}

function toResolvedRule(rule: AnalyticsKnowledgeRule, fallbackSource: AnalyticsKnowledgeRuleSource): ResolvedAnalyticsKnowledgeRule {
  return {
    id: rule.id,
    layer: rule.layer,
    type: rule.type,
    title: rule.title,
    priority: rule.priority,
    version: rule.version,
    body: rule.body,
    source: rule.source ?? fallbackSource,
  };
}

function buildOverlayRule(overlay: UserKnowledgeOverlay): AnalyticsKnowledgeRule | null {
  if (overlay.action !== 'add') return null;
  if (!overlay.body?.trim() || !overlay.title?.trim()) return null;
  return {
    id: `user.${overlay.id}`,
    layer: overlay.layer ?? 'user-context',
    type: overlay.type ?? 'user_preference',
    title: overlay.title,
    description: overlay.description ?? overlay.scope ?? 'User-provided analytics context',
    version: 1,
    status: overlay.status,
    priority: overlay.priority ?? 100,
    triggers: overlay.triggers,
    body: overlay.body,
    source: { kind: 'user-overlay', overlayId: overlay.id },
  };
}

function applyOverride(rule: AnalyticsKnowledgeRule, overlay: UserKnowledgeOverlay): AnalyticsKnowledgeRule {
  return {
    ...rule,
    title: overlay.title ?? rule.title,
    description: overlay.description ?? rule.description,
    body: overlay.body ?? rule.body,
    priority: overlay.priority ?? rule.priority,
    triggers: overlay.triggers ?? rule.triggers,
    source: { kind: 'user-overlay', overlayId: overlay.id, packId: rule.source?.packId },
  };
}

function collectBuiltInRules(packs: AnalyticsKnowledgePack[]): AnalyticsKnowledgeRule[] {
  return packs.flatMap((pack) =>
    pack.status === 'active'
      ? pack.rules.map((rule) => ({
          ...rule,
          source: { kind: 'built-in' as const, packId: pack.id },
        }))
      : [],
  );
}

function selectRules(
  rules: AnalyticsKnowledgeRule[],
  input: Required<Pick<AnalyticsKnowledgeResolutionInput, 'connectors' | 'domains' | 'jobs' | 'tasks'>>,
  audit: AnalyticsKnowledgeResolutionAudit,
): AnalyticsKnowledgeRule[] {
  const candidates = rules
    .filter((rule) => {
      if (rule.status !== 'active') {
        audit.skipped.push({ id: rule.id, reason: `rule status is ${rule.status}` });
        return false;
      }
      if (!triggerMatches(rule.triggers, input)) {
        audit.skipped.push({ id: rule.id, reason: 'trigger did not match current context' });
        return false;
      }
      return true;
    })
    .sort(ruleSort);

  const selected: AnalyticsKnowledgeRule[] = [];
  const selectedIds = new Set<string>();

  for (const rule of candidates) {
    const missingDependency = (rule.dependsOn ?? []).find((dependencyId) => !selectedIds.has(dependencyId));
    if (missingDependency) {
      audit.skipped.push({ id: rule.id, reason: `missing dependency ${missingDependency}` });
      continue;
    }

    const conflictingRule = selected.find(
      (existing) => existing.conflictsWith?.includes(rule.id) || rule.conflictsWith?.includes(existing.id),
    );
    if (conflictingRule) {
      audit.conflicts.push({
        keptRuleId: conflictingRule.id,
        skippedRuleId: rule.id,
        reason: 'higher-ranked rule already selected',
      });
      continue;
    }

    selected.push(rule);
    selectedIds.add(rule.id);
  }

  return selected;
}

export function resolveAnalyticsKnowledge(input: AnalyticsKnowledgeResolutionInput = {}): ResolvedAnalyticsKnowledgeContext {
  const packs = input.packs ?? BUILT_IN_ANALYTICS_KNOWLEDGE_PACKS;
  const overlays = input.overlays ?? [];
  const audit: AnalyticsKnowledgeResolutionAudit = {
    appliedRuleIds: [],
    appliedOverlayIds: [],
    skipped: [],
    conflicts: [],
  };

  const disabledRuleIds = new Set<string>();
  const overrides = new Map<string, UserKnowledgeOverlay>();
  const addedRules: AnalyticsKnowledgeRule[] = [];

  for (const overlay of overlays) {
    if (overlay.status !== 'active') {
      audit.skipped.push({ id: overlay.id, reason: `overlay status is ${overlay.status}` });
      continue;
    }
    if (overlay.action === 'disable' && overlay.targetRuleId) {
      disabledRuleIds.add(overlay.targetRuleId);
      audit.appliedOverlayIds.push(overlay.id);
      continue;
    }
    if (overlay.action === 'override' && overlay.targetRuleId) {
      overrides.set(overlay.targetRuleId, overlay);
      audit.appliedOverlayIds.push(overlay.id);
      continue;
    }
    const addedRule = buildOverlayRule(overlay);
    if (addedRule) {
      addedRules.push(addedRule);
      audit.appliedOverlayIds.push(overlay.id);
    } else {
      audit.skipped.push({ id: overlay.id, reason: 'overlay did not include enough rule content' });
    }
  }

  const builtInRules = collectBuiltInRules(packs)
    .filter((rule) => {
      const disabled = disabledRuleIds.has(rule.id);
      if (disabled) audit.skipped.push({ id: rule.id, reason: 'disabled by user overlay' });
      return !disabled;
    })
    .map((rule) => {
      const override = overrides.get(rule.id);
      return override ? applyOverride(rule, override) : rule;
    });

  for (const overlay of overrides.values()) {
    if (!builtInRules.some((rule) => rule.id === overlay.targetRuleId)) {
      audit.skipped.push({ id: overlay.id, reason: `target rule ${overlay.targetRuleId} was not found` });
    }
  }

  const normalizedInput = {
    connectors: [...normalizeValues(input.connectors)],
    domains: [...normalizeValues(input.domains)],
    jobs: [...normalizeValues(input.jobs)],
    tasks: [...normalizeValues(input.tasks)],
  };
  const selectedRules = selectRules([...builtInRules, ...addedRules], normalizedInput, audit);

  audit.appliedRuleIds = selectedRules.map((rule) => rule.id);

  return {
    version: 1,
    generatedAt: input.nowIso ?? new Date().toISOString(),
    packVersions: packs
      .filter((pack) => pack.status === 'active')
      .map((pack) => ({ id: pack.id, version: pack.version, checksum: pack.checksum })),
    rules: selectedRules.map((rule) => toResolvedRule(rule, rule.source ?? { kind: 'built-in' })),
    audit,
  };
}

export function toAgentAnalyticsKnowledgeContext(
  resolved: ResolvedAnalyticsKnowledgeContext,
): AgentAnalyticsKnowledgeContext {
  return {
    version: resolved.version,
    packVersions: resolved.packVersions,
    rules: resolved.rules,
    audit: {
      appliedRuleIds: resolved.audit.appliedRuleIds,
      appliedOverlayIds: resolved.audit.appliedOverlayIds,
      skippedCount: resolved.audit.skipped.length,
      conflicts: resolved.audit.conflicts,
    },
  };
}
