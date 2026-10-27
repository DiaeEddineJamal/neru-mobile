// Streaming chat for the three API formats Neru speaks, ported from app/src-tauri/src/providers.rs, with tool calls
// for connectors (MCP): a reply may ask for tools, and the next request carries their results.
import { fetch } from 'expo/fetch';

import { CallCollector, cleanSchema, geminiSchema, parseEvent, type StreamHandlers, type ToolCall } from '@/llm/parse';
import type { ApiFormat } from '@/shared/providerCatalog';

export { CallCollector, cleanSchema, parseEvent, type StreamHandlers, type ToolCall };

export type ProviderConfig = { providerId: string; baseUrl: string; apiKey: string; model: string; format: ApiFormat };
export type ChatImage = { mime: string; base64: string; /** Local file, for on-device models. */ uri?: string };
/**
 * One turn. An assistant turn may carry `toolCalls`; a `tool` turn answers one of them by `toolCallId`.
 */
export type ChatMessage =
  | { role: 'system' | 'user'; text: string; images?: ChatImage[] }
  | { role: 'assistant'; text: string; images?: ChatImage[]; toolCalls?: ToolCall[] }
  | { role: 'tool'; text: string; toolCallId: string; name: string; images?: undefined };
/** A tool offered to the model: JSON Schema parameters. */
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

/** No first byte by then: the model counts as not answering, which lets fallback move on. */
const FIRST_BYTE_MS = 45_000;

const modelId = (c: ProviderConfig) => (c.providerId === 'gemini' ? c.model.replace(/^models\//, '') : c.model);

export function headers(c: ProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (c.format === 'anthropic') h['anthropic-version'] = '2023-06-01';
  if (!c.apiKey) return h;
  if (c.format === 'anthropic' && c.providerId === 'anthropic') h['x-api-key'] = c.apiKey;
  else h.authorization = `Bearer ${c.apiKey}`;
  return h;
}

const system = (messages: ChatMessage[]) => messages.filter(m => m.role === 'system').map(m => m.text).join('\n\n');
const turns = (messages: ChatMessage[]) => messages.filter(m => m.role !== 'system');

/** Providers take at most 128 tool definitions per request. */
const MAX_TOOLS = 128;

const isGemini = (c: ProviderConfig) => c.providerId === 'gemini' || c.baseUrl.includes('generativelanguage.googleapis.com');

/** Parameters in the strictest schema subset (Gemini's), which every provider accepts; an object when there are none. */
const strictParams = (t: ToolSpec) => geminiSchema(t.parameters) ?? { type: 'object', properties: {} };
/** Parameters as a provider takes them: plain JSON Schema, or the strict subset after a provider refused it. */
const params = (t: ToolSpec, strict: boolean) => (strict ? strictParams(t) : cleanSchema(t.parameters));

/** One tool for Chat Completions; Gemini gets its own schema subset, and no parameters when there are none. */
function chatTool(c: ProviderConfig, t: ToolSpec, strict: boolean) {
  if (!isGemini(c)) return { type: 'function', function: { name: t.name, description: t.description, parameters: params(t, strict) } };
  const parameters = geminiSchema(t.parameters);
  return { type: 'function', function: { name: t.name, description: t.description, ...(parameters ? { parameters } : {}) } };
}

function openaiChat(c: ProviderConfig, messages: ChatMessage[], tools: ToolSpec[], strict: boolean) {
  return {
    model: modelId(c),
    stream: true,
    stream_options: { include_usage: true },
    ...(tools.length ? { tools: tools.slice(0, MAX_TOOLS).map(t => chatTool(c, t, strict)) } : {}),
    messages: messages.map(m => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.text };
      if (m.role === 'assistant' && m.toolCalls?.length)
        return { role: 'assistant', content: m.text || null, tool_calls: m.toolCalls.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args || '{}' }, ...(t.extra ? { extra_content: t.extra } : {}) })) };
      return m.images?.length
        ? { role: m.role, content: [{ type: 'text', text: m.text }, ...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] }
        : { role: m.role, content: m.text };
    }),
  };
}

function responses(c: ProviderConfig, messages: ChatMessage[], tools: ToolSpec[], strict: boolean) {
  return {
    model: c.model,
    instructions: system(messages),
    store: false,
    stream: true,
    ...(tools.length ? { tools: tools.slice(0, MAX_TOOLS).map(t => ({ type: 'function', name: t.name, description: t.description, parameters: params(t, strict) })) } : {}),
    input: turns(messages).flatMap((m): Record<string, unknown>[] => {
      if (m.role === 'tool') return [{ type: 'function_call_output', call_id: m.toolCallId, output: m.text }];
      const content = [
        { type: m.role === 'user' ? 'input_text' : 'output_text', text: m.text },
        ...(m.images ?? []).map(i => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.base64}` })),
      ];
      const said = m.text || m.images?.length ? [{ role: m.role, content }] : [];
      const calls = m.role === 'assistant' ? (m.toolCalls ?? []).map(t => ({ type: 'function_call', call_id: t.id, name: t.name, arguments: t.args || '{}' })) : [];
      return [...said, ...calls];
    }),
  };
}

function anthropic(c: ProviderConfig, messages: ChatMessage[], tools: ToolSpec[], strict: boolean) {
  const sys = system(messages);
  const out: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];
  for (const m of turns(messages)) {
    const parse = (args: string) => {
      try {
        return JSON.parse(args || '{}');
      } catch {
        return {};
      }
    };
    const content: Record<string, unknown>[] =
      m.role === 'tool'
        ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.text }]
        : [
            ...(m.images ?? []).map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })),
            ...(m.text ? [{ type: 'text', text: m.text }] : []),
            ...(m.role === 'assistant' ? (m.toolCalls ?? []).map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: parse(t.args) })) : []),
          ];
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    // Tool results go back as one user turn, right after the assistant turn that asked for them.
    const last = out.at(-1);
    if (last && last.role === role && role === 'user' && m.role === 'tool') last.content.push(...content);
    else out.push({ role, content: content.length ? content : [{ type: 'text', text: '(empty)' }] });
  }
  return {
    model: c.model,
    max_tokens: /claude-3-5/.test(c.model) ? 8192 : /claude-3-/.test(c.model) ? 4096 : 16000,
    stream: true,
    ...(sys ? { system: sys } : {}),
    ...(tools.length ? { tools: tools.slice(0, MAX_TOOLS).map(t => ({ name: t.name, description: t.description, input_schema: params(t, strict) })) } : {}),
    messages: out,
  };
}

/**
 * Streams one reply and returns the tools it asked for. Errors read like the desktop's ("HTTP 429: ..."), so
 * fallback.ts classifies them the same way. `strict` sends tool schemas in the subset every provider accepts.
 */
export async function streamChat(c: ProviderConfig, messages: ChatMessage[], h: StreamHandlers, signal: AbortSignal, tools: ToolSpec[] = [], strict = false): Promise<ToolCall[]> {
  const [path, body] =
    c.format === 'anthropic' ? ['/messages', anthropic(c, messages, tools, strict)] : c.format === 'openai-responses' ? ['/responses', responses(c, messages, tools, strict)] : ['/chat/completions', openaiChat(c, messages, tools, strict)];

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), FIRST_BYTE_MS);
  signal.addEventListener('abort', () => timeout.abort());
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers: headers(c), body: JSON.stringify(body), signal: timeout.signal });
  } catch (err) {
    clearTimeout(timer);
    if (signal.aborted) throw err;
    throw new Error(timeout.signal.aborted ? 'The model did not start answering' : `connection lost: ${String(err)}`);
  }
  if (!res.ok) {
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message ?? j.message ?? j.error ?? text;
    } catch {}
    throw new Error(`HTTP ${res.status}: ${String(msg).slice(0, 400)}`);
  }

  const calls = new CallCollector();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let first = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (first) {
      clearTimeout(timer);
      first = false;
    }
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) parseEvent(c.format, line.slice(5).trim(), h, calls);
    }
  }
  return calls.done();
}

/** The chat models a key can call, same filter as the desktop's models.rs `is_chat_id`. */
export async function listModels(c: ProviderConfig): Promise<string[]> {
  const path = c.providerId === 'openrouter' ? '/models?supported_parameters=tools' : c.providerId === 'anthropic' ? '/models?limit=1000' : '/models';
  const res = await fetch(`${c.baseUrl.replace(/\/$/, '')}${path}`, { headers: headers(c) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = await res.json();
  const items: { id?: string; name?: string; model?: string }[] = json.data ?? json.models ?? (Array.isArray(json) ? json : []);
  return items
    .map(i => (i.id ?? i.name ?? i.model ?? '').trim().replace(c.providerId === 'gemini' ? /^models\// : /^$/, ''))
    .filter(id => id && isChatId(c.providerId, id));
}

const NOT_CHAT = ['embed', 'rerank', 'reward', 'guard', 'safety', 'shield', 'moderation', 'whisper', 'transcribe', 'speech', 'realtime', 'audio', 'dall-e', 'gpt-image', 'imagen', 'imagine', 'sora', 'flux', 'stable-diffusion', 'sdxl', 'video', '-image', 'image-', 'cogview', 'davinci', 'babbage', 'computer-use', 'deep-research', 'search-preview', 'native-audio', '-live-', 'lyria', 'veo-', 'retrieval', 'classifier', 'paddleocr', 'parakeet', 'canary', 'orpheus', 'playai'];
const NOT_CHAT_WORDS = ['asr', 'tts', 'stt', 'clip', 'ocr', 'sd', 'sd3', 'vad', 'parse', 'bge', 'e5', 'aqa'];

// ponytail: the desktop list is longer (science and NVIDIA legacy ids); these cover what phones will see.
export function isChatId(providerId: string, id: string) {
  const lower = id.toLowerCase();
  if (lower.startsWith('ft:') || NOT_CHAT.some(n => lower.includes(n))) return false;
  const words = lower.split(/[^a-z0-9]+/);
  if (NOT_CHAT_WORDS.some(w => words.includes(w))) return false;
  return !(providerId === 'nvidia' && /^(ipd|arc|baai|black-forest-labs|stabilityai|openfold|mit)\//.test(lower));
}
