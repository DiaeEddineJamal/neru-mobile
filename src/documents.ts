import { requireOptionalNativeModule } from 'expo';
import { File } from 'expo-file-system';
import * as FS from 'expo-file-system/legacy';

type Extracted = { text: string; truncated: boolean; format: string };
type Reader = { readDocument(uri: string, name: string, mime: string): Promise<Extracted> };
const native = requireOptionalNativeModule<Reader>('NeruLocalAi');
const cache = new Map<string, Promise<Extracted>>();
const MAX_FILE = 50 * 1024 * 1024;
const textFile = (name: string, mime: string) => mime.startsWith('text/') || /\.(txt|md|csv|tsv|json|xml|ya?ml|toml|html?|log|[jt]sx?|py|rs|go|java|kt|swift|cpp|c|h|cs|rb|php|sh|sql|css)$/i.test(name);

/** The model receives extracted text, never an opaque Office/PDF filename or binary base64. */
export function readDocument(uri: string, name: string, mime: string): Promise<Extracted> {
  const file = new File(uri);
  if (!file.exists) return Promise.reject(new Error('This file is no longer available. Attach it again.'));
  if (file.size > MAX_FILE) return Promise.reject(new Error('Documents can be up to 50 MB. Split this file into smaller documents.'));
  const key = `${uri}|${file.size}|${file.modificationTime}`;
  const previous = cache.get(key);
  if (previous) return previous;
  const task = (async () => {
    if (native?.readDocument) return native.readDocument(uri, name, mime);
    if (textFile(name, mime)) {
      if (file.size > 1_000_000) throw new Error('Install the updated Android build to read large documents.');
      const text = await file.text();
      return { text: text.slice(0, 200_000), truncated: text.length > 200_000, format: 'text' };
    }
    throw new Error('Install the updated Neru Android build to read PDF, Word, PowerPoint and Excel documents.');
  })().catch(error => { cache.delete(key); throw error; });
  cache.set(key, task);
  while (cache.size > 4) cache.delete(cache.keys().next().value!);
  return task;
}

/** Drive downloads stream to app cache and are removed after extraction. */
export async function downloadDocument(url: string, name: string, mime: string, accessToken: string): Promise<string> {
  if (!FS.cacheDirectory) throw new Error('Document storage is unavailable.');
  const uri = `${FS.cacheDirectory}drive-${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  let tooLarge = false;
  const task = FS.createDownloadResumable(url, uri, { headers: { Authorization: `Bearer ${accessToken}` } }, progress => {
    if (progress.totalBytesWritten > MAX_FILE) { tooLarge = true; void task.pauseAsync(); }
  });
  try {
    const result = await task.downloadAsync();
    if (tooLarge) throw new Error('This Drive document is larger than 50 MB.');
    if (!result || result.status !== 200) throw new Error(`Drive download failed (${result?.status ?? 'interrupted'}).`);
    return (await readDocument(uri, name, mime)).text;
  } finally {
    for (const key of cache.keys()) if (key.startsWith(`${uri}|`)) cache.delete(key);
    await FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
