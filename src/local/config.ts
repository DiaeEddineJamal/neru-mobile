import { kvGetSync, kvSet } from '@/db';
import { localModel, type LocalConfig } from '@/local/catalog';

export function configForLocal(id: string): LocalConfig {
  const m = localModel(id);
  if (!m) throw new Error('Unknown model.');
  const saved = kvGetSync(`model.config.${id}`);
  return { ...m.defaults, ...(saved ? JSON.parse(saved) : {}) };
}
export async function saveLocalConfig(id: string, config: LocalConfig) {
  const m = localModel(id);
  if (!m) throw new Error('Unknown model.');
  if (!Number.isInteger(config.maxTokens) || config.maxTokens < 1 || config.maxTokens > m.maxContext || !Number.isInteger(config.contextTokens) || config.contextTokens < 512 || config.contextTokens > m.maxContext || config.maxTokens > config.contextTokens) throw new Error(`Use 512–${m.maxContext} context tokens, with max output tokens no larger than the context.`);
  if (!Number.isInteger(config.topK) || config.topK < 1 || config.topK > 128 || !Number.isFinite(config.topP) || config.topP <= 0 || config.topP > 1 || !Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) throw new Error('Top K must be 1–128, top P above 0 and at most 1, and temperature 0–2.');
  if (!m.accelerators.includes(config.accelerator)) throw new Error('This model does not support that accelerator.');
  if (config.thinking && !m.thinking || config.speculative && !m.speculative) throw new Error('This model does not support that option.');
  await kvSet(`model.config.${id}`, JSON.stringify(config));
}
