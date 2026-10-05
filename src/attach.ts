// Camera, photo library and file picks, turned into chat attachments.
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import type { Attachment } from '@/store';
import { uid } from '@/store';
import { notice } from '@/ui/confirm';

// Images go to vision models as base64; keep them modest so a request stays small.
const IMAGE = { quality: 0.7, base64: true } as const;
/** Text files up to this size are sent inline; larger or binary files go by name only. */
const MAX_TEXT = 100_000;

const fromImage = (a: ImagePicker.ImagePickerAsset): Attachment => ({
  id: uid(),
  kind: 'image',
  name: a.fileName ?? 'Photo',
  uri: a.uri,
  mime: a.mimeType ?? 'image/jpeg',
  base64: a.base64 ?? undefined,
});

export async function takePhoto(): Promise<Attachment[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return (void notice({ title: 'Allow the camera', message: 'Neru needs the camera to take a photo for your message. You can allow it in your phone’s settings.', icon: 'camera', settings: true }), []);
  const r = await ImagePicker.launchCameraAsync(IMAGE);
  return r.canceled ? [] : r.assets.map(fromImage);
}

export async function pickPhotos(): Promise<Attachment[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ ...IMAGE, mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 });
  return r.canceled ? [] : r.assets.map(fromImage);
}

const isText = (mime: string, name: string) =>
  mime.startsWith('text/') || /json|xml|javascript|typescript|yaml|toml|csv|markdown/.test(mime) || /\.(md|txt|json|ya?ml|toml|csv|tsx?|jsx?|py|rs|go|java|kt|swift|c|cpp|h|cs|rb|php|sh|sql|html|css)$/i.test(name);

export async function pickFiles(): Promise<Attachment[]> {
  const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (r.canceled) return [];
  return Promise.all(
    r.assets.map(async a => {
      const mime = a.mimeType ?? 'application/octet-stream';
      if (mime.startsWith('image/')) return { id: uid(), kind: 'image' as const, name: a.name, uri: a.uri, mime };
      const text = isText(mime, a.name) && (a.size ?? 0) <= MAX_TEXT ? await new File(a.uri).text().catch(() => undefined) : undefined;
      return { id: uid(), kind: 'file' as const, name: a.name, uri: a.uri, mime, text };
    }),
  );
}
