import * as Device from 'expo-device';
import { requireOptionalNativeModule } from 'expo';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { localModel, localModels, modelUrl, type LocalModel } from '@/local/catalog';

export type Download = { phase: 'available' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'error'; progress: number; error?: string; note?: string };

// A dropped connection or a busy server is retried on its own, for as long as the download is not paused,
// and every retry resumes from the bytes already saved. Waits grow to 30 s and reset once bytes flow again.
const RETRY_SECONDS = [2, 4, 8, 15, 30];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
class Transient extends Error {}
/** A gated model: 401 means sign in to Hugging Face, 403 means accept the model's license there. */
export class GatedError extends Error {
  constructor(readonly status: 401 | 403) { super(status === 401 ? 'This model needs a Hugging Face account. Add your access token under Hugging Face below, then download again.' : 'Accept this model’s license on Hugging Face to download it.'); }
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
const partialOf = (m: LocalModel) => `${uriOf(m)}.partial`;
// The partial file is the resume point: Android's resumable download continues from a byte offset, and the
// module only reports one after a pause, so after a dropped connection (or the app closing) read it from disk.
const savedBytes = async (m: LocalModel) => { const info = await FS.getInfoAsync(partialOf(m)); return info.exists ? info.size : 0; };
const change = (id: string, d: Download) => { states = { ...states, [id]: d }; listeners.forEach(fn => fn()); };
export function useDownloads() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => states);
}
export async function refreshDownloads() {
  for (const m of localModels) {
    if (active.has(m.id)) continue;
    const info = await FS.getInfoAsync(uriOf(m));
    const saved = info.exists && info.size === m.bytes ? 0 : await savedBytes(m);
    change(m.id, info.exists && info.size === m.bytes ? { phase: 'ready', progress: 1 } : saved ? { phase: 'paused', progress: saved / m.bytes } : { phase: 'available', progress: 0 });
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
    const partial = partialOf(m);
    let have = await savedBytes(m);
    if (have > m.bytes) { await FS.deleteAsync(partial, { idempotent: true }); have = 0; }
    const free = await FS.getFreeDiskStorageAsync();
    if (free < m.bytes - have + 300_000_000) throw new Error('Free up storage before downloading this model.');
    // totalBytesWritten already counts the bytes resumed from.
    const onProgress = (p: FS.DownloadProgressData) => change(m.id, { phase: 'downloading', progress: Math.min(1, p.totalBytesWritten / m.bytes) });
    for (let wait = 0; ; ) {
      have = await savedBytes(m);
      if (states[m.id]?.phase === 'paused') return;
      if (have >= m.bytes) break; // every byte is here; the checksum decides
      change(m.id, { phase: 'downloading', progress: have / m.bytes, note: wait ? 'Reconnecting…' : undefined });
      const task = new FS.DownloadResumable(modelUrl(m), partial, { headers }, onProgress, have ? String(have) : undefined);
      tasks.set(m.id, task);
      try {
        const result = await task.downloadAsync();
        if (!result) return; // paused
        if (result.status === 401 || result.status === 403) throw new GatedError(token ? result.status : 401);
        if (result.status === 416) break; // nothing left to send from that offset
        if (have && result.status === 200) {
          // The server ignored the range and sent the whole file onto the end of the partial: start that copy over.
          await FS.deleteAsync(partial, { idempotent: true });
          throw new Transient('The download restarted from the beginning.');
        }
        if (result.status === 429 || result.status >= 500) throw new Transient(`The model server is busy (${result.status}).`);
        if (result.status !== 200 && result.status !== 206) throw new Error(`Download failed (${result.status}).`);
        break;
      } catch (err) {
        if (states[m.id]?.phase === 'paused') return;
        if (err instanceof GatedError || (!(err instanceof Transient) && /^Download failed/.test(err instanceof Error ? err.message : String(err)))) throw err;
        // Bytes arrived since the last try: the connection works, so the next wait starts short again.
        if ((await savedBytes(m)) > have) wait = 0;
        const progress = (await savedBytes(m)) / m.bytes;
        for (let left = RETRY_SECONDS[Math.min(wait, RETRY_SECONDS.length - 1)]; left > 0; left--) {
          if (states[m.id]?.phase === 'paused') return;
          change(m.id, { phase: 'downloading', progress, note: `Connection lost · resuming in ${left}s` });
          await sleep(1000);
        }
        wait++;
      }
    }
    change(m.id, { phase: 'verifying', progress: 1 });
    const info = await FS.getInfoAsync(partial);
    if (!info.exists || info.size !== m.bytes || !(await verify.verifyFile(partial, hash))) {
      await FS.deleteAsync(partial, { idempotent: true });
      throw new Error('The download did not pass its integrity check. Please download it again.');
    }
    await FS.moveAsync({ from: partial, to: uriOf(m) });
    change(m.id, { phase: 'ready', progress: 1 });
  } catch (err) {
    if (states[m.id]?.phase !== 'paused') change(m.id, { phase: 'error', progress: states[m.id]?.progress ?? 0, error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally { tasks.delete(m.id); active.delete(m.id); }
}
export async function pauseDownload(id: string) {
  const task = tasks.get(id);
  const m = localModel(id);
  if (!task || !m) return;
  // Marked first so the download loop stops instead of treating the pause as a dropped connection.
  change(id, { phase: 'paused', progress: states[id]?.progress ?? 0 });
  await task.pauseAsync().catch(() => {});
  change(id, { phase: 'paused', progress: (await savedBytes(m)) / m.bytes });
}
export async function removeModel(id: string) {
  if (active.has(id)) throw new Error('Pause the download before removing it.');
  const m = localModel(id);
  if (!m) return;
  await FS.deleteAsync(uriOf(m), { idempotent: true });
  await FS.deleteAsync(`${uriOf(m)}.partial`, { idempotent: true });
  change(id, { phase: 'available', progress: 0 });
}
