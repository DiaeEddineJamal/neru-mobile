import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { useRemote } from '@/remote/store';
import { deleteAllChats, modelLabel, setModelSheet, updateSettings, useStore, type Settings as S } from '@/store';
import { useToast } from '@/ui/toast';
import { font, fs, TAP, useColors } from '@/theme';
import { SelectSheet } from '@/ui/select';
import { Switch } from '@/ui/switch';

const themes = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];
const languages = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'ar-MA', label: 'العربية (المغرب)' },
  { value: 'es-ES', label: 'Español' },
  { value: 'de-DE', label: 'Deutsch' },
];

export default function Settings() {
  const c = useColors();
  const settings = useStore(s => s.settings);
  const keyed = useStore(s => s.keyed.length);
  const desktop = useRemote(s => s.desktopName);
  const [sheet, setSheet] = useState<'theme' | 'voice' | null>(null);
  const toast = useToast();
  const chats = useStore(s => s.chats.length);

  const confirmDeleteAll = () =>
    Alert.alert('Delete all chats?', `This removes ${chats} chat${chats === 1 ? '' : 's'} from this phone. It can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete all', style: 'destructive', onPress: () => (deleteAllChats(), toast.show({ title: 'All chats deleted' })) },
    ]);

  const row = (label: string, value: string | undefined, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.row}>
      <Text style={[s.label, { color: c.text }]}>{label}</Text>
      {value ? <Text numberOfLines={1} style={[s.value, { color: c.muted }]}>{value}</Text> : null}
      <Icon name="chevronRight" size={18} color={c.muted} />
    </Pressable>
  );
  const group = (title: string, children: ReactNode[]) => (
    <View style={{ marginTop: 24 }}>
      <Text accessibilityRole="header" style={[s.heading, { color: c.muted }]}>{title}</Text>
      <View style={[s.group, { backgroundColor: c.surface2, borderColor: c.border }]}>{children}</View>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {group('Models', [
        row('Model', modelLabel(settings), () => setModelSheet(true)),
        row('Pocket Lab', 'Models that run offline', () => router.push('/models')),
        row('Providers and API keys', keyed ? `${keyed} saved` : 'None yet', () => router.push('/providers')),
        <View key="fallback" style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.text }]}>Switch models when one runs out</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>Moves to the next free model on your keys</Text>
          </View>
          <Switch value={settings.fallback} onValueChange={v => updateSettings({ fallback: v })} accessibilityLabel="Switch models when one runs out" />
        </View>,
      ])}
      {group('Desktop', [row('Paired desktop', desktop ?? 'Not paired', () => router.push('/pair'))])}
      {group('App', [
        row('Appearance', themes.find(t => t.value === settings.theme)?.label, () => setSheet('theme')),
        row('Dictation language', languages.find(l => l.value === settings.voiceLang)?.label ?? settings.voiceLang, () => setSheet('voice')),
      ])}
      {group('Data', [
        <Pressable key="del" onPress={confirmDeleteAll} disabled={!chats} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.row}>
          <Text style={[s.label, { color: chats ? c.danger : c.muted }]}>Delete all chats</Text>
        </Pressable>,
      ])}
      {group('About', [
        row("What's new", undefined, () => router.push('/changelog')),
        <View key="v" style={s.row}>
          <Text style={[s.label, { color: c.text }]}>Version</Text>
          <Text style={[s.value, { color: c.muted }]}>{Constants.expoConfig?.version}</Text>
        </View>,
      ])}

      <SelectSheet open={sheet === 'theme'} onClose={() => setSheet(null)} title="Appearance" options={themes} value={settings.theme} onChange={v => (updateSettings({ theme: v as S['theme'] }), setSheet(null))} />
      <SelectSheet open={sheet === 'voice'} onClose={() => setSheet(null)} title="Dictation language" options={languages} value={settings.voiceLang} onChange={v => (updateSettings({ voiceLang: v }), setSheet(null))} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  heading: { fontFamily: font.medium, fontSize: fs.xs, paddingHorizontal: 4, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP + 8, paddingHorizontal: 16, paddingVertical: 6 },
  label: { flex: 1, fontFamily: font.sans, fontSize: fs.base },
  value: { fontFamily: font.sans, fontSize: fs.sm, maxWidth: '50%' },
});
