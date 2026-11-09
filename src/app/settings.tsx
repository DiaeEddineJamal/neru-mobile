// Settings, laid out like the reference: an account card, grouped rows with outline icons, Color mode cards, and an
// (i) menu in the header for What's new, help, credits and the version. Profile, Usage and Notifications have
// their own pages; the capability switches live in a sheet.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';

import { Avatar } from '@/components/Avatar';
import { sidebar } from '@/components/DrawerContent';
import { Icon, IconButton, type IconName } from '@/components/Icon';
import { haptic } from '@/haptics';
import { languages as uiLanguages, t as tx, type LanguageSetting } from '@/i18n';
import { useMcp } from '@/mcp/store';
import { useRemote } from '@/remote/store';
import { changeLanguage, deleteAllChats, modelLabel, setModelSheet, updateSettings, useStore, type Settings as S } from '@/store';
import { font, fs, paletteColors, palettes, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { confirm, notice } from '@/ui/confirm';
import { Card, Group, PageScroll, Row, SectionLabel, Squish } from '@/ui/page';
import { SelectSheet } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { checkForUpdate, offerUpdate } from '@/update';
import { dayKey, tokens, useUsageLog } from '@/usage';

const HELP_URL = 'https://github.com/DiaeEddineJamal/neru-mobile/issues';
const privacyRules = [
  { value: 'any', label: 'Any provider', description: 'Every model on your keys' },
  { value: 'no-train', label: 'Not trained on', description: 'Skip providers whose terms let them train on what you send' },
  { value: 'local', label: 'Only my devices', description: 'Pocket Lab models and your own Ollama or local server' },
];
const voiceLanguages = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'es-ES', label: 'Español' },
  { value: 'de-DE', label: 'Deutsch' },
];
type Sheet = 'capabilities' | 'palette' | 'voice' | 'privacy' | 'language' | null;

/** Capability switches; undefined means on. */
const capabilityKeys = ['memory', 'searchChats', 'artifacts', 'visuals', 'switchOnFlag', 'connectors'] as const;

export default function Settings() {
  const c = useColors();
  const toast = useToast();
  const tr = <O extends { label: string; description?: string }>(o: O): O => ({ ...o, label: tx(o.label), description: o.description && tx(o.description) });
  const privacyOptions = privacyRules.map(tr);
  const voiceOptions = voiceLanguages.map(tr);
  // Language names stay in their own script; only the System entry is translated.
  const languageOptions = uiLanguages.map(o => (o.value === 'system' ? tr(o) : o));

  const settings = useStore(s => s.settings);
  const keyed = useStore(s => s.keyed.length);
  const chats = useStore(s => s.chats.length);
  const desktop = useRemote(s => s.desktopName);
  const connectorCount = useMcp(s => s.connectors.filter(x => x.enabled).length);
  const log = useUsageLog();
  const todayTokens = Object.values(log[dayKey()] ?? {}).reduce((n, b) => n + b.input + b.output, 0);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menu, setMenu] = useState(false);
  const [notifications, setNotifications] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => void Notifications.getPermissionsAsync().then(p => setNotifications(p.granted)), []));

  const on = (k: (typeof capabilityKeys)[number]) => settings[k] !== false;
  const enabled = capabilityKeys.filter(on).length;
  const displayName = settings.fullName || settings.name || '';

  const confirmDeleteAll = async () => {
    const ok = await confirm({ title: tx('Delete all chats?'), message: chats === 1 ? tx('This removes 1 chat from this phone. It can’t be undone.') : tx('This removes {n} chats from this phone. It can’t be undone.', { n: chats }), action: tx('Delete all chats'), destructive: true });
    if (!ok) return;
    deleteAllChats();
    toast.show({ title: tx('All chats deleted') });
  };

  return (
    <>
      <Stack.Screen options={{ headerLeft: () => <IconButton name="menu" label={tx('Open sidebar')} color={c.text} onPress={() => (sidebar.open(), router.canGoBack() ? router.back() : router.replace('/'))} style={{ marginLeft: -8 }} />, headerRight: () => <IconButton name="info" label={tx('About Neru')} color={c.text} onPress={() => setMenu(true)} style={{ marginRight: -8 }} /> }} />
      <PageScroll>
        {/* Account */}
        <Card onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar uri={settings.avatarUri} name={displayName} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: fs.lg, color: c.text }}>{displayName || tx('Add your name')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={desktop ? 'desktop' : 'phone'} size={16} color={c.muted} />
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.medium, fontSize: fs.base, color: c.muted }}>{desktop ?? tx('On this phone')}</Text>
            </View>
          </View>
          <Icon name="chevronRight" size={20} color={c.muted} />
        </Card>

        <Group>
          {/* The account card above already opens Profile; Memory gets the top slot instead of a duplicate row. */}
          <Row icon="brain" title={tx('Memory')} subtitle={settings.memory === false ? tx('Off') : tx('On')} onPress={() => router.push('/memory')} />
          <Row icon="gauge" title={tx('Usage')} subtitle={todayTokens ? tx('{tokens} tokens today', { tokens: tokens(todayTokens) }) : undefined} onPress={() => router.push('/usage')} />
          <Row icon="bell" title={tx('Notifications')} subtitle={notifications === null ? undefined : notifications ? tx('On') : tx('Off')} onPress={() => router.push('/notifications')} />
        </Group>

        <Group>
          <Row icon="sliders" title={tx('Capabilities')} subtitle={tx('{n} enabled', { n: enabled })} onPress={() => setSheet('capabilities')} />
          <Row icon="brain" title={tx('Default model')} subtitle={modelLabel(settings)} onPress={() => setModelSheet(true)} />
          <Row icon="key" title={tx('Providers and keys')} subtitle={keyed ? tx('{n} saved', { n: keyed }) : tx('None yet')} onPress={() => router.push('/providers')} />
          <Row icon="lab" title="Pocket Lab" subtitle={tx('Models that run offline')} onPress={() => router.push('/models')} />
          <Row icon="wand" title={tx('Magic Touch')} subtitle={tx('Cut out anything in a photo, on the phone')} onPress={() => router.push('/magic-touch')} />
          <Row icon="connectors" title={tx('Connectors')} subtitle={connectorCount ? tx('{n} connected', { n: connectorCount }) : 'Gmail, GitHub, Jira…'} onPress={() => router.push('/connectors')} />
          <Row icon="desktop" title={tx('Desktop pairing')} subtitle={desktop ?? tx('Not paired')} onPress={() => router.push('/pair')} />
        </Group>

        <ColorMode value={settings.theme} onChange={theme => updateSettings({ theme })} />
        <Group>
          <Row icon="palette" title={tx('Theme')} subtitle={tx((palettes.find(p => p.id === settings.palette) ?? palettes[0]).name)} onPress={() => setSheet('palette')} />
          <Row icon="language" title={tx('Language')} subtitle={languageOptions.find(l => l.value === (settings.language ?? 'system'))?.label} onPress={() => setSheet('language')} />
          <Row icon="mic" title={tx('Dictation language')} subtitle={voiceOptions.find(l => l.value === settings.voiceLang)?.label ?? settings.voiceLang} onPress={() => setSheet('voice')} />
          <Row icon="vibration" title={tx('Haptics')} subtitle={tx('Gentle taps when you send, switch and confirm')} toggle={{ value: settings.haptics, onChange: v => updateSettings({ haptics: v }) }} />
        </Group>

        <SectionLabel>{tx('Privacy and models')}</SectionLabel>
        <Group>
          <Row icon="shield" title={tx('Models chats may use')} subtitle={privacyOptions.find(p => p.value === settings.privacy)?.label} onPress={() => setSheet('privacy')} />
          <Row icon="lock" title={tx('Hide secrets before sending')} subtitle={tx('API keys, tokens, passwords and private keys never reach a cloud model')} toggle={{ value: settings.redact, onChange: v => updateSettings({ redact: v }) }} />
          <Row icon="retry" title={tx('Switch models when one runs out')} subtitle={tx('Moves to the next free model on your keys')} toggle={{ value: settings.fallback, onChange: v => updateSettings({ fallback: v }) }} />
        </Group>

        <Group>
          <Row icon="trash" title={tx('Delete all chats')} destructive disabled={!chats} onPress={() => void confirmDeleteAll()} chevron={false} />
        </Group>
      </PageScroll>

      <InfoMenu open={menu} onClose={() => setMenu(false)} />

      <BottomSheet open={sheet === 'capabilities'} onClose={() => setSheet(null)} title={tx('Capabilities')}>
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Group>
            <Row icon="brain" title={tx('Memory')} subtitle={tx('Remember useful details from your chats and use them in new ones')} toggle={{ value: on('memory'), onChange: v => updateSettings({ memory: v }) }} />
            <Row icon="pencil" title={tx('View and edit memory')} onPress={() => (setSheet(null), router.push('/memory'))} />
            <Row icon="history" title={tx('Search and reference chats')} subtitle={tx('Let Neru look up your past chats when they help')} toggle={{ value: on('searchChats'), onChange: v => updateSettings({ searchChats: v }) }} />
          </Group>
          <Group>
            <Row icon="artifact" title={tx('Artifacts')} subtitle={tx('Documents, code and pages kept apart from the chat')} toggle={{ value: on('artifacts'), onChange: v => updateSettings({ artifacts: v }) }} />
            <Row icon="chart" title={tx('Visualizations')} subtitle={tx('Inline charts and diagrams')} toggle={{ value: on('visuals'), onChange: v => updateSettings({ visuals: v }) }} />
            <Row icon="connectors" title={tx('Connector tools')} subtitle={tx('Let chats use your connectors')} toggle={{ value: on('connectors'), onChange: v => updateSettings({ connectors: v }) }} />
            <Row icon="flag" title={tx('Switch models when a message is flagged')} subtitle={tx('Try another model when a provider’s safety filter stops a reply')} toggle={{ value: on('switchOnFlag'), onChange: v => updateSettings({ switchOnFlag: v }) }} />
          </Group>
        </View>
      </BottomSheet>
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
    </>
  );
}

/** Light, Dark and System preview cards; System is split diagonally. The accent dot is the current theme's. */
function ColorMode({ value, onChange }: { value: S['theme']; onChange: (v: S['theme']) => void }) {
  const c = useColors();
  const palette = useStore(st => st.settings.palette);
  const modes: { value: S['theme']; label: string }[] = [
    { value: 'light', label: tx('Light') },
    { value: 'dark', label: tx('Dark') },
    { value: 'system', label: tx('System') },
  ];
  const face = (scheme: 'light' | 'dark', dot = true) => {
    const p = paletteColors(palette, scheme);
    return (
      <View style={[s.modeInner, { backgroundColor: p.surface2, borderColor: p.border }]}>
        <View style={[s.modeLine, { width: '70%', backgroundColor: p.muted }]} />
        <View style={[s.modeLine, { width: '45%', backgroundColor: p.muted }]} />
        {dot ? <View style={[s.modeDot, { backgroundColor: p.moss }]} /> : null}
      </View>
    );
  };
  return (
    <Card style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 30, alignItems: 'center' }}><Icon name="moon" size={24} color={c.text} /></View>
        <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{tx('Color mode')}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
        {modes.map(m => {
          const selected = value === m.value;
          const light = paletteColors(palette, 'light');
          const dark = paletteColors(palette, 'dark');
          return (
            <View key={m.value} style={{ flex: 1, gap: 8 }}>
              <Squish onPress={() => (haptic.select(), onChange(m.value))} accessibilityLabel={m.label} style={{ width: '100%' }}>
                <View accessibilityRole="radio" accessibilityState={{ checked: selected }} style={[s.mode, { borderColor: selected ? c.moss : 'transparent', backgroundColor: m.value === 'dark' ? dark.bg : light.bg }]}>
                  {m.value === 'system' ? (
                    <>
                      {face('light', false)}
                      {/* The dark half: the lower-right triangle, corner to corner. */}
                      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
                        <Polygon points="100,0 100,100 0,100" fill={dark.bg} />
                      </Svg>
                      <View style={[s.modeDot, { right: 16, bottom: 16, backgroundColor: dark.moss }]} />
                    </>
                  ) : (
                    face(m.value)
                  )}
                </View>
              </Squish>
              <Text style={{ fontFamily: selected ? font.semibold : font.medium, fontSize: fs.sm, color: selected ? c.text : c.muted, textAlign: 'center' }}>{m.label}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const menuIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.92 }, { translateY: -8 }] },
  100: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }] },
}).duration(170);

/** The (i) popover: release notes, the tour, updates, help, credits and the version. */
function InfoMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState<'idle' | 'checking' | 'latest' | 'offline'>('idle');
  const version = Constants.expoConfig?.version ?? '';
  const build = Constants.expoConfig?.android?.versionCode;

  // A manual check always offers what it finds, even a version skipped earlier with "Later".
  const checkUpdates = async () => {
    if (checking === 'checking') return;
    setChecking('checking');
    const found = await checkForUpdate();
    if (found) {
      updateSettings({ skippedUpdate: undefined });
      onClose();
      offerUpdate(found);
      setChecking('idle');
    } else {
      const online = await fetch('https://api.github.com', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
      setChecking(online ? 'latest' : 'offline');
      if (online) haptic.success();
    }
  };
  const checkLabel = { idle: tx('Check for updates'), checking: tx('Checking…'), latest: tx("You're up to date"), offline: tx('No connection') }[checking];

  const item = (icon: IconName, label: string, onPress: () => void, keepOpen = false) => (
    <Pressable key={label} onPress={() => (haptic.light(), keepOpen || onClose(), onPress())} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.menuItem}>
      <Icon name={icon} size={22} color={c.secondary} />
      <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={tx('Close menu')} />
      {open ? (
        <Animated.View entering={menuIn} style={[s.menu, { top: insets.top + 52, backgroundColor: c.surface2, borderColor: c.border, transformOrigin: 'top right' }]}>
          <View style={{ gap: 2 }}>
            {item('sparkles', tx("What's new"), () => router.push('/changelog'))}
            {item('compass', tx('Take the tour'), () => { updateSettings({ tour: 'pending' }); router.dismissAll(); router.navigate('/'); })}
            {item('retry', checkLabel, () => void checkUpdates(), true)}
          </View>
          <View style={[s.menuRule, { backgroundColor: c.border }]} />
          {item('link', tx('Help and feedback'), () => void Linking.openURL(HELP_URL))}
          {item('photo', tx('Credits: Grid Reveal by Rare UI'), () => void Linking.openURL('https://www.rareui.com/components/gridreveal'))}
          <View style={[s.menuRule, { backgroundColor: c.border }]} />
          <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.secondary, paddingHorizontal: 20, paddingVertical: 14 }}>
            {build ? tx('Version {version} ({build})', { version, build }) : tx('Version {version}', { version })}
          </Text>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

/** A theme card: its light and dark faces side by side, so both modes are judged at once. */
function Swatch({ id, name, note, selected, onPress }: { id: string; name: string; note: string; selected: boolean; onPress: () => void }) {
  const c = useColors();
  const face = (scheme: 'light' | 'dark') => {
    const p = paletteColors(id, scheme);
    return (
      <View style={[s.face, { backgroundColor: p.bg }]}>
        <View style={[s.faceBubble, { backgroundColor: p.bubble }]} />
        <View style={[s.faceLine, { backgroundColor: p.border }]} />
        <View style={[s.faceDot, { backgroundColor: p.mossAction }]} />
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
  mode: { height: 84, borderRadius: 18, borderWidth: 2.5, padding: 7, overflow: 'hidden' },
  modeInner: { flex: 1, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, padding: 9, gap: 5 },
  modeLine: { height: 4, borderRadius: 2, opacity: 0.7 },
  modeDot: { position: 'absolute', right: 9, bottom: 9, width: 14, height: 14, borderRadius: 7 },
  menu: { position: 'absolute', right: 12, minWidth: 260, maxWidth: 320, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingVertical: 6, elevation: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 52, paddingHorizontal: 20 },
  menuRule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
