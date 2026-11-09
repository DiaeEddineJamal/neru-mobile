// Providers and keys: each cloud or local model provider with its mark, setup status and privacy, and a focused
// sheet to get, paste, test and save its key (or a LAN address for local servers).
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ModelMark } from '@/components/ModelMark';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { score } from '@/llm/fallback';
import { privacyLabels, providerPresets, type ProviderPreset } from '@/shared/providerCatalog';
import { chooseModel, getState, modelsFor, saveProviderKey, testKey, useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { Card, Group, PageScroll, SectionLabel } from '@/ui/page';
import { PrivacyTag } from '@/ui/privacy-tag';
import { useToast } from '@/ui/toast';

const NEEDS_URL = new Set(['custom', 'local', 'ollama']);
// Ollama and local gateways run on a computer, so the phone needs that computer's LAN address.
const LAN_HINT: Record<string, string> = { ollama: 'http://192.168.1.10:11434/v1', local: 'http://192.168.1.10:3001/v1', custom: 'https://api.example.com/v1' };

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const modelCount = (n: number) => (n === 1 ? t('1 model') : t('{n} models', { n }));

type TestResult = { ok: true; text: string } | { ok: false; text: string };

function Editor({ preset, onClose }: { preset: ProviderPreset; onClose: () => void }) {
  const c = useColors();
  const toast = useToast();
  const saved = useStore(s => s.keyed.includes(preset.id));
  const needsUrl = NEEDS_URL.has(preset.id);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(getState().settings.baseUrls[preset.id] ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const paste = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (!text) return toast.show({ title: t('The clipboard is empty') });
    haptic.light();
    setKey(text);
    setResult(null);
    setError(undefined);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      // Nothing typed: test the key already saved on this phone.
      const models = key.trim() || !saved ? await testKey(preset.id, key, url) : await modelsFor(preset.id, true);
      haptic.success();
      setResult({ ok: true, text: t('It works · {models}', { models: modelCount(models.length) }) });
    } catch (err) {
      haptic.error();
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const models = await testKey(preset.id, key, url);
      await saveProviderKey(preset.id, key, needsUrl ? url : undefined);
      // First key: start on its strongest model so the first message just works.
      if (!getState().settings.model && models.length) chooseModel(preset.id, [...models].sort((a, b) => score(b) - score(a))[0]);
      haptic.success();
      toast.show({ title: t('{name} added', { name: preset.name }), description: models.length === 1 ? t('1 model available') : t('{n} models available', { n: models.length }) });
      onClose();
    } catch (err) {
      haptic.error();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await saveProviderKey(preset.id, '');
    haptic.medium();
    toast.show({ title: t('{name} removed', { name: preset.name }) });
    onClose();
  };

  return (
    <View style={{ gap: 14, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <ModelMark model={preset.id} providerId={preset.id} local={preset.privacy === 'local'} size={48} />
        <Text style={{ flex: 1, fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 20 }}>{t(preset.description)}</Text>
      </View>
      {preset.freeLimit ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: c.mossDeep }}>
          <Icon name="savings" size={18} color={c.sage} />
          <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: fs.sm, color: c.sage }}>{t('Free tier: {limit}', { limit: t(preset.freeLimit) })}</Text>
        </View>
      ) : null}
      <View style={{ gap: 4, padding: 12, borderRadius: 14, backgroundColor: c.surface2 }}>
        <PrivacyTag providerId={preset.id} />
        <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.secondary, lineHeight: 18 }}>{t(privacyLabels[preset.privacy].detail)}</Text>
      </View>

      {preset.keyUrl ? (
        <Pressable
          onPress={() => (haptic.light(), void Linking.openURL(preset.keyUrl!))}
          accessibilityRole="link"
          android_ripple={{ color: c.surface3 }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: c.surface2, overflow: 'hidden' }}
        >
          <Icon name="key" size={22} color={c.text} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{needsUrl ? t('Get it running') : t('Get a key')}</Text>
            <Text numberOfLines={1} style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{t('Opens {host} in your browser', { host: hostOf(preset.keyUrl) })}</Text>
          </View>
          <Icon name="link" size={18} color={c.muted} />
        </Pressable>
      ) : null}

      {needsUrl ? (
        <TextField label={t('Base URL')} value={url} onChangeText={v => (setUrl(v), setResult(null))} placeholder={LAN_HINT[preset.id]} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      ) : null}
      <TextField
        label={saved ? t('New API key') : needsUrl ? t('API key (optional)') : t('API key')}
        value={key}
        onChangeText={v => (setKey(v), setResult(null), setError(undefined))}
        placeholder={saved ? t('Saved. Paste to replace it') : t('Paste your key')}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        error={error}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <ActionButton title={t('Paste')} variant="secondary" icon="copy" onPress={() => void paste()} style={{ flex: 1 }} />
        <ActionButton title={t('Test key')} variant="secondary" icon="zap" onPress={() => void test()} loading={testing} disabled={!key.trim() && !saved && !(needsUrl && url.trim())} style={{ flex: 1 }} />
      </View>
      {result ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Icon name={result.ok ? 'checkCircle' : 'xCircle'} size={18} color={result.ok ? c.sage : c.danger} />
          <Text style={{ flex: 1, fontFamily: font.medium, fontSize: fs.sm, lineHeight: 20, color: result.ok ? c.sage : c.danger }}>{result.text}</Text>
        </View>
      ) : null}
      <ActionButton title={t('Save')} onPress={() => void save()} loading={busy} disabled={!key.trim() && !(needsUrl && url.trim())} />
      {saved ? <ActionButton title={needsUrl ? t('Remove') : t('Remove key')} variant="destructive" icon="trash" onPress={() => void remove()} /> : null}
    </View>
  );
}

function ProviderRow({ preset, status, ready, onPress, flat }: { preset: ProviderPreset; status: string; ready: boolean; onPress: () => void; flat?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => (haptic.light(), onPress())}
      accessibilityRole="button"
      accessibilityLabel={`${preset.name}, ${status}`}
      android_ripple={{ color: c.surface3 }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 72, paddingHorizontal: flat ? 0 : 18, paddingVertical: 14, backgroundColor: flat ? 'transparent' : c.surface2, overflow: 'hidden' }}
    >
      <ModelMark model={preset.id} providerId={preset.id} local={preset.privacy === 'local'} size={40} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{preset.name}</Text>
        <Text numberOfLines={2} style={{ fontFamily: font.medium, fontSize: fs.sm, color: ready ? c.sage : c.muted }}>{status}</Text>
        <PrivacyTag providerId={preset.id} />
      </View>
      <Icon name={ready ? 'checkCircle' : 'chevronRight'} size={20} color={ready ? c.sage : c.muted} />
    </Pressable>
  );
}

export default function Providers() {
  const c = useColors();
  const keyed = useStore(s => s.keyed);
  const baseUrls = useStore(s => s.settings.baseUrls);
  const [editing, setEditing] = useState<ProviderPreset | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // How many models each saved key can use (cached by the store after the first fetch).
  useEffect(() => {
    let live = true;
    for (const id of keyed)
      void modelsFor(id)
        .then(models => live && setCounts(prev => ({ ...prev, [id]: models.length })))
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [keyed]);

  const statusOf = (p: ProviderPreset) => {
    if (keyed.includes(p.id)) {
      const where = NEEDS_URL.has(p.id) && baseUrls[p.id] ? hostOf(baseUrls[p.id]) : null;
      const n = counts[p.id];
      return [where ?? (NEEDS_URL.has(p.id) ? t('Set up') : t('Key saved')), n !== undefined ? modelCount(n) : null].filter(Boolean).join(' · ');
    }
    if (p.freeLimit) return t('Free tier · {limit}', { limit: t(p.freeLimit) });
    return NEEDS_URL.has(p.id) ? t('Not set up · needs an address') : t('Not set up');
  };

  const setUp = providerPresets.filter(p => keyed.includes(p.id));
  const free = providerPresets.filter(p => !keyed.includes(p.id) && p.freeLimit);
  const paid = providerPresets.filter(p => !keyed.includes(p.id) && !p.freeLimit && !NEEDS_URL.has(p.id));
  const network = providerPresets.filter(p => !keyed.includes(p.id) && NEEDS_URL.has(p.id));
  const row = (p: ProviderPreset, flat?: boolean) => <ProviderRow key={p.id} preset={p} status={statusOf(p)} ready={keyed.includes(p.id)} onPress={() => setEditing(p)} flat={flat} />;

  return (
    <>
      <PageScroll>
        <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.secondary, paddingHorizontal: 16 }}>
          {t('Add a key to chat with that provider’s models. Keys stay on this phone.')}
        </Text>

        {setUp.length ? (
          <>
            <SectionLabel>{t('Set up')}</SectionLabel>
            <Group>{setUp.map(p => row(p))}</Group>
          </>
        ) : null}

        {free.length ? (
          <Card style={{ paddingVertical: 14, gap: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
              <Icon name="savings" size={20} color={c.sage} />
              <Text accessibilityRole="header" style={{ fontFamily: font.bold, fontSize: fs.md, color: c.text }}>{t('Free to start')}</Text>
            </View>
            <Text style={{ fontFamily: font.medium, fontSize: fs.sm, lineHeight: 20, color: c.secondary, paddingBottom: 4 }}>{t('No card needed. Neru switches between free providers when one is busy.')}</Text>
            {free.map(p => row(p, true))}
          </Card>
        ) : null}

        {paid.length ? (
          <>
            <SectionLabel>{t('Available')}</SectionLabel>
            <Group>{paid.map(p => row(p))}</Group>
          </>
        ) : null}

        {network.length ? (
          <>
            <SectionLabel>{t('On your network')}</SectionLabel>
            <Group>{network.map(p => row(p))}</Group>
          </>
        ) : null}
      </PageScroll>
      <BottomSheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {editing ? <Editor preset={editing} onClose={() => setEditing(null)} /> : null}
      </BottomSheet>
    </>
  );
}
