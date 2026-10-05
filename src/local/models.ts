import * as Device from 'expo-device';
import { requireOptionalNativeModule } from 'expo';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { localModel, localModels, modelUrl, type LocalModel } from '@/local/catalog';

export type Download = { phase: 'available' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'error'; progress: number; error?: string; note?: string };

// A dropped connection or a busy server is retried on its own, resuming from the bytes already saved.
const RETRY_SECONDS = [2, 4, 8, 15, 30];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
class Transient extends Error {}
/** A gated model: 401 means sign in to Hugging Face, 403 means accept the model's license there. */
export class GatedError extends Error {
  constructor(readonly status: 401 | 403) { super(status === 401 ? 'Sign in with Hugging Face to download this model.' : 'Accept this model’s license on Hugging Face to download it.'); }
}
let states: Record<string, Download> = {};
const listeners = new Set<() => void>();
const tasks = new Map<string, FS.DownloadResumable>();
const active = new Set<string>();
const directory = () => {
  if (!FS.documentDirectory) throw new Error('Model storage is unavailable on this platform.');
  return `${FS.documentDirectory}models/`;
};
const uriOf = (m: LocalModel) => `${directory()}${m.file}`;
const change = (id: string, d: Download) => { states = { ...states, [id]: d }; listeners.forEach(fn => fn()); };
export function useDownloads() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => states);
}
export async function refreshDownloads() {
  for (const m of localModels) {
    if (active.has(m.id)) continue;
    const info = await FS.getInfoAsync(uriOf(m));
    change(m.id, { phase: info.exists && info.size === m.bytes ? 'ready' : kvGetSync(`model.resume.${m.id}`) ? 'paused' : 'available', progress: info.exists && info.size === m.bytes ? 1 : 0 });
  }
}
export async function installedUri(id: string) {
  const m = localModel(id);
  if (!m) throw new Error('This on-device model is not in the catalog.');
  const info = await FS.getInfoAsync(uriOf(m));
  if (!info.exists || info.size !== m.bytes) throw new Error('Download this model in Settings → Pocket Lab first.');
  return uriOf(m);
}
export const deviceMemoryGB = Device.totalMemory ? Device.totalMemory / 1e9 : null;
export const fitsMemory = (m: LocalModel) => deviceMemoryGB === null || Math.round(deviceMemoryGB) >= m.memory;

export async function downloadModel(m: LocalModel) {
  if (active.size) throw new Error('Finish or pause the current download first.');
  if (!fitsMemory(m)) throw new Error(`Google recommends at least ${m.memory} GB RAM for this model. Choose a smaller model.`);
  const verify = requireOptionalNativeModule<{ verifyFile(uri: string, hash: string): Promise<boolean> }>('NeruLocalAi');
  if (!verify) throw new Error('Install the Neru Android build with on-device model support first.');
  active.add(m.id);
  change(m.id, { phase: 'downloading', progress: 0 });
  try {
    await FS.makeDirectoryAsync(directory(), { intermediates: true });
    const token = await SecureStore.getItemAsync('models.huggingface');
    const headers = token && !m.url ? { Authorization: `Bearer ${token}` } : undefined;
    // Pinned revision metadata supplies the official file hash. No model bytes enter JS memory.
    let hash = m.sha256;
    if (!hash) {
      const metadata = await fetch(`https://huggingface.co/api/models/${m.repo}/revision/${m.revision}?blobs=true`, { headers });
      if (metadata.status === 401 || metadata.status === 403) throw new GatedError(token ? metadata.status : 401);
      if (!metadata.ok) throw new Error(`Model information could not be fetched (${metadata.status}).`);
      const body = await metadata.json() as { siblings: { rfilename: string; lfs?: { sha256: string } }[] };
      hash = body.siblings.find(f => f.rfilename === m.file)?.lfs?.sha256;
    }
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('The model source did not provide a valid checksum.');
    const partial = `${uriOf(m)}.partial`;
    const saved = kvGetSync(`model.resume.${m.id}`);
    const resume = saved ? JSON.parse(saved) as { data: string; progress: number } : null;
    const partialInfo = await FS.getInfoAsync(partial);
    const free = await FS.getFreeDiskStorageAsync();
    if (free < m.bytes - (partialInfo.exists ? partialInfo.size : 0) + 300_000_000) throw new Error('Free up storage before downloading this model.');
    const onProgress = (p: FS.DownloadProgressData) => change(m.id, { phase: 'downloading', progress: Math.min(1, p.totalBytesWritten / m.bytes) });
    let task = new FS.DownloadResumable(modelUrl(m), partial, { headers }, onProgress, resume?.data);
    let result: FS.FileSystemDownloadResult | undefined;
    for (let attempt = 0; ; attempt++) {
      tasks.set(m.id, task);
      try {
        result = attempt === 0 && !resume ? await task.downloadAsync() : await task.resumeAsync();
        if (!result) return; // paused; the pause handler saved the resume data
        if (result.status === 401 || result.status === 403) throw new GatedError(token ? result.status : 401);
        if (result.status === 429 || result.status >= 500) throw new Transient(`The model server is busy (${result.status}).`);
        if (result.status !== 200 && result.status !== 206) throw new Error(`Download failed (${result.status}).`);
        break;
      } catch (err) {
        if (states[m.id]?.phase === 'paused') return;
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof GatedError || (!(err instanceof Transient) && /^Download failed/.test(message))) throw err;
        const data = task.savable().resumeData;
        const progress = states[m.id]?.progress ?? 0;
        if (attempt >= RETRY_SECONDS.length) {
          // Out of retries: keep every byte so Resume picks up where the connection dropped.
          await kvSet(`model.resume.${m.id}`, JSON.stringify({ data, progress }));
          change(m.id, { phase: 'paused', progress, error: 'The connection dropped and Neru could not reconnect. Your progress is saved — tap Resume when you are back online.' });
          return;
        }
        for (let left = RETRY_SECONDS[attempt]; left > 0; left--) {
          if (states[m.id]?.phase === 'paused') return;
          change(m.id, { phase: 'downloading', progress, note: `Connection lost · retrying in ${left}s` });
          await sleep(1000);
        }
        change(m.id, { phase: 'downloading', progress, note: 'Reconnecting…' });
        task = new FS.DownloadResumable(modelUrl(m), partial, { headers }, onProgress, data);
      }
    }
    change(m.id, { phase: 'verifying', progress: 1 });
    const info = await FS.getInfoAsync(partial);
    if (!info.exists || info.size !== m.bytes || !(await verify.verifyFile(partial, hash))) {
      await FS.deleteAsync(partial, { idempotent: true });
      await kvSet(`model.resume.${m.id}`, '');
      throw new Error('The download did not pass its integrity check. Please download it again.');
    }
    await FS.moveAsync({ from: partial, to: uriOf(m) });
    await kvSet(`model.resume.${m.id}`, '');
    change(m.id, { phase: 'ready', progress: 1 });
  } catch (err) {
    if (states[m.id]?.phase !== 'paused') change(m.id, { phase: 'error', progress: states[m.id]?.progress ?? 0, error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally { tasks.delete(m.id); active.delete(m.id); }
}
export async function pauseDownload(id: string) {
  const task = tasks.get(id);
  if (!task) return;
  // While waiting to retry, the task already stopped; its saved state is the resume point.
  const saved = await task.pauseAsync().catch(() => task.savable());
  const progress = states[id]?.progress ?? 0;
  await kvSet(`model.resume.${id}`, JSON.stringify({ data: saved.resumeData, progress }));
  change(id, { phase: 'paused', progress });
}
export async function removeModel(id: string) {
  if (active.has(id)) throw new Error('Pause the download before removing it.');
  const m = localModel(id);
  if (!m) return;
  await FS.deleteAsync(uriOf(m), { idempotent: true });
  await FS.deleteAsync(`${uriOf(m)}.partial`, { idempotent: true });
  await kvSet(`model.resume.${id}`, '');
  change(id, { phase: 'available', progress: 0 });
}
