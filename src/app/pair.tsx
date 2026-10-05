import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { pair, unpair, useRemote } from '@/remote/store';
import { font, fs, useColors } from '@/theme';
import { AnimatedBadge } from '@/ui/animated-badge';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { useToast } from '@/ui/toast';

export default function Pair() {
  const c = useColors();
  const toast = useToast();
  const remote = useRemote(s => s);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const pending = useRef(false);

  const connect = async (value: string) => {
    if (pending.current) return;
    pending.current = true;
    setConnecting(true);
    setScanning(false); // the scanner fires every frame; one read is enough
    setError(undefined);
    try {
      await pair(value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanning(false);
      toast.show({ title: 'Desktop connected', description: 'Choose Code or Team in the Desktop tab.' });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { pending.current = false; setConnecting(false); }
  };

  const scan = async () => {
    if (!permission?.granted && !(await requestPermission()).granted) return setError('Allow camera access to scan the code, or paste it below.');
    setScanning(true);
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {remote.desktopName ? (
        <View style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{remote.desktopName}</Text>
          <AnimatedBadge status={remote.status === 'connected' ? 'done' : remote.status === 'connecting' ? 'running' : 'failed'} label={remote.status === 'connected' ? `Connected${remote.host ? ` · ${remote.host}` : ''}` : remote.status === 'connecting' ? 'Connecting' : 'Offline'} />
          {remote.status !== 'connected' ? (
            <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 20 }}>
              Keep the computer awake with Neru open. To connect from another network, enable “Connect over the internet” in desktop Settings → Phone and scan its updated pairing code.
            </Text>
          ) : null}
          <ActionButton title="Unpair" variant="destructive" onPress={() => (unpair(), toast.show({ title: 'Desktop unpaired' }))} />
        </View>
      ) : null}

      <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 22 }}>
        On your computer, open Neru, then Settings → Phone, and turn on pairing. Scan the code it shows.
      </Text>

      {scanning ? (
        <View style={s.camera}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={r => r.data.startsWith('neru://pair') && connect(r.data)} />
        </View>
      ) : (
        <ActionButton title="Scan the pairing code" icon="qr" onPress={scan} />
      )}

      <TextField label="Or paste the pairing text" value={code} onChangeText={setCode} placeholder="neru://pair?..." autoCapitalize="none" autoCorrect={false} error={error} />
      <ActionButton title={connecting ? 'Connecting to desktop' : 'Pair'} loading={connecting} variant="secondary" disabled={!code.trim()} onPress={() => connect(code)} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { padding: 16, gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  camera: { aspectRatio: 1, borderRadius: 20, overflow: 'hidden' },
});
