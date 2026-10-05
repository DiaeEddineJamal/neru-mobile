// Model switching when a free model runs out, ported from app/src-tauri/src/fallback.rs.
// Error rules and scores match the desktop so both apps switch the same way.
import { kvGet, kvSet } from '@/db';
import { listModels, type ProviderConfig } from '@/llm/stream';

const has = (error: string, markers: string[]) => {
  const lower = error.toLowerCase();
  return markers.some(m => lower.includes(m));
};

export const needsCredits = (e: string) => has(e, ['http 402', 'payment required', 'insufficient credit', 'insufficient balance', 'insufficient funds', 'insufficient_quota', 'credit balance is too low', 'out of credits']);
const badKey = (e: string) => has(e, ['invalid api key', 'invalid_api_key', 'incorrect api key', 'unauthorized', 'authentication', 'invalid token', 'api key not valid']);
export const isRateLimited = (e: string) => needsCredits(e) || has(e, ['http 429', 'rate limit', 'rate-limit', 'ratelimit', 'quota', 'too many requests', 'resource_exhausted', 'no endpoints found']);
export const isDaily = (e: string) => has(e, ['per day', 'per-day', 'daily', 'free-models-per-day', 'rpd', 'tpd']);

/** Another model may work: down, overloaded, gone, not answering, or closed to this key. A bad key or an oversized request is not. */
export function isUnavailable(e: string) {
  const lower = e.toLowerCase();
  if (lower.includes('http 401')) return false;
  if (lower.includes('http 403')) return !badKey(e);
  return has(e, ['http 500', 'http 502', 'http 503', 'http 504', 'http 520', 'http 522', 'http 524', 'http 529', 'overloaded', 'unavailable', 'temporarily', 'model not found', 'model_not_found', 'does not exist', 'unknown model', 'no such model', 'http 404', 'did not start answering', 'stalled', 'timed out', 'connection reset', 'stream failed']);
}

export const shouldSwitch = (e: string) => isRateLimited(e) || isUnavailable(e);

/** Why the switch happened, in words for the notice. */
export function reason(e: string) {
  if (needsCredits(e)) return 'needs credits this account does not have';
  if (isRateLimited(e)) return 'hit its usage limit';
  if (has(e, ['did not start answering', 'stalled', 'timed out'])) return 'is not responding';
  if (has(e, ['not found', 'does not exist', 'http 404', 'unknown model'])) return 'is not available on this provider';
  return 'is having problems';
}

const FAMILIES: [string, number][] = [
  ['qwen3-coder', 100], ['kimi-k', 95], ['glm-5', 94], ['glm-4', 90], ['deepseek-v', 90], ['gemini-3', 90], ['devstral', 88], ['gpt-oss-120b', 86],
  ['minimax-m', 85], ['qwen3', 82], ['deepseek-r', 80], ['gemini-2.5-pro', 80], ['codestral', 78], ['gemini-2.5-flash', 76], ['mistral-large', 75],
  ['llama-4', 70], ['gpt-oss', 68], ['llama-3.3-70b', 62], ['openrouter/free', 60], ['gemma', 50],
];
const TWEAKS: [string, number][] = [['coder', 6], ['pro', 4], ['-lite', -12], ['mini', -10], ['nano', -15], ['small', -8], ['8b', -20], ['7b', -20], ['3b', -30], ['1b', -40], ['vision', -10], ['guard', -100]];

/** Rough model strength by family, the desktop's coding_score without the context-window bonus. */
export function score(id: string) {
  const name = id.toLowerCase();
  let s = FAMILIES.find(([part]) => name.includes(part))?.[1] ?? 30;
  for (const [part, delta] of TWEAKS) if (name.includes(part)) s += delta;
  return s;
}

export const isFreeModel = (m: string) => /(:free|-free)$/i.test(m) || m === 'openrouter/free';

// Resting models, persisted so a model that ran out stays out after a restart.
type Health = Record<string, { until: number; failures: number }>;
const HEALTH = 'fallback.health';
const key = (c: ProviderConfig, model = c.model) => `${c.providerId}\n${model}`;

async function health(): Promise<Health> {
  return JSON.parse((await kvGet(HEALTH)) ?? '{}');
}

export function restFor(error: string, failures: number) {
  const base = isDaily(error) || needsCredits(error) ? 6 * 3600 : isRateLimited(error) ? 60 : 10 * 60;
  return Math.min(base * 2 ** Math.min(Math.max(failures - 1, 0), 6), 6 * 3600) * 1000;
}

export async function recordSuccess(c: ProviderConfig) {
  const h = await health();
  if (!h[key(c)]) return;
  delete h[key(c)];
  await kvSet(HEALTH, JSON.stringify(h));
}

const lists = new Map<string, { at: number; models: string[] }>();
async function cachedModels(c: ProviderConfig) {
  const id = `${c.providerId}\n${c.baseUrl}`;
  const hit = lists.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.models;
  const models = await listModels(c).catch(() => [] as string[]);
  lists.set(id, { at: Date.now(), models });
  return models;
}

/**
 * The model to use after `current` failed with `error`: rests the failed model, then ranks every
 * model of every saved key (OpenRouter's free ones only, so nothing is billed by surprise).
 */
export async function nextModel(current: ProviderConfig, error: string, keys: ProviderConfig[]): Promise<ProviderConfig | null> {
  const h = await health();
  const failures = (h[key(current)]?.failures ?? 0) + 1;
  h[key(current)] = { until: Date.now() + restFor(error, failures), failures };
  await kvSet(HEALTH, JSON.stringify(h));

  const resting = (c: ProviderConfig, m: string) => (h[key(c, m)]?.until ?? 0) > Date.now();
  const candidates = [current, ...keys.filter(k => !(k.providerId === current.providerId && k.baseUrl === current.baseUrl))];
  const models = await Promise.all(candidates.map(cachedModels));
  let best: { s: number; config: ProviderConfig } | null = null;
  candidates.forEach((cand, i) => {
    for (const m of models[i]) {
      if (cand.providerId === 'openrouter' && !isFreeModel(m)) continue;
      if ((cand.providerId === current.providerId && m === current.model) || resting(cand, m)) continue;
      const s = score(m) - 8 * (h[key(cand, m)]?.failures ?? 0) + (cand.providerId === current.providerId ? 6 : 0);
      if (!best || s > best.s) best = { s, config: { ...cand, model: m } };
    }
  });
  return best ? (best as { config: ProviderConfig }).config : null;
}
