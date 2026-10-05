import * as Device from 'expo-device';
import { requireOptionalNativeModule } from 'expo';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { localModel, localModels, modelUrl, type LocalModel } from '@/local/catalog';

export type Download = { phase: 'available' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'error'; progress: number; error?: string };
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
export async function saveDownloadToken(token: string) { await SecureStore.setItemAsync('models.huggingface', token.trim()); }
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
      if (!metadata.ok) throw new Error(metadata.status === 401 || metadata.status === 403 ? 'Accept the model terms on Hugging Face and save a read token below.' : `Model information could not be fetched (${metadata.status}).`);
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
    const task = new FS.DownloadResumable(modelUrl(m), partial, { headers }, p => change(m.id, { phase: 'downloading', progress: Math.min(1, p.totalBytesWritten / m.bytes) }), resume?.data);
    tasks.set(m.id, task);
    const result = resume ? await task.resumeAsync() : await task.downloadAsync();
    if (!result) return; // paused; the pause handler saved the resume data
    if (result.status !== 200 && result.status !== 206) throw new Error(result.status === 401 || result.status === 403 ? 'Accept the model terms on Hugging Face and add a read token.' : `Download failed (${result.status}).`);
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
  const saved = await task.pauseAsync();
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
