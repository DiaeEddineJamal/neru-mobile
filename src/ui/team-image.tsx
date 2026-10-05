// A Team member's generated image: the Grid Reveal loading state while the agent draws or the picture is on its
// way from the desktop, then the picture itself, which opens full screen and saves to the phone's gallery.
import * as FS from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptic } from '@/haptics';
import { teamImage } from '@/remote/store';
import { ActionButton } from '@/ui/button-base';
import { GridReveal } from '@/ui/grid-reveal';
import { ImageViewer } from '@/ui/image-viewer';
import { useToast } from '@/ui/toast';

// Fetched once per image for the life of the app; the thread re-renders often while a team works.
const cache = new Map<string, Promise<string>>();
const load = (taskId: string, name: string) => {
  const key = `${taskId}/${name}`;
  if (!cache.has(key)) cache.set(key, teamImage(taskId, name).catch(err => (cache.delete(key), Promise.reject(err))));
  return cache.get(key)!;
};

/** Saves a data-URI image to the gallery, asking for permission to add photos the first time. */
async function saveToGallery(dataUri: string, name: string) {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new Error('Allow Neru to add photos in your phone’s settings to save images.');
  const file = `${FS.cacheDirectory}${name}`;
  await FS.writeAsStringAsync(file, dataUri.slice(dataUri.indexOf(',') + 1), { encoding: FS.EncodingType.Base64 });
  try { await MediaLibrary.Asset.create(file); }
  finally { await FS.deleteAsync(file, { idempotent: true }); }
}

/** The grid alone, while an agent is still drawing. */
export function DrawingImage() {
  return <View style={s.frame}><GridReveal uri={null} caption="Creating image" estimatedDuration={45000} /></View>;
}

export function TeamImage({ taskId, name }: { taskId: string; name: string }) {
  const toast = useToast();
  const [uri, setUri] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    load(taskId, name).then(u => live && setUri(u), err => live && toast.show({ title: 'Could not load the image', description: String(err?.message ?? err) }));
    return () => { live = false; };
  }, [taskId, name, toast]);

  const save = async () => {
    if (!uri) return;
    setSaving(true);
    try { await saveToGallery(uri, name); haptic.success(); toast.show({ title: 'Saved to your gallery' }); }
    catch (err) { toast.show({ title: 'Could not save the image', description: err instanceof Error ? err.message : String(err) }); }
    finally { setSaving(false); }
  };

  return (
    <View style={[s.frame, { gap: 8 }]}>
      <Pressable onPress={() => uri && setOpen(true)} disabled={!uri} accessibilityRole="imagebutton" accessibilityLabel="Generated image. Open full screen">
        <GridReveal uri={uri} alt="Generated image" caption="Loading image" estimatedDuration={4000} />
      </Pressable>
      {uri ? <ActionButton title="Save to gallery" icon="download" variant="secondary" loading={saving} onPress={() => void save()} /> : null}
      <ImageViewer images={uri ? [{ uri, name }] : []} index={open ? 0 : null} onClose={() => setOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  frame: { width: '100%', maxWidth: 360 },
});
