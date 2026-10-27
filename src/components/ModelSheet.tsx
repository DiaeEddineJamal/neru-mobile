import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ModelMark } from '@/components/ModelMark';
import { ModelSearch } from '@/components/ModelSearch';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { localModels, sizeLabel } from '@/local/catalog';
import { refreshDownloads, useDownloads } from '@/local/models';
import { chooseModel, modelsFor, presetOf, privacyBlock, setModelSheet, useStore } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { CapabilityTag } from '@/ui/capability-tag';
import { Loader } from '@/ui/loader';
import { PrivacyTag } from '@/ui/privacy-tag';

type List = { models: string[]; error?: string } | undefined;

export function ModelSheet() {
  const c = useColors();
  const open = useStore(s => s.modelSheet);
  const keyed = useStore(s => s.keyed);
  const current = useStore(s => s.settings);
  const [lists, setLists] = useState<Record<string, List>>({});
  const [query, setQuery] = useState('');
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [chosenTab, setTab] = useState<string | null>(null);
  const tab = chosenTab ?? (current.providerId === 'on-device' ? 'local' : 'cloud');
  const downloads = useDownloads();

  useEffect(() => {
    if (!open) return;
    void refreshDownloads().catch(() => {});
    let active = true;
    for (const id of keyed) {
      modelsFor(id)
        .then(models => { if (active) setLists(l => ({ ...l, [id]: { models } })); })
        .catch(err => { if (active) setLists(l => ({ ...l, [id]: { models: [], error: err instanceof Error ? err.message : String(err) } })); });
    }
    return () => { active = false; };
  }, [open, keyed]);

  const close = () => (setModelSheet(false), setQuery(''), setTab(null));
  const pick = (providerId: string, model: string) => {
    haptic.select();
    chooseModel(providerId, model);
    close();
  };
  const q = query.trim().toLowerCase();
  const installed = localModels.filter(m => m.kind !== 'segmenter' && downloads[m.id]?.phase === 'ready');
  const matches = installed.filter(m => !q || `${m.name} ${m.description}`.toLowerCase().includes(q));
  const selection = (selected: boolean) => selected ? <View style={[s.check, { backgroundColor: c.text }]}><Icon name="check" size={16} color={c.bg} /></View> : null;

  return <BottomSheet open={open} onClose={close} title={t('Model')}>
    <View style={s.content}>
      <View accessibilityRole="tablist" style={[s.tabs, { backgroundColor: c.surface2 }]}>
        {(['local', 'cloud'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => { haptic.select(); setTab(value); setQuery(''); }} style={[s.tab, { backgroundColor: tab === value ? c.surface3 : 'transparent' }]}>
          <Icon name={value === 'local' ? 'brain' : 'cloud'} size={19} color={tab === value ? c.text : c.muted} />
          <Text style={[s.tabLabel, { color: tab === value ? c.text : c.muted }]}>{t(value === 'local' ? 'Local' : 'Cloud')}</Text>
        </Pressable>)}
      </View>
      <ModelSearch value={query} onChangeText={setQuery} />
      {tab === 'local' ? <>
        <Text accessibilityRole="header" style={[s.heading, { color: c.muted }]}>{t('Downloaded')} · {installed.length}</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
          {matches.map(m => {
            const selected = current.providerId === 'on-device' && current.model === m.id;
            return <Pressable key={m.id} onPress={() => pick('on-device', m.id)} accessibilityRole="radio" accessibilityState={{ checked: selected }} style={({ pressed }) => [s.card, { backgroundColor: pressed ? c.surface3 : c.surface2, borderColor: selected ? c.text : 'transparent' }]}>
              <ModelMark model={m.repo} vision={m.vision} />
              <View style={s.copy}>
                <Text style={[s.name, { color: c.text }]}>{m.name}</Text>
                <Text numberOfLines={2} style={[s.note, { color: c.secondary }]}>{t(m.description)}</Text>
                <Text style={[s.meta, { color: c.muted }]}>{sizeLabel(m.bytes)} · {t('Offline')}</Text>
                <View style={s.tags}>{m.vision ? <CapabilityTag kind="vision" small /> : null}{m.thinking ? <CapabilityTag kind="thinking" small /> : null}<CapabilityTag kind={m.tools ? 'tools' : 'noTools'} small /></View>
              </View>
              {selection(selected)}
            </Pressable>;
          })}
        </View>
        {!matches.length ? <Text style={[s.empty, { color: c.secondary }]}>{q ? t('No match.') : t('Download a model to chat offline. Your messages stay on this phone.')}</Text> : null}
        <ActionButton title={t('Browse models')} variant="secondary" icon="download" onPress={() => (close(), router.push('/models'))} />
      </> : <>
        {keyed.length === 0 ? <View style={{ gap: 16 }}>
          <Text style={[s.empty, { color: c.secondary }]}>{t('Add a key for a free provider like NVIDIA NIM, Gemini or OpenRouter, and its models show up here.')}</Text>
          <ActionButton title={t('Add a provider')} icon="plus" onPress={() => (close(), router.push('/providers'))} />
        </View> : keyed.map(id => {
          const preset = presetOf(id);
          const list = lists[id];
          const models = (list?.models ?? []).filter(m => !q || m.toLowerCase().includes(q));
          const blocked = !!privacyBlock(id, current.privacy);
          return <View key={id} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={[s.heading, { color: c.muted }]}>{preset?.name ?? id}</Text>
            <PrivacyTag providerId={id} />
            {blocked ? <Text style={[s.note, { color: c.muted }]}>{t('Hidden by your privacy setting. Change it in Settings → Privacy.')}</Text>
              : !list ? <Loader size={20} />
              : list.error ? <Text accessibilityRole="alert" style={[s.note, { color: c.danger }]}>{list.error}</Text>
              : models.length === 0 ? <Text style={[s.note, { color: c.muted }]}>{q ? t('No match.') : t('No chat models on this key.')}</Text>
              : <View accessibilityRole="radiogroup" style={{ gap: 8 }}>{models.slice(0, limits[id] ?? 30).map(m => {
                const selected = current.providerId === id && current.model === m;
                                return <Pressable key={m} onPress={() => pick(id, m)} accessibilityRole="radio" accessibilityState={{ checked: selected }} style={({ pressed }) => [s.card, { backgroundColor: pressed ? c.surface3 : c.surface2, borderColor: selected ? c.text : 'transparent' }]}>
                  <ModelMark model={m} providerId={id} local={false} size={32} />
                  <View style={s.copy}>
                    <Text style={[s.name, { color: c.text }]}>{m}</Text>
                    <View style={s.tags}><CapabilityTag kind="tools" small /></View>
                  </View>
                  {selection(selected)}
                </Pressable>;
              })}{models.length > (limits[id] ?? 30) ? <ActionButton title={t('Show more models')} variant="ghost" onPress={() => setLimits(l => ({ ...l, [id]: (l[id] ?? 30) + 30 }))} /> : null}</View>}
          </View>;
        })}
        {keyed.length > 0 ? <ActionButton title={t('Manage providers')} variant="secondary" icon="settings" onPress={() => (close(), router.push('/providers'))} /> : null}
      </>}
    </View>
  </BottomSheet>;
}

const s = StyleSheet.create({
  content: { gap: 16, paddingTop: 4 },
  tabs: { flexDirection: 'row', borderRadius: 18, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14 },
  tabLabel: { fontFamily: font.semibold, fontSize: fs.base },
  heading: { fontFamily: font.medium, fontSize: fs.xs, textTransform: 'uppercase', letterSpacing: 0.6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 72, borderRadius: 24, borderWidth: 1.5 },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  name: { fontFamily: font.semibold, fontSize: fs.base },
  note: { fontFamily: font.sans, fontSize: fs.sm, lineHeight: 21 },
  meta: { fontFamily: font.medium, fontSize: fs.xs },
  empty: { fontFamily: font.sans, fontSize: fs.base, lineHeight: 24, paddingVertical: 16 },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});

