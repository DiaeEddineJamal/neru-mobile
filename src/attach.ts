// Camera, photo library and file picks, turned into chat attachments.
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { kvGetSync, kvSet } from '@/db';
import { appendDraftPhotos, flushComposerDraft } from '@/drafts';
import type { Attachment } from '@/store';
import { uid } from '@/store';
import { notice } from '@/ui/confirm';
import { t } from '@/i18n';

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

// Android may kill Neru while the camera app is open; the photo then arrives after a cold start.
// Remember which screen asked for it so the restart can put it back there: a chat id, 'new' for the home screen,
// 'desktop:<session id>' for a desktop session, or 'task' for New desktop task.
const CAMERA_CHAT = 'camera.chat';
let pickerActive = false;

async function imagePick(target: string | null, launch: () => Promise<ImagePicker.ImagePickerResult>): Promise<Attachment[]> {
  if (pickerActive) return [];
  pickerActive = true;
  try {
    await flushComposerDraft(target ?? 'new');
    await kvSet(CAMERA_CHAT, target ?? 'new');
    const r = await launch();
    const photos = r.canceled ? [] : r.assets.map(fromImage);
    // Persist before clearing the recovery marker or returning to a possibly remounted screen.
    await appendDraftPhotos(target ?? 'new', photos);
    await kvSet(CAMERA_CHAT, '');
    return photos;
  } catch (error) {
    await kvSet(CAMERA_CHAT, '');
    throw error;
  } finally { pickerActive = false; }
}

export async function takePhoto(target: string | null): Promise<Attachment[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return (void notice({ title: t('Allow the camera'), message: t('Neru needs the camera to take a photo for your message. You can allow it in your phone’s settings.'), icon: 'camera', settings: true }), []);
  return imagePick(target, () => ImagePicker.launchCameraAsync(IMAGE));
}

/** The screen a photo was being taken for when Neru was killed, if any (see CAMERA_CHAT). */
export const cameraChat = () => pickerActive ? null : kvGetSync(CAMERA_CHAT) || null;

/** After a cold start, the photo taken for this chat before Neru was killed. */
let recovery: Promise<Attachment[]> | null = null;
export function recoverPhoto(): Promise<Attachment[]> {
  if (!recovery) recovery = recoverPendingPhoto().finally(() => { recovery = null; });
  return recovery;
}
async function recoverPendingPhoto(): Promise<Attachment[]> {
  const target = cameraChat();
  if (!target) return [];
  const r = await ImagePicker.getPendingResultAsync().catch(() => null);
  const photos = r && 'assets' in r && !r.canceled ? r.assets.map(fromImage) : [];
  await appendDraftPhotos(target, photos);
  await kvSet(CAMERA_CHAT, '');
  return photos;
}

export async function pickPhotos(target: string | null = null): Promise<Attachment[]> {
  return imagePick(target, () => ImagePicker.launchImageLibraryAsync({ ...IMAGE, mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 }));
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

/** Images as the desktop's composer takes them: a name and a data URL. Files that are gone are skipped. */
export async function toPhoneImages(items: Attachment[]) {
  const images = await Promise.all(
    items.filter(a => a.kind === 'image').map(async a => {
      const base64 = a.base64 ?? (await new File(a.uri).base64().catch(() => null));
      return base64 ? { name: a.name, dataUrl: `data:${a.mime};base64,${base64}` } : null;
    }),
  );
  return images.filter(i => i !== null);
}
