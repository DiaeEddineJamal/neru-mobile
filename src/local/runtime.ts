import { requireOptionalNativeModule } from 'expo';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { ChatMessage } from '@/llm/stream';
import { installedUri } from '@/local/models';
import { configForLocal } from '@/local/config';
import { localModel, type LocalConfig } from '@/local/catalog';

const MAX_IMAGES = 4;

type LocalNative = {
  /** `images` are local file URIs (app cache/files); the native side downscales them. */
  generate(id: string, uri: string, messages: { role: string; text: string; images: string[] }[], config: LocalConfig & { vision: boolean }): Promise<void>;
  cancel(): void;
  unload(): Promise<void>;
  addListener(event: 'token' | 'status', listener: (event: { requestId: string; text?: string; reasoning?: string; phase?: string }) => void): { remove(): void };
};
const native = requireOptionalNativeModule<LocalNative>('NeruLocalAi');
export const localAvailable = Platform.OS === 'android' && !!native;

export async function streamLocal(model: string, messages: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal, onStatus: (phase: string) => void, onReasoning: (text: string) => void) {
  if (!native || !localAvailable) throw new Error('On-device models need the Neru Android build with LiteRT-LM.');
  const info = localModel(model);
  if (!info?.vision && messages.some(m => m.images?.length)) throw new Error(`${info?.name ?? 'This model'} reads text and documents only. For photos, choose Gemma 4 or Gemma 3n on this phone, or a cloud model.`);
  if (signal.aborted) return;
  // Each image costs a few hundred context tokens: send only the newest ones whose files still exist.
  let budget = MAX_IMAGES;
  const sent = messages.map(m => ({ role: m.role, text: m.text, images: [] as string[] })).reverse();
  for (const [i, m] of [...messages].reverse().entries()) {
    const uris = (m.images ?? []).map(img => img.uri).filter((u): u is string => !!u && new File(u).exists);
    sent[i].images = uris.slice(Math.max(0, uris.length - budget));
    budget -= sent[i].images.length;
  }
  sent.reverse();
  const uri = await installedUri(model);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tokens = native.addListener('token', e => { if (e.requestId !== id || signal.aborted) return; if (e.text) onDelta(e.text); if (e.reasoning) onReasoning(e.reasoning); });
  const status = native.addListener('status', e => { if (e.requestId === id && e.phase && !signal.aborted) onStatus(e.phase); });
  const cancel = () => native.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try { await native.generate(id, uri, sent, { ...configForLocal(model), vision: !!info?.vision }); }
  finally { signal.removeEventListener('abort', cancel); tokens.remove(); status.remove(); }
}
export const unloadLocal = async () => { await native?.unload(); };
