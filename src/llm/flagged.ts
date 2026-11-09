// Spotting a provider's safety filter in a stream: OpenAI-style finish_reason "content_filter", Gemini's
// finishReason SAFETY / PROHIBITED_CONTENT / RECITATION / BLOCKLIST / SPII or promptFeedback.blockReason, the
// Responses API's incomplete reason, and the Messages format's stop_reason "refusal". No imports beyond types, so
// Node checks can load it (flagged.check.ts).
import type { ApiFormat } from '@/shared/providerCatalog';

const GEMINI_BLOCKS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);
// A cheap pre-test, so ordinary text chunks are not parsed twice.
const HINT = /content_filter|SAFETY|PROHIBITED_CONTENT|RECITATION|BLOCKLIST|SPII|blockReason|refusal/;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

/** The filter's reason when this SSE `data:` payload says the provider's safety filter stopped the reply, else null. */
export function flagReason(format: ApiFormat, data: string): string | null {
  if (!HINT.test(data)) return null;
  let e: Json | undefined;
  try {
    e = obj(JSON.parse(data));
  } catch {
    return null;
  }
  if (!e) return null;
  if (format === 'anthropic') {
    const stop = obj(e.delta)?.stop_reason ?? obj(e.message)?.stop_reason;
    return stop === 'refusal' ? 'refusal' : null;
  }
  if (format === 'openai-responses') {
    const reason = obj(obj(e.response)?.incomplete_details)?.reason;
    return reason === 'content_filter' ? 'content_filter' : null;
  }
  // Chat Completions, and Gemini's native shape when a proxy passes it through.
  const choice = obj(Array.isArray(e.choices) ? e.choices[0] : undefined);
  const finish = choice?.finish_reason;
  if (finish === 'content_filter') return 'content_filter';
  if (typeof finish === 'string' && GEMINI_BLOCKS.has(finish.toUpperCase())) return finish.toUpperCase();
  const candidate = obj(Array.isArray(e.candidates) ? e.candidates[0] : undefined);
  const gemini = candidate?.finishReason;
  if (typeof gemini === 'string' && GEMINI_BLOCKS.has(gemini)) return gemini;
  const blocked = obj(e.promptFeedback)?.blockReason;
  if (typeof blocked === 'string' && blocked && blocked !== 'BLOCK_REASON_UNSPECIFIED') return blocked;
  return null;
}

/** The error a flagged, empty reply throws; fallback.ts's isFlagged() keys on the word "flagged". */
export const flaggedError = (reason: string) => new Error(`The provider flagged this message (${reason})`);
