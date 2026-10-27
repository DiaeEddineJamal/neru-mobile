export type ReleaseAsset = { name: string; browser_download_url: string; size?: number; digest?: string };
export type ReleaseInfo = { tag_name: string; name?: string; body?: string; html_url: string; draft?: boolean; prerelease?: boolean; assets?: ReleaseAsset[] };
export type Update = { version: string; title: string; notes: string; url: string; releaseUrl?: string; size?: number; sha256?: string };
export function isNewer(a: string, b: string) {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
/** A release is installable only once its matching APK is uploaded. Never turn a web page into a download. */
export function releaseUpdate(releases: ReleaseInfo[], current: string, abis: readonly string[] = []): Update | null {
  for (const release of releases) {
    if (release.draft || release.prerelease || !isNewer(release.tag_name, current)) continue;
    const assets = (release.assets ?? []).filter(a => /\.apk$/i.test(a.name) && /^https:\/\//.test(a.browser_download_url));
    const compatible = assets.filter(a => {
      if (/arm64|aarch64/i.test(a.name)) return abis.includes('arm64-v8a');
      if (/x86_64|x64/i.test(a.name)) return abis.includes('x86_64');
      if (/armeabi|armv7/i.test(a.name)) return abis.includes('armeabi-v7a');
      return true;
    });
    const apk = compatible.find(a => /universal/i.test(a.name)) ?? compatible[0];
    if (!apk) continue;
    return { version: release.tag_name.replace(/^v/, ''), title: release.name ?? `Neru ${release.tag_name}`, notes: release.body ?? '', url: apk.browser_download_url, releaseUrl: release.html_url, size: apk.size, sha256: apk.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1] };
  }
  return null;
}
