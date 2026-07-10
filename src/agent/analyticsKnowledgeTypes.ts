export type AnalyticsKnowledgeLayer = 'platform' | 'general-analysis' | 'user-context';

export type AnalyticsKnowledgeRuleType =
  | 'connector_rule'
  | 'analysis_practice'
  | 'verification_method'
  | 'fallacy_guard'
  | 'domain_rule'
  | 'job_rule'
  | 'company_rule'
  | 'user_preference';

export type AnalyticsKnowledgeRuleStatus = 'active' | 'draft' | 'deprecated';

export type AnalyticsKnowledgeOverlayAction = 'add' | 'override' | 'disable';

export interface AnalyticsKnowledgeTrigger {
  always?: boolean;
  connectors?: string[];
  domains?: string[];
  jobs?: string[];
  tasks?: string[];
}

export interface AnalyticsKnowledgeRuleSource {
  kind: 'built-in' | 'user-overlay';
  packId?: string;
  overlayId?: string;
}

export interface AnalyticsKnowledgeRule {
  id: string;
  layer: AnalyticsKnowledgeLayer;
  type: AnalyticsKnowledgeRuleType;
  title: string;
  description: string;
  version: number;
  status: AnalyticsKnowledgeRuleStatus;
  priority: number;
  triggers?: AnalyticsKnowledgeTrigger;
  dependsOn?: string[];
  conflictsWith?: string[];
  body: string;
  source?: AnalyticsKnowledgeRuleSource;
}

export interface AnalyticsKnowledgePack {
  id: string;
  layer: Exclude<AnalyticsKnowledgeLayer, 'user-context'>;
  title: string;
  version: number;
  checksum: string;
  status: AnalyticsKnowledgeRuleStatus;
  rules: AnalyticsKnowledgeRule[];
}

export interface UserKnowledgeOverlay {
  id: string;
  action: AnalyticsKnowledgeOverlayAction;
  targetRuleId?: string;
  layer?: AnalyticsKnowledgeLayer;
  type?: AnalyticsKnowledgeRuleType;
  title?: string;
  description?: string;
  body?: string;
  priority?: number;
  triggers?: AnalyticsKnowledgeTrigger;
  status: AnalyticsKnowledgeRuleStatus;
  scope?: string;
  updatedAt: number;
}

export interface AnalyticsKnowledgeResolutionInput {
  connectors?: string[];
  domains?: string[];
  jobs?: string[];
  tasks?: string[];
  overlays?: UserKnowledgeOverlay[];
  nowIso?: string;
  packs?: AnalyticsKnowledgePack[];
}

export interface ResolvedAnalyticsKnowledgeRule {
  id: string;
  layer: AnalyticsKnowledgeLayer;
  type: AnalyticsKnowledgeRuleType;
  title: string;
  priority: number;
  version: number;
  body: string;
  source: AnalyticsKnowledgeRuleSource;
}

export interface AnalyticsKnowledgeResolutionAudit {
  appliedRuleIds: string[];
  appliedOverlayIds: string[];
  skipped: Array<{ id: string; reason: string }>;
  conflicts: Array<{ keptRuleId: string; skippedRuleId: string; reason: string }>;
}

export interface ResolvedAnalyticsKnowledgeContext {
  version: 1;
  generatedAt: string;
  packVersions: Array<{ id: string; version: number; checksum: string }>;
  rules: ResolvedAnalyticsKnowledgeRule[];
  audit: AnalyticsKnowledgeResolutionAudit;
}

export interface AgentAnalyticsKnowledgeContext {
  version: 1;
  packVersions: Array<{ id: string; version: number; checksum: string }>;
  rules: ResolvedAnalyticsKnowledgeRule[];
  audit: {
    appliedRuleIds: string[];
    appliedOverlayIds: string[];
    skippedCount: number;
    conflicts: AnalyticsKnowledgeResolutionAudit['conflicts'];
  };
}
