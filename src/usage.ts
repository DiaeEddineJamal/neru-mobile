// What Neru has cost you, and what the same tokens would have cost on a paid model. Free keys, on-device models
// and your own hardware cost nothing; replies on paid keys are counted apart, since their price is your provider's.
// A daily log by provider and model feeds Settings → Usage (today, this week).
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { providerPresets } from '@/shared/providerCatalog';

/** The paid model the savings compare against, in US dollars per million tokens (a mid-tier frontier price). */
export const REFERENCE = { name: 'a leading paid model', input: 3, output: 15 };

type Bucket = { input: number; output: number; replies: number };
export type Usage = { free: Bucket; paid: Bucket; since: number };
/** Day ('YYYY-MM-DD', local time) → "provider\nmodel" → tokens. */
export type UsageLog = Record<string, Record<string, Bucket>>;

const KEY = 'usage.totals';
const LOG = 'usage.daily';
/** Days of history kept in the log. */
const KEEP_DAYS = 35;
const empty = (): Usage => ({ free: { input: 0, output: 0, replies: 0 }, paid: { input: 0, output: 0, replies: 0 }, since: Date.now() });
const parse = <T,>(text: string | null, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};
let usage: Usage = { ...empty(), ...parse<Partial<Usage>>(kvGetSync(KEY), {}) };
let log: UsageLog = parse<UsageLog>(kvGetSync(LOG), {});
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

const FREE_HOSTS = new Set(['on-device', 'ollama', 'local']);
/** Free keys, on-device models and local servers; OpenRouter and Kilo count only for their free models. */
export const isFree = (providerId: string, model: string) =>
  FREE_HOSTS.has(providerId) || (providerId === 'openrouter' || providerId === 'kilo' ? /(:free|-free)$/i.test(model) || model === 'openrouter/free' : !!providerPresets.find(p => p.id === providerId)?.freeLimit);

/** Tokens as a provider counts them, roughly, for replies whose provider reports none. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Local calendar day of a timestamp, as the log keys it. */
export const dayKey = (at: number | Date = Date.now()) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function recordUsage(providerId: string, model: string, input: number, output: number) {
  const bucket = isFree(providerId, model) ? 'free' : 'paid';
  const b = usage[bucket];
  usage = { ...usage, [bucket]: { input: b.input + input, output: b.output + output, replies: b.replies + 1 } };
  void kvSet(KEY, JSON.stringify(usage));

  const day = dayKey();
  const id = `${providerId}\n${model}`;
  const today = log[day] ?? {};
  const was = today[id] ?? { input: 0, output: 0, replies: 0 };
  log = { ...log, [day]: { ...today, [id]: { input: was.input + input, output: was.output + output, replies: was.replies + 1 } } };
  const oldest = dayKey(Date.now() - KEEP_DAYS * 86_400_000);
  for (const d of Object.keys(log)) if (d < oldest) delete log[d];
  void kvSet(LOG, JSON.stringify(log));
  emit();
}

/** One provider and model over a period. */
export type ModelUsage = Bucket & { providerId: string; model: string; free: boolean };

/** Usage per provider and model over the last `days` days, today included; most tokens first. */
export function usageByModel(l: UsageLog, days: number): ModelUsage[] {
  const from = dayKey(Date.now() - (days - 1) * 86_400_000);
  const sum = new Map<string, Bucket>();
  for (const [day, models] of Object.entries(l)) {
    if (day < from) continue;
    for (const [id, b] of Object.entries(models)) {
      const s = sum.get(id) ?? { input: 0, output: 0, replies: 0 };
      sum.set(id, { input: s.input + b.input, output: s.output + b.output, replies: s.replies + b.replies });
    }
  }
  return [...sum.entries()]
    .map(([id, b]) => {
      const [providerId, model = ''] = id.split('\n');
      return { ...b, providerId, model, free: isFree(providerId, model) };
    })
    .sort((a, b) => b.input + b.output - (a.input + a.output));
}

/** What `tokens` would cost on the reference model. */
export const referenceCost = (b: { input: number; output: number }) => (b.input * REFERENCE.input + b.output * REFERENCE.output) / 1e6;

export const dollars = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`;
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export function resetUsage() {
  usage = empty();
  log = {};
  void kvSet(KEY, JSON.stringify(usage));
  void kvSet(LOG, JSON.stringify(log));
  emit();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useUsage = () => useSyncExternalStore(subscribe, () => usage);
export const useUsageLog = () => useSyncExternalStore(subscribe, () => log);
