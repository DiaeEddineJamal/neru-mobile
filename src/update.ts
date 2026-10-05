// New versions ship as GitHub releases of this repo, each with the Android APK attached. On launch Neru asks
// GitHub for the latest release and offers it when it is newer than the running build.
import Constants from 'expo-constants';

const LATEST = 'https://api.github.com/repos/DiaeEddineJamal/neru-mobile/releases/latest';

export type Update = { version: string; title: string; notes: string; url: string };

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
