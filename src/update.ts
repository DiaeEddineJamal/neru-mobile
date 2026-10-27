// New versions ship as GitHub releases of this repo, each with the Android APK attached. On launch Neru asks
// GitHub for the latest release and offers it when it is newer than the running build, then downloads and installs
// it in place.
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { supportedCpuArchitectures } from 'expo-device';
import * as FS from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { isNewer, releaseUpdate, type ReleaseInfo, type Update } from '@/update-release';
export { isNewer, type Update };

const RELEASES = 'https://api.github.com/repos/DiaeEddineJamal/neru-mobile/releases?per_page=10';
const native = requireOptionalNativeModule<{ verifyFile(uri: string, hash: string): Promise<boolean> }>('NeruLocalAi');

// The release currently on offer, shared by the launch check and Settings → Check for updates.
let offered: Update | null = null;
const listeners = new Set<() => void>();
export const offerUpdate = (u: Update | null) => ((offered = u), listeners.forEach(l => l()));
export const useOfferedUpdate = () => useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => offered);

export async function checkForUpdate(current = Constants.expoConfig?.version ?? '0.0.0'): Promise<Update | null> {
  try {
    const res = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const releases = (await res.json()) as ReleaseInfo[];
    return releaseUpdate(releases, current, supportedCpuArchitectures ?? []);
  } catch {
    return null; // offline or rate-limited: try again next launch
  }
}

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Downloads the release's APK inside Neru, with progress, and hands it to Android's installer, which asks once to
 * allow installs from Neru. A release without a compatible APK is never offered as an in-app update.
 */
let installing: { version: string; task: Promise<void>; progress: number; listeners: Set<(fraction: number) => void> } | null = null;
export function installUpdate(u: Update, onProgress: (fraction: number) => void): Promise<void> {
  if (installing) {
    if (installing.version !== u.version) return Promise.reject(new Error('An update is already downloading.'));
    installing.listeners.add(onProgress);
    onProgress(installing.progress);
    return installing.task;
  }
  const current = { version: u.version, task: Promise.resolve(), progress: 0, listeners: new Set([onProgress]) };
  installing = current;
  current.task = downloadAndInstall(u, fraction => { current.progress = Math.min(1, Math.max(0, fraction)); current.listeners.forEach(listener => listener(current.progress)); }).finally(() => { if (installing === current) installing = null; });
  return current.task;
}
async function downloadAndInstall(u: Update, onProgress: (fraction: number) => void) {
  if (Platform.OS !== 'android') throw new Error('In-app APK updates are available on Android.');
  if (!u.url || !/^https:\/\//.test(u.url)) throw new Error('This release does not have an APK ready to download. Try checking again later.');
  if (!FS.cacheDirectory) throw new Error('Update storage is unavailable.');
  const file = `${FS.cacheDirectory}Neru-${u.version}.apk`;
  const valid = async (uri: string) => {
    const info = await FS.getInfoAsync(uri);
    return info.exists && info.size > 0 && (!u.size || info.size === u.size) && (!u.sha256 || !!native?.verifyFile && await native.verifyFile(uri, u.sha256));
  };
  let have = await FS.getInfoAsync(file);
  if (have.exists && !await valid(file)) { await FS.deleteAsync(file, { idempotent: true }); have = await FS.getInfoAsync(file); }
  if (!have.exists) {
    // A finished download is renamed into place, so a cut-off one is never mistaken for the APK.
    const part = `${file}.part`;
    const task = FS.createDownloadResumable(u.url, part, {}, p => p.totalBytesExpectedToWrite > 0 && onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite));
    const done = await task.downloadAsync().catch(async err => { await FS.deleteAsync(part, { idempotent: true }); throw err; });
    if (!done || done.status !== 200) {
      await FS.deleteAsync(part, { idempotent: true });
      throw new Error(`HTTP ${done?.status ?? 0}`);
    }
    if (!await valid(part)) { await FS.deleteAsync(part, { idempotent: true }); throw new Error('The downloaded APK is incomplete or failed verification. Please retry.'); }
    await FS.moveAsync({ from: part, to: file });
  }
  onProgress(1);
  await startActivityAsync('android.intent.action.VIEW', { data: await FS.getContentUriAsync(file), type: 'application/vnd.android.package-archive', flags: FLAG_GRANT_READ_URI_PERMISSION });
}
