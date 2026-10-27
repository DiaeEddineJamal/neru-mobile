import { requireOptionalNativeModule } from 'expo';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { ChatMessage } from '@/llm/stream';
import { installedUri } from '@/local/models';
import { configForLocal } from '@/local/config';
import { localModel, type LocalConfig } from '@/local/catalog';
import { t } from '@/i18n';

const MAX_IMAGES = 4;

type LocalNative = {
  /** `images` are local file URIs (app cache/files); the native side downscales them. */
  generate(id: string, uri: string, messages: { role: string; text: string; images: string[] }[], config: LocalConfig & { vision: boolean; reuseConversation: boolean }): Promise<void>;
  /** Loads the model now, so the first reply does not wait for it. */
  load(uri: string, config: LocalConfig & { vision: boolean }): Promise<void>;
  cancel(): void;
  unload(): Promise<void>;
  addListener(event: 'token' | 'status', listener: (event: { requestId: string; text?: string; reasoning?: string; phase?: string }) => void): { remove(): void };
};
const native = requireOptionalNativeModule<LocalNative>('NeruLocalAi');
export const localAvailable = Platform.OS === 'android' && !!native;

// One engine at a time: a phone's memory holds one model.
let running = Promise.resolve();
let pendingReplies = 0;

export async function streamLocal(model: string, messages: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal, onStatus: (phase: string) => void, onReasoning: (text: string) => void, usingTools = false) {
  pendingReplies++;
  cancelPreload();
  const previous = running;
  let release!: () => void;
  running = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { if (!signal.aborted) await runLocal(model, messages, onDelta, signal, onStatus, onReasoning, usingTools); }
  finally { pendingReplies--; release(); }
}

async function runLocal(model: string, messages: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal, onStatus: (phase: string) => void, onReasoning: (text: string) => void, usingTools: boolean) {
  if (!native || !localAvailable) throw new Error(t('On-device models need the Neru Android build with LiteRT-LM.'));
  const info = localModel(model);
  if (!info) throw new Error(t('Unknown model.'));
  if (!info?.vision && messages.some(m => m.images?.length)) throw new Error(t('{model} reads text and documents only. For photos, choose Gemma 4 or Gemma 3n on this phone, or a cloud model.', { model: info?.name ?? t('This model') }));
  if (info.freshEngine) await native.unload();
  if (signal.aborted) return;
  // Each image costs a few hundred context tokens: send only the newest ones whose files still exist.
  let budget = info.maxImages ?? MAX_IMAGES;
  const sent = messages.map(m => ({ role: m.role, text: m.text, images: [] as string[] })).reverse();
  for (const [i, m] of [...messages].reverse().entries()) {
    if (budget <= 0) break;
    const uris = (m.images ?? []).map(img => img.uri).filter((u): u is string => !!u && new File(u).exists);
    sent[i].images = uris.slice(Math.max(0, uris.length - budget));
    budget -= sent[i].images.length;
  }
  sent.reverse();
  const uri = await installedUri(model);
  if (signal.aborted) return;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const split = thinkSplitter(onDelta, onReasoning);
  const tokens = native.addListener('token', e => { if (e.requestId !== id || signal.aborted) return; if (e.text) split(e.text); if (e.reasoning) onReasoning(e.reasoning); });
  const status = native.addListener('status', e => { if (e.requestId === id && e.phase && !signal.aborted) onStatus(e.phase); });
  const cancel = () => native.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  // The native side takes one system prompt from the model's configuration and skips system messages, so
  // fold them in: Neru's instructions, who the user is, or a one-off task such as naming the chat.
  const config = configForLocal(model);
  // Tool lookups need room for returned IDs and database properties as well as the original request.
  if (usingTools) config.maxTokens = Math.min(config.maxTokens, Math.max(128, Math.floor(config.contextTokens / 4)));
  const extra = messages.filter(m => m.role === 'system').map(m => m.text).join('\n\n');
  // Qwen3 reasons at length before every answer unless told not to; its own switch for that is /no_think.
  const quiet = /qwen3/i.test(info.repo) && !config.thinking ? '\n\n/no_think' : '';
  // Repeat the soft switch on each user turn: converted Qwen templates can resume thinking on later turns.
  // Apply it to past user turns too, so their identity still matches the kept native conversation.
  if (quiet) for (const message of sent) if (message.role === 'user') message.text += quiet;
  // Converted Qwen3 caches resume an unclosed thinking channel on the second turn. Rebuild that conversation
  // from visible history in non-thinking mode, while keeping the expensive engine loaded.
  try { await native.generate(id, uri, sent.filter(m => m.role !== 'system'), { ...config, systemPrompt: `${extra ? `${config.systemPrompt}\n\n${extra}` : config.systemPrompt}${quiet}`, vision: !!info?.vision, reuseConversation: !quiet }); }
  finally { if (!signal.aborted) split.flush(); signal.removeEventListener('abort', cancel); tokens.remove(); status.remove(); }
}
export const unloadLocal = async () => { cancelPreload(); await native?.unload(); };

/**
 * Sends text inside <think>…</think> to the reasoning view instead of the answer, for models that write their
 * reasoning inline (Qwen3, DeepSeek R1 distills). A tag split across two pieces is held back until it is whole.
 */
export function thinkSplitter(onText: (text: string) => void, onReasoning: (text: string) => void) {
  let inside = false;
  let held = '';
  const push = (piece: string) => {
    let rest = held + piece;
    held = '';
    while (rest) {
      const tag = inside ? '</think>' : '<think>';
      const at = rest.indexOf(tag);
      if (at >= 0) {
        if (at) (inside ? onReasoning : onText)(rest.slice(0, at));
        rest = rest.slice(at + tag.length);
        inside = !inside;
        continue;
      }
      // Hold back a tail that could be the start of the tag.
      let keep = 0;
      for (let n = Math.min(tag.length - 1, rest.length); n > 0; n--) if (tag.startsWith(rest.slice(-n))) { keep = n; break; }
      const out = rest.slice(0, rest.length - keep);
      if (out) (inside ? onReasoning : onText)(out);
      held = rest.slice(rest.length - keep);
      rest = '';
    }
  };
  return Object.assign(push, { flush: () => { if (held) (inside ? onReasoning : onText)(held); held = ''; } });
}

let preloadTimer: ReturnType<typeof setTimeout> | undefined;
let preloadVersion = 0;
function cancelPreload() {
  preloadVersion++;
  clearTimeout(preloadTimer);
  preloadTimer = undefined;
}
/** Loads an on-device model in the background (when it is picked, or the user starts typing), so the first reply
 * starts at once; a model already loaded costs nothing. Models that need a fresh engine every turn load with their
 * reply instead. */
export function preloadLocal(model: string) {
  const info = localModel(model);
  cancelPreload();
  if (!native || !localAvailable || !info || info.kind !== 'chat' || info.freshEngine || pendingReplies) return;
  const version = preloadVersion;
  // Let a rapid series of picker changes settle; never queue speculative work behind a real reply.
  preloadTimer = setTimeout(() => {
    preloadTimer = undefined;
    void installedUri(model)
      .then(uri => { if (version === preloadVersion && !pendingReplies) return native.load(uri, { ...configForLocal(model), vision: !!info.vision }); })
      .catch(() => {}); // not downloaded, or short of memory: the reply loads it, or says why
  }, 200);
}
