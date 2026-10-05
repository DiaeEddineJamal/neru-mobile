// Streaming chat for the three API formats Neru speaks, ported from app/src-tauri/src/providers.rs
// (chat only: the phone sends no tools).
import { fetch } from 'expo/fetch';

import type { ApiFormat } from '@/shared/providerCatalog';

export type ProviderConfig = { providerId: string; baseUrl: string; apiKey: string; model: string; format: ApiFormat };
export type ChatImage = { mime: string; base64: string };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; text: string; images?: ChatImage[] };
export type StreamHandlers = { onDelta: (text: string) => void; onReasoning?: (text: string) => void };

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

function openaiChat(c: ProviderConfig, messages: ChatMessage[]) {
  return {
    model: modelId(c),
    stream: true,
    messages: messages.map(m =>
      m.images?.length
        ? { role: m.role, content: [{ type: 'text', text: m.text }, ...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] }
        : { role: m.role, content: m.text },
    ),
  };
}

function responses(c: ProviderConfig, messages: ChatMessage[]) {
  return {
    model: c.model,
    instructions: system(messages),
    store: false,
    stream: true,
    input: turns(messages).map(m => ({
      role: m.role,
      content: [
        { type: m.role === 'user' ? 'input_text' : 'output_text', text: m.text },
        ...(m.images ?? []).map(i => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.base64}` })),
      ],
    })),
  };
}

function anthropic(c: ProviderConfig, messages: ChatMessage[]) {
  const sys = system(messages);
  return {
    model: c.model,
    max_tokens: /claude-3-5/.test(c.model) ? 8192 : /claude-3-/.test(c.model) ? 4096 : 16000,
    stream: true,
    ...(sys ? { system: sys } : {}),
    messages: turns(messages).map(m => ({
      role: m.role,
      content: [
        ...(m.images ?? []).map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })),
        { type: 'text', text: m.text },
      ],
    })),
  };
}

/** Pulls text out of one SSE `data:` payload for the given format. */
export function parseEvent(format: ApiFormat, data: string, h: StreamHandlers) {
  if (data === '[DONE]') return;
  const e = JSON.parse(data);
  if (e.error) throw new Error(`stream failed: ${typeof e.error === 'string' ? e.error : (e.error.message ?? JSON.stringify(e.error))}`);
  if (format === 'anthropic') {
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') h.onDelta(e.delta.text);
    if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta') h.onReasoning?.(e.delta.thinking);
  } else if (format === 'openai-responses') {
    if (e.type === 'response.output_text.delta') h.onDelta(e.delta);
    if (e.type === 'response.reasoning_summary_text.delta' || e.type === 'response.reasoning_text.delta') h.onReasoning?.(e.delta);
    if (e.type === 'response.failed') throw new Error(`stream failed: ${e.response?.error?.message ?? 'response failed'}`);
  } else {
    const d = e.choices?.[0]?.delta;
    if (d?.content) h.onDelta(d.content);
    const r = d?.reasoning_content ?? d?.reasoning;
    if (typeof r === 'string' && r) h.onReasoning?.(r);
  }
}

/** Streams one reply. Errors read like the desktop's ("HTTP 429: ..."), so fallback.ts classifies them the same way. */
export async function streamChat(c: ProviderConfig, messages: ChatMessage[], h: StreamHandlers, signal: AbortSignal) {
  const [path, body] =
    c.format === 'anthropic' ? ['/messages', anthropic(c, messages)] : c.format === 'openai-responses' ? ['/responses', responses(c, messages)] : ['/chat/completions', openaiChat(c, messages)];

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
      if (line.startsWith('data:')) parseEvent(c.format, line.slice(5).trim(), h);
    }
  }
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
