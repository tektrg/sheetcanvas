import { describe, expect, it } from 'vitest';
import { resolveAnalyticsKnowledge, toAgentAnalyticsKnowledgeContext } from '../analyticsKnowledgeResolver';
import type { UserKnowledgeOverlay } from '../analyticsKnowledgeTypes';

describe('resolveAnalyticsKnowledge', () => {
  it('includes general analysis rules and connector-specific platform rules', () => {
    const resolved = resolveAnalyticsKnowledge({
      connectors: ['clickhouse'],
      nowIso: '2026-06-27T00:00:00.000Z',
    });

    const ruleIds = resolved.rules.map((rule) => rule.id);

    expect(ruleIds).toContain('general.analysis.verification');
    expect(ruleIds).toContain('platform.clickhouse.schema_first');
    expect(ruleIds).toContain('platform.clickhouse.query_safety');
    expect(ruleIds).not.toContain('platform.google_analytics.metric_semantics');
    expect(resolved.audit.appliedRuleIds).toEqual(ruleIds);
  });

  it('skips platform rules when their connector trigger is not present', () => {
    const resolved = resolveAnalyticsKnowledge({
      connectors: [],
      nowIso: '2026-06-27T00:00:00.000Z',
    });

    const ruleIds = resolved.rules.map((rule) => rule.id);

    expect(ruleIds).toContain('general.analysis.workflow');
    expect(ruleIds).not.toContain('platform.clickhouse.schema_first');
  });

  it('applies user overlays as a thin context layer over built-ins', () => {
    const overlays: UserKnowledgeOverlay[] = [
      {
        id: 'company-revenue-override',
        action: 'override',
        targetRuleId: 'general.analysis.verification',
        body: 'Company rule: verify revenue with finance-certified definitions before presenting insight.',
        status: 'active',
        updatedAt: 1,
      },
      {
        id: 'retail-valid-sales',
        action: 'add',
        layer: 'user-context',
        type: 'company_rule',
        title: 'Valid retail sales filter',
        body: 'For this company, valid retail sales exclude canceled, returned, and non-retail store transactions.',
        status: 'active',
        priority: 110,
        updatedAt: 2,
      },
    ];

    const resolved = resolveAnalyticsKnowledge({
      connectors: ['clickhouse'],
      overlays,
      nowIso: '2026-06-27T00:00:00.000Z',
    });

    const verificationRule = resolved.rules.find((rule) => rule.id === 'general.analysis.verification');
    const userRule = resolved.rules.find((rule) => rule.id === 'user.retail-valid-sales');

    expect(verificationRule?.body).toContain('finance-certified definitions');
    expect(verificationRule?.source).toEqual({
      kind: 'user-overlay',
      overlayId: 'company-revenue-override',
      packId: 'general.data-analysis',
    });
    expect(userRule?.layer).toBe('user-context');
    expect(userRule?.body).toContain('exclude canceled');
    expect(resolved.audit.appliedOverlayIds).toEqual(['company-revenue-override', 'retail-valid-sales']);
  });

  it('can disable built-in rules without mutating the built-in pack', () => {
    const resolved = resolveAnalyticsKnowledge({
      connectors: ['clickhouse'],
      overlays: [
        {
          id: 'disable-clickhouse-query-safety',
          action: 'disable',
          targetRuleId: 'platform.clickhouse.query_safety',
          status: 'active',
          updatedAt: 1,
        },
      ],
      nowIso: '2026-06-27T00:00:00.000Z',
    });

    expect(resolved.rules.map((rule) => rule.id)).not.toContain('platform.clickhouse.query_safety');
    expect(resolved.audit.skipped).toContainEqual({
      id: 'platform.clickhouse.query_safety',
      reason: 'disabled by user overlay',
    });
  });
});

describe('toAgentAnalyticsKnowledgeContext', () => {
  it('keeps the agent payload compact but traceable', () => {
    const resolved = resolveAnalyticsKnowledge({
      connectors: ['google-analytics'],
      nowIso: '2026-06-27T00:00:00.000Z',
    });

    const agentContext = toAgentAnalyticsKnowledgeContext(resolved);

    expect(agentContext.rules.some((rule) => rule.id === 'platform.google_analytics.metric_semantics')).toBe(true);
    expect(agentContext.audit.appliedRuleIds.length).toBe(agentContext.rules.length);
    expect(agentContext.audit.skippedCount).toBeGreaterThan(0);
  });
});
