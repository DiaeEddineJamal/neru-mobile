// Reading provider streams: text, reasoning, usage and tool calls, for the three API formats. No imports beyond
// types, so Node checks can load it (tools.check.ts).
import type { ApiFormat } from '@/shared/providerCatalog';

/** A tool the model asked for: `args` is its JSON text. */
export type ToolCall = { id: string; name: string; args: string };
/** `onUsage` gets the tokens the provider reports; a provider that reports none leaves it uncalled. */
export type StreamHandlers = { onDelta: (text: string) => void; onReasoning?: (text: string) => void; onUsage?: (input: number, output: number) => void };

/** JSON Schema as providers accept it: an object at the top, without keys some of them reject. */
export function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$schema' && k !== '$id' && k !== '$comment') out[k] = walk(x);
    return out;
  };
  const s = walk(schema) as Record<string, unknown>;
  return s.type === 'object' ? { properties: {}, ...s } : { type: 'object', properties: {} };
}

/** Tool calls being streamed, by the index or id the provider gives them. */
export class CallCollector {
  private calls = new Map<string, ToolCall>();
  private order: string[] = [];
  part(key: string, patch: { id?: string; name?: string; args?: string }) {
    let call = this.calls.get(key);
    if (!call) {
      call = { id: '', name: '', args: '' };
      this.calls.set(key, call);
      this.order.push(key);
    }
    if (patch.id) call.id = patch.id;
    if (patch.name) call.name = patch.name;
    if (patch.args) call.args += patch.args;
  }
  set(key: string, call: ToolCall) {
    if (!this.calls.has(key)) this.order.push(key);
    this.calls.set(key, call);
  }
  done(): ToolCall[] {
    return this.order.map(k => this.calls.get(k)!).filter(c => c.name).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  }
}

/** Pulls text and tool calls out of one SSE `data:` payload for the given format. */
export function parseEvent(format: ApiFormat, data: string, h: StreamHandlers, calls: CallCollector = new CallCollector()) {
  if (data === '[DONE]') return;
  const e = JSON.parse(data);
  if (e.error) throw new Error(`stream failed: ${typeof e.error === 'string' ? e.error : (e.error.message ?? JSON.stringify(e.error))}`);
  if (format === 'anthropic') {
    if (e.type === 'message_start' && e.message?.usage) h.onUsage?.(e.message.usage.input_tokens ?? 0, e.message.usage.output_tokens ?? 0);
    if (e.type === 'message_delta' && e.usage?.output_tokens) h.onUsage?.(0, e.usage.output_tokens);
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') calls.part(String(e.index), { id: e.content_block.id, name: e.content_block.name });
    if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') calls.part(String(e.index), { args: e.delta.partial_json });
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') h.onDelta(e.delta.text);
    if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta') h.onReasoning?.(e.delta.thinking);
  } else if (format === 'openai-responses') {
    if (e.type === 'response.output_text.delta') h.onDelta(e.delta);
    if (e.type === 'response.reasoning_summary_text.delta' || e.type === 'response.reasoning_text.delta') h.onReasoning?.(e.delta);
    if (e.type === 'response.output_item.done' && e.item?.type === 'function_call') calls.set(String(e.item.id ?? e.item.call_id), { id: e.item.call_id, name: e.item.name, args: e.item.arguments ?? '' });
    if (e.type === 'response.completed' && e.response?.usage) h.onUsage?.(e.response.usage.input_tokens ?? 0, e.response.usage.output_tokens ?? 0);
    if (e.type === 'response.failed') throw new Error(`stream failed: ${e.response?.error?.message ?? 'response failed'}`);
  } else {
    // Groq reports usage under x_groq; the others send a last chunk with `usage` (stream_options).
    const u = e.usage ?? e.x_groq?.usage;
    if (u?.prompt_tokens != null || u?.completion_tokens != null) h.onUsage?.(u.prompt_tokens ?? 0, u.completion_tokens ?? 0);
    const d = e.choices?.[0]?.delta;
    if (d?.content) h.onDelta(d.content);
    const r = d?.reasoning_content ?? d?.reasoning;
    if (typeof r === 'string' && r) h.onReasoning?.(r);
    for (const [i, t] of (d?.tool_calls ?? []).entries()) calls.part(String(t.index ?? i), { id: t.id, name: t.function?.name, args: t.function?.arguments });
  }
}


// On-device models have no tool API: they write <tool_call>{"name": …, "arguments": …}</tool_call> instead. Small
// models also answer with the JSON alone, or in their own trained format: Liquid's LFM2 writes
// <|tool_call_start|>[name(key="value")]<|tool_call_end|>.
const CALL = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|<\|tool_call_start\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;
const OPEN = /<tool_call>|<\|tool_call_start\|>/;
const BARE = /^\s*(?:```(?:json)?\s*)?(\{[\s\S]*\})\s*(?:```)?\s*$/;

type Called = { name: string; arguments: unknown };

/** `{"name", "arguments"}` JSON, one call or a list of them. */
function jsonCalls(text: string): Called[] {
  const body = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim()) as Partial<Called> | Partial<Called>[];
  return (Array.isArray(body) ? body : [body]).filter((c): c is Called => typeof c?.name === 'string').map(c => ({ name: c.name, arguments: c.arguments ?? {} }));
}

/** Python-style calls: `[search(q="bug", limit=5), list_labels()]`. Values are JSON literals or single-quoted strings. */
function pythonCalls(text: string): Called[] {
  const out: Called[] = [];
  for (const m of text.replace(/^\[|\]$/g, '').matchAll(/([A-Za-z_][\w-]*)\(((?:[^()"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*)\)/g)) {
    const args: Record<string, unknown> = {};
    for (const a of m[2].matchAll(/([A-Za-z_]\w*)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,]+)/g)) {
      const raw = a[2].trim();
      try { args[a[1]] = JSON.parse(raw.startsWith("'") ? `"${raw.slice(1, -1).replace(/"/g, '\\"')}"` : raw.replace(/^True$/, 'true').replace(/^False$/, 'false').replace(/^None$/, 'null')); }
      catch { args[a[1]] = raw; }
    }
    out.push({ name: m[1], arguments: args });
  }
  return out;
}

/** The tool calls an on-device reply made, and its text without them. */
export function parseLocalCalls(text: string): { visible: string; calls: ToolCall[] } {
  const found: Called[] = [];
  for (const m of text.matchAll(CALL)) {
    const body = (m[1] ?? m[2]).trim();
    try { found.push(...jsonCalls(body)); }
    catch { found.push(...pythonCalls(body)); }
  }
  let visible = text.replace(CALL, '').replace(new RegExp(`(${OPEN.source})[\\s\\S]*$`), '').trim();
  // No tags at all, but the whole reply is a call: take it as one.
  const bare = !found.length && text.match(BARE);
  if (bare) {
    try {
      const calls = jsonCalls(bare[1]);
      if (calls.length && calls.every(c => c.arguments && typeof c.arguments === 'object')) (found.push(...calls), (visible = ''));
    } catch {}
  }
  const stamp = Date.now();
  return { visible, calls: found.map((c, i) => ({ id: `local_${stamp}_${i}`, name: c.name, args: JSON.stringify(c.arguments) })) };
}

/** What streams to the screen: everything before a tool call starts, and nothing while the reply is bare JSON. */
export const beforeCall = (text: string) => {
  const at = text.search(OPEN);
  const shown = at < 0 ? text : text.slice(0, at);
  return /^\s*(```(json)?\s*)?\{/.test(shown) ? '' : shown;
};

