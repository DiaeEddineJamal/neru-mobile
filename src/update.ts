// New versions ship as GitHub releases of this repo, each with the Android APK attached. On launch Neru asks
// GitHub for the latest release and offers it when it is newer than the running build, then downloads and installs
// it in place.
import Constants from 'expo-constants';
import * as FS from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import { useSyncExternalStore } from 'react';
import { Linking, Platform } from 'react-native';

const LATEST = 'https://api.github.com/repos/DiaeEddineJamal/neru-mobile/releases/latest';

export type Update = { version: string; title: string; notes: string; url: string };

// The release currently on offer, shared by the launch check and Settings → Check for updates.
let offered: Update | null = null;
const listeners = new Set<() => void>();
export const offerUpdate = (u: Update | null) => ((offered = u), listeners.forEach(l => l()));
export const useOfferedUpdate = () => useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => offered);

const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);

/** True when `a` is a later version than `b` (major.minor.patch). */
export function isNewer(a: string, b: string) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export async function checkForUpdate(current = Constants.expoConfig?.version ?? '0.0.0'): Promise<Update | null> {
  try {
    const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const r = (await res.json()) as { tag_name: string; name?: string; body?: string; html_url: string; assets?: { name: string; browser_download_url: string }[] };
    if (!isNewer(r.tag_name, current)) return null;
    const apk = r.assets?.find(a => a.name.endsWith('.apk'));
    return { version: r.tag_name.replace(/^v/, ''), title: r.name ?? `Neru ${r.tag_name}`, notes: r.body ?? '', url: apk?.browser_download_url ?? r.html_url };
  } catch {
    return null; // offline or rate-limited: try again next launch
  }
}

const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Downloads the release's APK inside Neru, with progress, and hands it to Android's installer, which asks once to
 * allow installs from Neru. Releases without an APK, and other platforms, open the release page instead.
 */
export async function installUpdate(u: Update, onProgress: (fraction: number) => void) {
  if (Platform.OS !== 'android' || !u.url.endsWith('.apk')) return void (await Linking.openURL(u.url));
  const file = `${FS.cacheDirectory}Neru-${u.version}.apk`;
  const have = await FS.getInfoAsync(file);
  if (!have.exists) {
    // A finished download is renamed into place, so a cut-off one is never mistaken for the APK.
    const part = `${file}.part`;
    const task = FS.createDownloadResumable(u.url, part, {}, p => p.totalBytesExpectedToWrite > 0 && onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite));
    const done = await task.downloadAsync().catch(async err => { await FS.deleteAsync(part, { idempotent: true }); throw err; });
    if (!done || done.status !== 200) {
      await FS.deleteAsync(part, { idempotent: true });
      throw new Error(`HTTP ${done?.status ?? 0}`);
    }
    await FS.moveAsync({ from: part, to: file });
  }
  onProgress(1);
  await startActivityAsync('android.intent.action.VIEW', { data: await FS.getContentUriAsync(file), type: 'application/vnd.android.package-archive', flags: FLAG_GRANT_READ_URI_PERMISSION });
}
