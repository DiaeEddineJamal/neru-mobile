import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { haptic } from '@/haptics';
import { desktopUsage, useRemote } from '@/remote/store';
import type { UsageTotals } from '@/shared/types';
import { dollars, referenceCost, REFERENCE, resetUsage, tokens, useUsage } from '@/usage';
import { changeLanguage, deleteAllChats, modelLabel, setModelSheet, updateSettings, useStore, type Settings as S } from '@/store';
import { languages as uiLanguages, t as tx, type LanguageSetting } from '@/i18n';
import { confirm, notice } from '@/ui/confirm';
import { useToast } from '@/ui/toast';
import { useMcp } from '@/mcp/store';
import { font, fs, paletteColors, palettes, TAP, useBottomPad, useColors } from '@/theme';
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
const privacyRules = [
  { value: 'any', label: 'Any provider', description: 'Every model on your keys' },
  { value: 'no-train', label: 'Not trained on', description: 'Skip providers whose terms let them train on what you send' },
  { value: 'local', label: 'Only my devices', description: 'Pocket Lab models and your own Ollama or local server' },
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
  // The option lists are module constants; their labels are translated here, at render time.
  const tr = <O extends { label: string; description?: string }>(o: O): O => ({ ...o, label: tx(o.label), description: o.description && tx(o.description) });
  const themeOptions = themes.map(tr);
  const genderOptions = genders.map(tr);
  const privacyOptions = privacyRules.map(tr);
  const voiceOptions = languages.map(tr);
  // Language names stay in their own script; only the System entry is translated.
  const languageOptions = uiLanguages.map(o => (o.value === 'system' ? tr(o) : o));
  const bottomPad = useBottomPad();
  const settings = useStore(s => s.settings);
  const keyed = useStore(s => s.keyed.length);
  const desktop = useRemote(s => s.desktopName);
  const [sheet, setSheet] = useState<'theme' | 'palette' | 'voice' | 'gender' | 'name' | 'privacy' | 'language' | null>(null);
  const usage = useUsage();
  const connectorCount = useMcp(s => s.connectors.length);
  const connected = useRemote(s => s.status === 'connected');
  const [desk, setDesk] = useState<UsageTotals | null>(null);
  useEffect(() => { if (connected) desktopUsage().then(setDesk).catch(() => setDesk(null)); }, [connected]);
  const freeTokens = usage.free.input + usage.free.output + (desk ? desk.free.input + desk.free.output : 0);
  const saved = referenceCost(usage.free) + (desk ? referenceCost(desk.free) : 0);
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
  const checkLabel = { idle: undefined, checking: tx('Checking…'), latest: tx("You're up to date"), offline: tx('No connection') }[checking];

  const confirmDeleteAll = async () => {
    const ok = await confirm({ title: tx('Delete all chats?'), message: chats === 1 ? tx('This removes 1 chat from this phone. It can’t be undone.') : tx('This removes {n} chats from this phone. It can’t be undone.', { n: chats }), action: tx('Delete all chats'), destructive: true });
    if (!ok) return;
    deleteAllChats();
    toast.show({ title: tx('All chats deleted') });
  };

  const row = (icon: IconName, label: string, value: string | undefined, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.row}>
      <Icon name={icon} size={23} color={c.secondary} />
      <Text style={[s.label, { color: c.text }]}>{label}</Text>
      {value ? <Text numberOfLines={1} style={[s.value, { color: c.muted }]}>{value}</Text> : null}
      <Icon name="chevronRight" size={18} color={c.muted} />
    </Pressable>
  );
  const group = (title: string, children: ReactNode[]) => (
    <View style={{ marginTop: 24 }}>
      <Text accessibilityRole="header" style={[s.heading, { color: c.muted }]}>{title}</Text>
      <View style={[s.group, { backgroundColor: c.surface2 }]}>{children.map((child, index) => <View key={index}>{index > 0 ? <View style={{ marginStart: 58, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }} /> : null}{child}</View>)}</View>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 36 }}>
      {group(tx('Models'), [
        row('brain', tx('Model'), modelLabel(settings), () => setModelSheet(true)),
        row('lab', 'Pocket Lab', tx('Models that run offline'), () => router.push('/models')),
        row('cloud', tx('Providers and API keys'), keyed ? tx('{n} saved', { n: keyed }) : tx('None yet'), () => router.push('/providers')),
        row('wrench', tx('Connectors'), connectorCount ? tx('{n} on this phone', { n: connectorCount }) : 'Gmail, GitHub, Jira…', () => router.push('/connectors')),
        <View key="fallback" style={s.row}>
          <Icon name="retry" size={23} color={c.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.text }]}>{tx('Switch models when one runs out')}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{tx('Moves to the next free model on your keys')}</Text>
          </View>
          <Switch value={settings.fallback} onValueChange={v => updateSettings({ fallback: v })} accessibilityLabel={tx('Switch models when one runs out')} />
        </View>,
      ])}
      {group(tx('Privacy'), [
        row('shield', tx('Models chats may use'), privacyOptions.find(p => p.value === settings.privacy)?.label, () => setSheet('privacy')),
        <View key="redact" style={s.row}>
          <Icon name="lock" size={23} color={c.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.text }]}>{tx('Hide secrets before sending')}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{tx('API keys, tokens, passwords and private keys never reach a cloud model')}</Text>
          </View>
          <Switch value={settings.redact} onValueChange={v => updateSettings({ redact: v })} accessibilityLabel={tx('Hide secrets before sending')} />
        </View>,
      ])}
      {group(tx('Desktop'), [row('desktop', tx('Paired desktop'), desktop ?? tx('Not paired'), () => router.push('/pair'))])}
      {group(tx('App'), [
        row('language', tx('Language'), languageOptions.find(l => l.value === (settings.language ?? 'system'))?.label, () => setSheet('language')),
        row('moon', tx('Appearance'), themeOptions.find(o => o.value === settings.theme)?.label, () => setSheet('theme')),
        row('palette', tx('Theme'), tx((palettes.find(p => p.id === settings.palette) ?? palettes[0]).name), () => setSheet('palette')),
        row('mic', tx('Dictation language'), voiceOptions.find(l => l.value === settings.voiceLang)?.label ?? settings.voiceLang, () => setSheet('voice')),
        row('bell', tx('Notifications'), notifications === null ? undefined : notifications ? tx('On') : tx('Off'), () => void toggleNotifications()),
        <View key="nudges" style={s.row}>
          <Icon name="bell" size={23} color={c.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.text }]}>{tx('Check-ins')}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{tx('A friendly note now and then, never more than one every couple of days')}</Text>
          </View>
          <Switch value={settings.nudges} onValueChange={v => updateSettings({ nudges: v })} accessibilityLabel={tx('Check-ins')} />
        </View>,
        <View key="haptics" style={s.row}>
          <Icon name="vibration" size={23} color={c.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.text }]}>{tx('Haptics')}</Text>
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{tx('Gentle taps when you send, switch and confirm')}</Text>
          </View>
          <Switch value={settings.haptics} onValueChange={v => updateSettings({ haptics: v })} accessibilityLabel={tx('Haptics')} />
        </View>,
      ])}
      {group(tx('You'), [
        row('person', tx('Name'), settings.name || tx('Not set'), () => (setName(settings.name ?? ''), setSheet('name'))),
        row('people', tx('Gender'), genderOptions.find(g => g.value === settings.gender)?.label ?? tx('Not set'), () => setSheet('gender')),
      ])}
      {group(tx('Updates'), [
        row('retry', tx('Check for updates'), checkLabel, () => void (checking !== 'checking' && checkUpdates())),
        <View key="v" style={s.row}>
          <Icon name="doc" size={23} color={c.secondary} />
          <Text style={[s.label, { color: c.text }]}>{tx('Version')}</Text>
          <Text style={[s.value, { color: c.muted }]}>{Constants.expoConfig?.version}</Text>
        </View>,
      ])}
      <View accessible accessibilityLabel={tx('Spent: $0.00. The same work on {model} would cost about {cost}.', { model: REFERENCE.name, cost: dollars(saved) })} style={[s.savings, { backgroundColor: c.mossDeep, borderColor: c.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="savings" size={18} color={c.moss} />
          <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: c.secondary, letterSpacing: 0.6 }}>{tx('SPENT')}</Text>
        </View>
        <Text style={{ fontFamily: font.serif, fontSize: 44, lineHeight: 50, color: c.text }}>$0.00</Text>
        <Text style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color: c.secondary }}>
          {freeTokens
            ? (desk
              ? tx('{tokens} tokens on free models, here and on your desktop. On {model} that would have cost about {cost}.', { tokens: tokens(freeTokens), model: REFERENCE.name, cost: dollars(saved) })
              : tx('{tokens} tokens on free models. On {model} that would have cost about {cost}.', { tokens: tokens(freeTokens), model: REFERENCE.name, cost: dollars(saved) }))
            : tx('Chats on free keys and Pocket Lab models cost nothing. Neru counts what the same tokens would cost on {model}.', { model: REFERENCE.name })}
        </Text>
        {usage.paid.replies ? <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{usage.paid.replies === 1 ? tx('1 reply used your paid keys ({tokens} tokens), billed by those providers.', { tokens: tokens(usage.paid.input + usage.paid.output) }) : tx('{n} replies used your paid keys ({tokens} tokens), billed by those providers.', { n: usage.paid.replies, tokens: tokens(usage.paid.input + usage.paid.output) })}</Text> : null}
      </View>
      {group(tx('Data'), [
        <Pressable key="usage" onPress={async () => { if (await confirm({ title: tx('Reset the savings counter?'), message: tx('The token totals on this phone start again from zero.'), action: tx('Reset') })) resetUsage(); }} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.row}>
          <Icon name="savings" size={23} color={c.secondary} />
          <Text style={[s.label, { color: c.text }]}>{tx('Reset the savings counter')}</Text>
        </Pressable>,
        <Pressable key="del" onPress={confirmDeleteAll} disabled={!chats} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.row}>
          <Icon name="trash" size={23} color={c.secondary} />
          <Text style={[s.label, { color: chats ? c.danger : c.muted }]}>{tx('Delete all chats')}</Text>
        </Pressable>,
      ])}
      {group(tx('About'), [
        row('compass', tx('Take the tour'), tx('A guided look at every control'), () => { updateSettings({ tour: 'pending' }); router.dismissAll(); router.navigate('/'); }),
        row('sparkles', tx("What's new"), undefined, () => router.push('/changelog')),
        row('photo', tx('Image animation: Grid Reveal by Rare UI'), 'rareui.com', () => void Linking.openURL('https://www.rareui.com/components/gridreveal')),
      ])}

      <SelectSheet open={sheet === 'gender'} onClose={() => setSheet(null)} title={tx('Gender')} options={genderOptions} value={settings.gender ?? ''} onChange={v => (updateSettings({ gender: v as S['gender'] }), setSheet(null))} />
      <BottomSheet open={sheet === 'name'} onClose={() => setSheet(null)} title={tx('Your name')}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <TextField label={tx('Name')} value={name} onChangeText={setName} placeholder={tx('First name')} autoCapitalize="words" autoFocus onSubmitEditing={saveName} returnKeyType="done" />
          <ActionButton title={tx('Save')} onPress={saveName} />
        </View>
      </BottomSheet>
      <SelectSheet open={sheet === 'theme'} onClose={() => setSheet(null)} title={tx('Appearance')} options={themeOptions} value={settings.theme} onChange={v => (updateSettings({ theme: v as S['theme'] }), setSheet(null))} />
      <BottomSheet open={sheet === 'palette'} onClose={() => setSheet(null)} title={tx('Theme')}>
        <View style={s.swatches} accessibilityRole="radiogroup">
          {palettes.map(p => <Swatch key={p.id} id={p.id} name={tx(p.name)} note={tx(p.note)} selected={(settings.palette ?? 'moss') === p.id} onPress={() => (haptic.select(), updateSettings({ palette: p.id }))} />)}
        </View>
      </BottomSheet>
      <SelectSheet
        open={sheet === 'language'}
        onClose={() => setSheet(null)}
        title={tx('Language')}
        options={languageOptions}
        value={settings.language ?? 'system'}
        onChange={v => {
          setSheet(null);
          if (changeLanguage(v as LanguageSetting)) void notice({ title: tx('Restart Neru'), message: tx('Close Neru and open it again to switch the layout direction for this language.'), icon: 'sparkles' });
        }}
      />
      <SelectSheet open={sheet === 'privacy'} onClose={() => setSheet(null)} title={tx('Models chats may use')} options={privacyOptions} value={settings.privacy} onChange={v => (updateSettings({ privacy: v as S['privacy'] }), setSheet(null))} />
      <SelectSheet open={sheet === 'voice'} onClose={() => setSheet(null)} title={tx('Dictation language')} options={voiceOptions} value={settings.voiceLang} onChange={v => (updateSettings({ voiceLang: v }), setSheet(null))} />
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
  savings: { gap: 6, padding: 18, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  heading: { fontFamily: font.medium, fontSize: fs.xs, paddingHorizontal: 4, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { borderRadius: 24, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: TAP + 16, paddingHorizontal: 16, paddingVertical: 14 },
  label: { flex: 1, fontFamily: font.medium, fontSize: fs.base },
  value: { fontFamily: font.sans, fontSize: fs.sm, maxWidth: '36%', flexShrink: 1 },
});
