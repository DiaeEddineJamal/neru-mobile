import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { ChatMessage } from '@/llm/stream';
import { installedUri } from '@/local/models';
import { configForLocal } from '@/local/config';
import type { LocalConfig } from '@/local/catalog';

type LocalNative = {
  generate(id: string, uri: string, messages: { role: string; text: string }[], config: LocalConfig): Promise<void>;
  cancel(): void;
  unload(): Promise<void>;
  addListener(event: 'token' | 'status', listener: (event: { requestId: string; text?: string; reasoning?: string; phase?: string }) => void): { remove(): void };
};
const native = requireOptionalNativeModule<LocalNative>('NeruLocalAi');
export const localAvailable = Platform.OS === 'android' && !!native;

export async function streamLocal(model: string, messages: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal, onStatus: (phase: string) => void, onReasoning: (text: string) => void) {
  if (!native || !localAvailable) throw new Error('On-device models need the Neru Android build with LiteRT-LM.');
  if (messages.some(m => m.images?.length)) throw new Error('On-device chat currently supports text and documents. Choose a cloud model for photos.');
  if (signal.aborted) return;
  const uri = await installedUri(model);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tokens = native.addListener('token', e => { if (e.requestId !== id || signal.aborted) return; if (e.text) onDelta(e.text); if (e.reasoning) onReasoning(e.reasoning); });
  const status = native.addListener('status', e => { if (e.requestId === id && e.phase && !signal.aborted) onStatus(e.phase); });
  const cancel = () => native.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try { await native.generate(id, uri, messages.map(m => ({ role: m.role, text: m.text })), configForLocal(model)); }
  finally { signal.removeEventListener('abort', cancel); tokens.remove(); status.remove(); }
}
export const unloadLocal = async () => { await native?.unload(); };
