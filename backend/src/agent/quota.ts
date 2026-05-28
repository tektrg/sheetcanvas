import type { Env } from '../env';
import { HttpError } from '../errors';

const DEFAULT_DAILY_LIMIT = 50;

function isDevelopment(env: Env): boolean {
  return (env.ENVIRONMENT ?? '').toLowerCase() === 'development';
}

function todayKey(sessionId: string) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `agent:quota:${sessionId}:${y}-${m}-${day}`;
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
}

export async function checkAndIncrementQuota(env: Env, sessionId: string): Promise<QuotaState> {
  const limit = Number(env.AGENT_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT);
  const kv = env.AGENT_QUOTA;
  if (!kv) {
    if (!isDevelopment(env)) {
      throw new HttpError(
        503,
        'quota_unavailable',
        'AGENT_QUOTA KV namespace is not bound. Run `wrangler kv namespace create AGENT_QUOTA` and add the binding to wrangler.toml.',
      );
    }
    return { used: 0, limit, remaining: limit };
  }
  // Note: incremented before the model call, so failed Gemini calls still count
  // against the daily budget. Acceptable for MVP. Race on concurrent read/write
  // can leak 1-2 turns; tolerable at 50/day.
  const key = todayKey(sessionId);
  const current = Number((await kv.get(key)) ?? '0');
  if (current >= limit) {
    return { used: current, limit, remaining: 0 };
  }
  const next = current + 1;
  // 36h TTL so the daily bucket safely expires after the calendar day.
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 36 });
  return { used: next, limit, remaining: limit - next };
}

export async function readQuota(env: Env, sessionId: string): Promise<QuotaState> {
  const limit = Number(env.AGENT_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT);
  const kv = env.AGENT_QUOTA;
  if (!kv) {
    if (!isDevelopment(env)) {
      throw new HttpError(
        503,
        'quota_unavailable',
        'AGENT_QUOTA KV namespace is not bound. Run `wrangler kv namespace create AGENT_QUOTA` and add the binding to wrangler.toml.',
      );
    }
    return { used: 0, limit, remaining: limit };
  }
  const used = Number((await kv.get(todayKey(sessionId))) ?? '0');
  return { used, limit, remaining: Math.max(0, limit - used) };
}
