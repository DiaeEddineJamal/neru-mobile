// What Neru has cost you, and what the same tokens would have cost on a paid model. Free keys, on-device models
// and your own hardware cost nothing; replies on paid keys are counted apart, since their price is your provider's.
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { providerPresets } from '@/shared/providerCatalog';

/** The paid model the savings compare against, in US dollars per million tokens. */
export const REFERENCE = { name: 'Claude Sonnet', input: 3, output: 15 };

type Bucket = { input: number; output: number; replies: number };
export type Usage = { free: Bucket; paid: Bucket; since: number };

const KEY = 'usage.totals';
const empty = (): Usage => ({ free: { input: 0, output: 0, replies: 0 }, paid: { input: 0, output: 0, replies: 0 }, since: Date.now() });
let usage: Usage = { ...empty(), ...JSON.parse(kvGetSync(KEY) ?? 'null') };
const listeners = new Set<() => void>();

const FREE_HOSTS = new Set(['on-device', 'ollama', 'local']);
/** Free keys, on-device models and local servers; OpenRouter counts only for its free models. */
export const isFree = (providerId: string, model: string) =>
  FREE_HOSTS.has(providerId) || (providerId === 'openrouter' ? /(:free|-free)$/i.test(model) || model === 'openrouter/free' : !!providerPresets.find(p => p.id === providerId)?.freeLimit);

/** Tokens as a provider counts them, roughly, for replies whose provider reports none. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function recordUsage(providerId: string, model: string, input: number, output: number) {
  const bucket = isFree(providerId, model) ? 'free' : 'paid';
  const b = usage[bucket];
  usage = { ...usage, [bucket]: { input: b.input + input, output: b.output + output, replies: b.replies + 1 } };
  void kvSet(KEY, JSON.stringify(usage));
  listeners.forEach(l => l());
}

/** What `tokens` would cost on the reference model. */
export const referenceCost = (b: { input: number; output: number }) => (b.input * REFERENCE.input + b.output * REFERENCE.output) / 1e6;

export const dollars = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`;
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export function resetUsage() {
  usage = empty();
  void kvSet(KEY, JSON.stringify(usage));
  listeners.forEach(l => l());
}

export const useUsage = () => useSyncExternalStore(l => (listeners.add(l), () => void listeners.delete(l)), () => usage);
