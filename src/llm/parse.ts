// Reading provider streams: text, reasoning, usage and tool calls, for the three API formats. No imports beyond
// types, so Node checks can load it (tools.check.ts).
import type { ApiFormat } from '@/shared/providerCatalog';

/** A tool the model asked for: `args` is its JSON text; `extra` is provider data to send back with it (Gemini's
 * thought signature). */
export type ToolCall = { id: string; name: string; args: string; extra?: Record<string, unknown> };
/** `onUsage` gets the tokens the provider reports; a provider that reports none leaves it uncalled. */
export type StreamHandlers = { onDelta: (text: string) => void; onReasoning?: (text: string) => void; onUsage?: (input: number, output: number) => void };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** Never turn invalid arguments into an empty tool invocation. Let the model correct its JSON first. */
export function parseArgs(args: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(args || '{}'); }
  catch { throw new Error('Tool arguments must be valid JSON. Send a JSON object with the required argument names.'); }
  if (!isObj(value)) throw new Error('Tool arguments must be a JSON object, not an array or a single value.');
  return value;
}

/** Inlines local `$ref`s (`#/$defs/X`, `#/definitions/X`) so every provider sees plain schemas; a reference that
 * loops is cut to a bare object. */
function inlineRefs(schema: Json): Json {
  const walk = (v: unknown, seen: string[]): unknown => {
    if (Array.isArray(v)) return v.map(x => walk(x, seen));
    if (!isObj(v)) return v;
    const ref = typeof v.$ref === 'string' && v.$ref.startsWith('#/') ? v.$ref : undefined;
    if (ref !== undefined) {
      const { $ref: _ref, ...rest } = v;
      const target = ref.slice(2).split('/').reduce<unknown>((node, key) => isObj(node) ? node[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined, schema);
      if (seen.includes(ref) || !isObj(target)) return { type: 'object', ...rest };
      return walk({ ...target, ...rest }, [...seen, ref]);
    }
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$defs' && k !== 'definitions') out[k] = walk(x, seen);
    return out;
  };
  return walk(schema, []) as Json;
}

/** JSON Schema as providers accept it: references inlined, an object at the top, without keys some of them reject. */
export function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$schema' && k !== '$id' && k !== '$comment') out[k] = walk(x);
    return out;
  };
  const s = walk(inlineRefs(schema)) as Record<string, unknown>;
  return s.type === 'object' || (!s.type && isObj(s.properties)) ? { type: 'object', properties: {}, ...s } : { type: 'object', properties: {} };
}

/** Compact nested argument shapes for phone models; keep page content and properties ahead of cosmetic options. */
export function localArgumentShape(schema: Json): string {
  const priority = ['parent', 'pages', 'properties', 'content', 'title', 'query', 'page_id', 'data_source_id'];
  const shape = (raw: unknown, depth: number): string => {
    if (!isObj(raw)) return 'JSON';
    if (depth > 6) return 'JSON';
    if ('const' in raw) return JSON.stringify(raw.const);
    if (Array.isArray(raw.enum)) return raw.enum.map(v => JSON.stringify(v)).join('|');
    const choices = raw.anyOf ?? raw.oneOf;
    if (Array.isArray(choices)) return choices.map(s => shape(s, depth + 1)).join('|');
    if (raw.type === 'array') return `[${shape(raw.items, depth + 1)}]`;
    if (raw.type === 'object' || isObj(raw.properties)) {
      if (depth > 3) return 'object';
      const required = new Set((raw.required as string[]) ?? []);
      const fields = Object.entries(isObj(raw.properties) ? raw.properties : {}).sort(([a], [b]) =>
        Number(required.has(b)) - Number(required.has(a)) || (priority.includes(a) ? priority.indexOf(a) : 100) - (priority.includes(b) ? priority.indexOf(b) : 100));
      const kept = fields.filter(([name], i) => required.has(name) || i < (depth === 0 ? 6 : 3));
      return kept.length ? `{${kept.map(([name, s]) => `${name}${required.has(name) ? '' : '?'}:${shape(s, depth + 1)}`).join(',')}}` : '{key:JSON}';
    }
    return Array.isArray(raw.type) ? raw.type.join('|') : typeof raw.type === 'string' ? raw.type : 'JSON';
  };
  return shape(cleanSchema(schema), 0);
}

// Gemini takes a subset of OpenAPI 3.0 schemas and answers anything else with "HTTP 400: Request contains an
// invalid argument": no $ref, const, anyOf/oneOf/allOf, additionalProperties, type lists, non-string enums, string formats
// other than enum and date-time, or objects without properties.
const GEMINI_KEYS = new Set(['type', 'format', 'description', 'nullable', 'enum', 'items', 'properties', 'required', 'minItems', 'maxItems', 'minimum', 'maximum']);
const GEMINI_FORMATS: Record<string, string[]> = { string: ['enum', 'date-time'], number: ['float', 'double'], integer: ['int32', 'int64'] };
const JSON_TEXT = 'Write it as JSON text.';

/** A tool's parameters in Gemini's schema subset, or null when it takes none (Gemini rejects empty objects). */
export function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  const conv = (raw: unknown, depth: number): Json => {
    if (!isObj(raw) || depth > 12) return { type: 'string' };
    let s: Json = { ...raw };
    // allOf merges into one schema; oneOf reads as anyOf; const is a one-value enum.
    if (Array.isArray(s.allOf)) {
      const parts = s.allOf.filter(isObj);
      s = { ...s, allOf: undefined, properties: Object.assign({}, ...parts.map(p => p.properties ?? {}), s.properties ?? {}), required: [...parts.flatMap(p => (p.required as string[]) ?? []), ...((s.required as string[]) ?? [])], type: s.type ?? parts.find(p => p.type)?.type };
    }
    if (Array.isArray(s.oneOf) && !s.anyOf) s.anyOf = s.oneOf;
    if ('const' in s && !s.enum) s.enum = [s.const];
    let nullable = s.nullable === true;
    let type = s.type;
    if (Array.isArray(type)) {
      nullable ||= type.includes('null');
      type = type.find(t => t !== 'null') ?? 'string';
    }
    // Choices: a null branch makes the value nullable; object branches merge into one object whose fields are all
    // optional (Notion's "page or database" parent); otherwise the first branch stands for the rest.
    if (Array.isArray(s.anyOf)) {
      const branches = s.anyOf.filter(isObj).filter(b => b.type !== 'null' || (nullable = true, false));
      const objects = branches.filter(b => b.type === 'object' || isObj(b.properties));
      const literals = branches.flatMap(b => 'const' in b ? [b.const] : Array.isArray(b.enum) ? b.enum : []);
      if (branches.length && branches.every(b => 'const' in b || Array.isArray(b.enum)) && literals.every(v => typeof v === 'string'))
        return withNullable({ type: 'string', enum: [...new Set(literals)] }, nullable);
      const merged: Json = {};
      for (const object of objects) for (const [key, value] of Object.entries(isObj(object.properties) ? object.properties : {}))
        merged[key] = key in merged ? { anyOf: [merged[key], value] } : value;
      const pick = objects.length > 1
        ? { type: 'object', properties: merged, required: ((objects[0].required as string[]) ?? []).filter(r => objects.every(b => ((b.required as string[]) ?? []).includes(r))) }
        : objects[0] ?? branches[0];
      if (pick) return withNullable({ ...conv(pick, depth + 1), ...(s.description ? { description: s.description } : {}) }, nullable);
    }
    if (!type) type = isObj(s.properties) ? 'object' : s.items ? 'array' : Array.isArray(s.enum) ? 'string' : 'string';
    const out: Json = { type };
    for (const [k, v] of Object.entries(s)) {
      if (!GEMINI_KEYS.has(k) || k === 'type' || k === 'anyOf' || v === undefined) continue;
      if (k === 'format') { if (typeof v === 'string' && GEMINI_FORMATS[type as string]?.includes(v)) out.format = v; continue; }
      if (k === 'enum') { if (Array.isArray(v) && v.length) { out.type = 'string'; out.enum = v.map(String); } continue; }
      if (k === 'properties') {
        if (!isObj(v)) continue;
        out.properties = Object.fromEntries(Object.entries(v).map(([name, p]) => [name, conv(p, depth + 1)]));
        continue;
      }
      if (k === 'items') { out.items = conv(Array.isArray(v) ? v[0] : v, depth + 1); continue; }
      if (k === 'required') continue;
      out[k] = v;
    }
    if (out.type === 'array' && !out.items) out.items = { type: 'string' };
    if (out.type === 'object') {
      const props = isObj(out.properties) ? out.properties : {};
      // A free-form object (a map, or "any JSON") has no fields to describe: the model writes it as JSON text,
      // and coerceArgs turns it back into an object before the tool runs.
      if (!Object.keys(props).length) return withNullable({ type: 'string', description: [s.description, JSON_TEXT].filter(Boolean).join(' ') }, nullable);
      const required = ((s.required as string[]) ?? []).filter(r => r in props);
      if (required.length) out.required = [...new Set(required)];
    }
    return withNullable(out, nullable);
  };
  const withNullable = (s: Json, nullable: boolean) => (nullable ? { ...s, nullable: true } : s);
  const top = conv(inlineRefs(schema), 0);
  if (top.type !== 'object' || !isObj(top.properties)) return null;
  const { nullable: _n, ...rest } = top;
  return rest;
}

/**
 * Arguments as the tool's own schema wants them: objects and arrays a model wrote as JSON text (as Gemini must for
 * free-form objects) are parsed back, at any depth.
 */
export function coerceArgs(args: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
  const root = inlineRefs(schema);
  const fix = (value: unknown, s: unknown, depth: number): unknown => {
    if (!isObj(s) || depth > 12) return value;
    const branches = [s, ...(['anyOf', 'oneOf', 'allOf'] as const).flatMap(k => (Array.isArray(s[k]) ? (s[k] as unknown[]).filter(isObj) : []))];
    const types = branches.flatMap(b => Array.isArray(b.type) ? b.type : b.type ? [b.type] : []);
    const wantsJson = types.includes('object') || types.includes('array') || branches.some(b => b.type === 'object' || b.type === 'array' || isObj(b.properties));
    const acceptsString = branches.some(b => (b.type === 'string' || Array.isArray(b.type) && b.type.includes('string')) &&
      (!Array.isArray(b.enum) || b.enum.includes(value)) && (!('const' in b) || b.const === value));
    if (typeof value === 'string' && wantsJson && !acceptsString && /^\s*[[{]/.test(value)) {
      try { value = JSON.parse(value); } catch { return value; }
    }
    // Gemini enums are strings only: a number or boolean enum comes back as text.
    if (typeof value === 'string' && !types.includes('string')) {
      if ((types.includes('integer') || types.includes('number')) && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) {
        const number = Number(value);
        if (Number.isFinite(number) && (types.includes('number') || Number.isInteger(number))) return number;
      }
      if (types.includes('boolean') && (value === 'true' || value === 'false')) return value === 'true';
    }
    if (Array.isArray(value)) return value.map((v, i) => {
      const items = branches.find(b => b.items)?.items;
      return fix(v, Array.isArray(items) ? items[i] : items, depth + 1);
    });
    if (isObj(value)) {
      // Choose the matching object variant before merging its properties. A field can have different types in
      // each variant; taking the last one would silently change valid arguments for the first variant.
      const objects = branches.filter(b => isObj(b.properties));
      const matches = objects.filter(b => Object.entries(b.properties as Json).every(([k, p]) =>
        !(k in value) || !isObj(p) || (!('const' in p) || value[k] === p.const) && (!Array.isArray(p.enum) || p.enum.includes(value[k]))));
      const selected = matches.length ? matches : objects;
      const props = Object.assign({}, ...selected.map(b => b.properties)) as Json;
      const additional = branches.find(b => isObj(b.additionalProperties))?.additionalProperties;
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fix(v, props[k] ?? additional, depth + 1)]));
    }
    return value;
  };
  return fix(args, root, 0) as Record<string, unknown>;
}

/** Tool calls being streamed, by the index or id the provider gives them. */
export class CallCollector {
  private calls = new Map<string, ToolCall>();
  private order: string[] = [];
  part(key: string, patch: { id?: string; name?: string; args?: string; extra?: Record<string, unknown> }) {
    let call = this.calls.get(key);
    if (!call) {
      call = { id: '', name: '', args: '' };
      this.calls.set(key, call);
      this.order.push(key);
    }
    if (patch.id) call.id = patch.id;
    if (patch.name) call.name = patch.name;
    if (patch.args) call.args += patch.args;
    if (patch.extra) call.extra = { ...call.extra, ...patch.extra };
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
    // Gemini 3 signs each call (extra_content.google.thought_signature) and wants the signature back next turn.
    for (const [i, t] of (d?.tool_calls ?? []).entries()) calls.part(String(t.index ?? i), { id: t.id, name: t.function?.name, args: t.function?.arguments, extra: t.extra_content });
  }
}


// On-device models have no tool API: they write <tool_call>{"name": …, "arguments": …}</tool_call> instead. Small
// models also answer with the JSON alone, or in their own trained format: Liquid's LFM2 writes
// <|tool_call_start|>[name(key="value")]<|tool_call_end|>.
const CALL = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|<\|tool_call_start\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>|<\|tool_call>\s*([\s\S]*?)\s*<tool_call\|>/g;
const OPEN = /<tool_call>|<\|tool_call_start\|>|<\|tool_call>/;
const BARE = /^\s*(?:```(?:json)?\s*)?(\{[\s\S]*\})\s*(?:```)?\s*$/;

type Called = { name: string; arguments: unknown };

/** Gemma 4's structured calls: string delimiters protect punctuation inside nested JSON values. */
function gemmaCalls(body: string): Called[] {
  const call = body.match(/^call:([A-Za-z_][\w-]*)\s*(\{[\s\S]*\})$/);
  if (!call) return [];
  const source = call[2];
  const delimiter = '<|"|>';
  let json = '';
  for (let i = 0; i < source.length;) {
    if (source.startsWith(delimiter, i)) {
      const end = source.indexOf(delimiter, i + delimiter.length);
      if (end < 0) throw new Error('Incomplete Gemma string');
      json += JSON.stringify(source.slice(i + delimiter.length, end));
      i = end + delimiter.length;
    } else if (source[i] === '"') {
      const start = i++;
      while (i < source.length) { if (source[i++] === '\\') i++; else if (source[i - 1] === '"') break; }
      json += source.slice(start, i);
    } else if (/[A-Za-z_]/.test(source[i])) {
      const start = i++;
      while (i < source.length && /[\w-]/.test(source[i])) i++;
      const word = source.slice(start, i);
      json += /^\s*:/.test(source.slice(i)) ? JSON.stringify(word) : word;
    } else json += source[i++];
  }
  return [{ name: call[1], arguments: parseArgs(json) }];
}

/** `{"name", "arguments"}` JSON, one call or a list of them. */
function jsonCalls(text: string): Called[] {
  const body = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim()) as Partial<Called> | Partial<Called>[];
  // Models trained on other formats name the arguments "parameters", "input" or "args", or send them as a JSON string.
  type Loose = Partial<Called> & { parameters?: unknown; input?: unknown; args?: unknown };
  const args = (c: Loose) => {
    const raw = c.arguments ?? c.parameters ?? c.input ?? c.args ?? {};
    return typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : raw;
  };
  return (Array.isArray(body) ? body : [body] as Loose[]).filter((c): c is Called => typeof c?.name === 'string').map(c => ({ name: c.name, arguments: args(c) }));
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
  // A reply that stopped right after the JSON, before </tool_call>: close the last call.
  if (/<tool_call>(?![\s\S]*<\/tool_call>)\s*(```(json)?\s*)?\{[\s\S]*\}\s*(```)?\s*$/.test(text)) text += '</tool_call>';
  for (const m of text.matchAll(CALL)) {
    if (m[3] !== undefined) {
      try { found.push(...gemmaCalls(m[3].trim())); } catch {}
      continue;
    }
    const body = (m[1] ?? m[2]).trim();
    try { found.push(...jsonCalls(body)); }
    catch { found.push(...pythonCalls(body)); }
  }
  let visible = text.replace(CALL, '').replace(new RegExp(`(${OPEN.source})[\\s\\S]*$`), '').replace(/<\|tool_response>[\s\S]*$/, '').trim();
  // No tags at all, but the whole reply is a call: take it as one.
  const bare = !found.length && text.match(BARE);
  if (bare) {
    try {
      const calls = jsonCalls(bare[1]);
      if (calls.length && calls.every(c => c.arguments && typeof c.arguments === 'object')) {
        found.push(...calls);
        visible = '';
      }
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

