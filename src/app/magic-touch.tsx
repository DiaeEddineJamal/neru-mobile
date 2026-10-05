import { requireOptionalNativeModule } from 'expo';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { configForLocal } from '@/local/config';
import { installedUri } from '@/local/models';
import { font, fs, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { useToast } from '@/ui/toast';

export default function MagicTouch() {
  const c = useColors();
  const toast = useToast();
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ width: 1, height: 1 });
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const error = (e: unknown) => toast.show({ title: 'Magic Touch', description: e instanceof Error ? e.message : String(e) });
  const pick = async () => {
    const chosen = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!chosen.canceled) { setPhoto(chosen.assets[0]); setResult(''); setPoint(null); }
  };
  const segment = async (x: number, y: number) => {
    if (!photo || busy) return;
    setBusy(true); setPoint({ x, y });
    try {
      const native = requireOptionalNativeModule<{ segment(model: string, image: string, x: number, y: number, accelerator: string): Promise<string> }>('NeruLocalAi');
      if (!native) throw new Error('Install the Neru Android build first.');
      setResult(await native.segment(await installedUri('magic-touch'), photo.uri, x, y, configForLocal('magic-touch').accelerator));
    } catch (e) { error(e); }
    finally { setBusy(false); }
  };
  return <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 20 }}>
    <Text style={{ fontFamily: font.serif, fontSize: 30, color: c.text }}>A little touch of magic.</Text>
    <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 23, color: c.secondary }}>Choose a photo, then tap the object you want to keep. The model creates a transparent cutout on your phone, entirely offline.</Text>
    <ActionButton title="Choose a photo" icon="photo" disabled={busy} onPress={() => void pick().catch(error)} />
    {photo ? <Pressable disabled={busy} accessibilityRole="imagebutton" accessibilityLabel="Photo to segment" accessibilityHint="Tap the object you want to select" onLayout={e => setBox(e.nativeEvent.layout)} onPress={e => void segment(Math.max(0, Math.min(1, e.nativeEvent.locationX / box.width)), Math.max(0, Math.min(1, e.nativeEvent.locationY / box.height)))} style={{ width: '100%', aspectRatio: photo.width / photo.height, borderRadius: 20, overflow: 'hidden' }}>
      <Image source={{ uri: photo.uri }} contentFit="fill" style={{ width: '100%', height: '100%' }} />
      {point ? <View pointerEvents="none" style={{ position: 'absolute', left: `${point.x * 100}%`, top: `${point.y * 100}%`, marginLeft: -8, marginTop: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: c.mossAction, borderWidth: 2, borderColor: '#fff' }} /> : null}
    </Pressable> : null}
    {busy ? <Text accessibilityLiveRegion="polite" style={{ color: c.muted }}>Selecting the object…</Text> : null}
    {result && photo ? <><Image source={{ uri: result }} contentFit="contain" style={{ width: '100%', aspectRatio: photo.width / photo.height, backgroundColor: c.surface2, borderRadius: 20 }} /><ActionButton title="Share cutout" onPress={() => void Sharing.shareAsync(result, { mimeType: 'image/png' }).catch(error)} /></> : null}
  </ScrollView>;
}
