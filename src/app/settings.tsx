import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { useRemote } from '@/remote/store';
import { deleteAllChats, modelLabel, setModelSheet, updateSettings, useStore, type Settings as S } from '@/store';
import { useToast } from '@/ui/toast';
import { font, fs, paletteColors, palettes, TAP, useBottomPad, useColors } from '@/theme';
import { confirm } from '@/ui/confirm';
import { SelectSheet } from '@/ui/select';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { Switch } from '@/ui/switch';
import { checkForUpdate, offerUpdate } from '@/update';
import * as Notifications from 'expo-notifications';
import { askForNotifications } from '@/notify';

const themes = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];
const genders = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
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
  const bottomPad = useBottomPad();
  const settings = useStore(s => s.settings);
  const keyed = useStore(s => s.keyed.length);
  const desktop = useRemote(s => s.desktopName);
  const [sheet, setSheet] = useState<'theme' | 'palette' | 'voice' | 'gender' | 'name' | null>(null);
  const [name, setName] = useState(settings.name ?? '');
  const saveName = () => { updateSettings({ name: name.trim() || undefined }); setSheet(null); };
  const toast = useToast();
  const chats = useStore(s => s.chats.length);
  const [checking, setChecking] = useState<'idle' | 'checking' | 'latest' | 'offline'>('idle');
  const [notifications, setNotifications] = useState<boolean | null>(null);
  useEffect(() => { void Notifications.getPermissionsAsync().then(p => setNotifications(p.granted)); }, []);
  // Asks when Android still can; otherwise only the phone's settings can turn them on.
  const toggleNotifications = async () => {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted && p.canAskAgain) setNotifications(await askForNotifications());
    else void Linking.openSettings();
  };

  // A manual check always offers what it finds, even a version skipped earlier with "Later".
  const checkUpdates = async () => {
    setChecking('checking');
    const found = await checkForUpdate();
    if (found) {
      updateSettings({ skippedUpdate: undefined });
      offerUpdate(found);
      setChecking('idle');
    } else {
      const online = await fetch('https://api.github.com', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
      setChecking(online ? 'latest' : 'offline');
      if (online) haptic.success();
    }
  };
  const checkLabel = { idle: undefined, checking: 'Checking…', latest: "You're up to date", offline: 'No connection' }[checking];

  const confirmDeleteAll = async () => {
    const ok = await confirm({ title: 'Delete all chats?', message: `This removes ${chats} chat${chats === 1 ? '' : 's'} from this phone. It can’t be undone.`, action: 'Delete all chats', destructive: true });
    if (!ok) return;
    deleteAllChats();
    toast.show({ title: 'All chats deleted' });
  };

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
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 36 }}>
      {group('You', [
        row('Name', settings.name || 'Not set', () => (setName(settings.name ?? ''), setSheet('name'))),
        row('Gender', genders.find(g => g.value === settings.gender)?.label ?? 'Not set', () => setSheet('gender')),
      ])}
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
        row('Theme', (palettes.find(p => p.id === settings.palette) ?? palettes[0]).name, () => setSheet('palette')),
        row('Dictation language', languages.find(l => l.value === settings.voiceLang)?.label ?? settings.voiceLang, () => setSheet('voice')),
        row('Notifications', notifications === null ? undefined : notifications ? 'On' : 'Off', () => void toggleNotifications()),
        <View key="nudges" style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.text }]}>Check-ins</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>A friendly note now and then, never more than one every couple of days</Text>
          </View>
          <Switch value={settings.nudges} onValueChange={v => updateSettings({ nudges: v })} accessibilityLabel="Check-ins" />
        </View>,
        <View key="haptics" style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.text }]}>Haptics</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>Gentle taps when you send, switch and confirm</Text>
          </View>
          <Switch value={settings.haptics} onValueChange={v => updateSettings({ haptics: v })} accessibilityLabel="Haptics" />
        </View>,
      ])}
      {group('Updates', [
        row('Check for updates', checkLabel, () => void (checking !== 'checking' && checkUpdates())),
        <View key="v" style={s.row}>
          <Text style={[s.label, { color: c.text }]}>Version</Text>
          <Text style={[s.value, { color: c.muted }]}>{Constants.expoConfig?.version}</Text>
        </View>,
      ])}
      {group('Data', [
        <Pressable key="del" onPress={confirmDeleteAll} disabled={!chats} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.row}>
          <Text style={[s.label, { color: chats ? c.danger : c.muted }]}>Delete all chats</Text>
        </Pressable>,
      ])}
      {group('About', [
        row('Take the tour', 'A guided look at every control', () => { updateSettings({ tour: 'pending' }); router.dismissAll(); router.navigate('/'); }),
        row("What's new", undefined, () => router.push('/changelog')),
        row('Image animation: Grid Reveal by Rare UI', 'rareui.com', () => void Linking.openURL('https://www.rareui.com/components/gridreveal')),
      ])}

      <SelectSheet open={sheet === 'gender'} onClose={() => setSheet(null)} title="Gender" options={genders} value={settings.gender ?? ''} onChange={v => (updateSettings({ gender: v as S['gender'] }), setSheet(null))} />
      <BottomSheet open={sheet === 'name'} onClose={() => setSheet(null)} title="Your name">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="First name" autoCapitalize="words" autoFocus onSubmitEditing={saveName} returnKeyType="done" />
          <ActionButton title="Save" onPress={saveName} />
        </View>
      </BottomSheet>
      <SelectSheet open={sheet === 'theme'} onClose={() => setSheet(null)} title="Appearance" options={themes} value={settings.theme} onChange={v => (updateSettings({ theme: v as S['theme'] }), setSheet(null))} />
      <BottomSheet open={sheet === 'palette'} onClose={() => setSheet(null)} title="Theme">
        <View style={s.swatches} accessibilityRole="radiogroup">
          {palettes.map(p => <Swatch key={p.id} id={p.id} name={p.name} note={p.note} selected={(settings.palette ?? 'moss') === p.id} onPress={() => (haptic.select(), updateSettings({ palette: p.id }))} />)}
        </View>
      </BottomSheet>
      <SelectSheet open={sheet === 'voice'} onClose={() => setSheet(null)} title="Dictation language" options={languages} value={settings.voiceLang} onChange={v => (updateSettings({ voiceLang: v }), setSheet(null))} />
    </ScrollView>
  );
}

/** A theme card: its light and dark faces side by side, so both modes are judged at once. */
function Swatch({ id, name, note, selected, onPress }: { id: string; name: string; note: string; selected: boolean; onPress: () => void }) {
  const c = useColors();
  const face = (scheme: 'light' | 'dark') => {
    const t = paletteColors(id, scheme);
    return (
      <View style={[s.face, { backgroundColor: t.bg }]}>
        <View style={[s.faceBubble, { backgroundColor: t.bubble }]} />
        <View style={[s.faceLine, { backgroundColor: t.border }]} />
        <View style={[s.faceDot, { backgroundColor: t.mossAction }]} />
      </View>
    );
  };
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${name}, ${note}`} style={[s.swatch, { borderColor: selected ? c.moss : c.border, backgroundColor: c.surface2 }]}>
      <View style={s.faces}>{face('light')}{face('dark')}</View>
      <View style={s.swatchText}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.text }}>{name}</Text>
          <Text numberOfLines={2} style={{ fontFamily: font.sans, fontSize: fs.xs, lineHeight: 16, color: c.muted }}>{note}</Text>
        </View>
        {selected ? <Icon name="check" size={16} color={c.moss} /> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 8, paddingBottom: 8 },
  swatch: { width: '48%', flexGrow: 1, borderRadius: 16, borderWidth: 1.5, overflow: 'hidden' },
  faces: { flexDirection: 'row', height: 64 },
  face: { flex: 1, padding: 8, gap: 6, justifyContent: 'flex-end' },
  faceBubble: { alignSelf: 'flex-end', width: '70%', height: 12, borderRadius: 6 },
  faceLine: { width: '85%', height: 5, borderRadius: 3 },
  faceDot: { alignSelf: 'flex-end', width: 14, height: 14, borderRadius: 7 },
  swatchText: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  heading: { fontFamily: font.medium, fontSize: fs.xs, paddingHorizontal: 4, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP + 8, paddingHorizontal: 16, paddingVertical: 6 },
  label: { flex: 1, fontFamily: font.sans, fontSize: fs.base },
  value: { fontFamily: font.sans, fontSize: fs.sm, maxWidth: '50%' },
});
