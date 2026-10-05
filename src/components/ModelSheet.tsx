import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { localModels } from '@/local/catalog';
import { refreshDownloads, useDownloads } from '@/local/models';
import { chooseModel, modelsFor, presetOf, setModelSheet, useStore } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { Loader } from '@/ui/loader';

type List = { models: string[]; error?: string } | undefined;

/** Every chat model your saved keys can call, grouped by provider, with search. */
export function ModelSheet() {
  const c = useColors();
  const open = useStore(s => s.modelSheet);
  const keyed = useStore(s => s.keyed);
  const current = useStore(s => s.settings);
  const [lists, setLists] = useState<Record<string, List>>({});
  const [query, setQuery] = useState('');
  const downloads = useDownloads();

  useEffect(() => {
    if (!open) return;
    void refreshDownloads().catch(() => {});
    for (const id of keyed)
      modelsFor(id)
        .then(models => setLists(l => ({ ...l, [id]: { models } })))
        .catch(err => setLists(l => ({ ...l, [id]: { models: [], error: err instanceof Error ? err.message : String(err) } })));
  }, [open, keyed]);

  const close = () => (setModelSheet(false), setQuery(''));
  const pick = (providerId: string, model: string) => {
    Haptics.selectionAsync();
    chooseModel(providerId, model);
    close();
  };
  const q = query.trim().toLowerCase();

  return (
    <BottomSheet open={open} onClose={close} title="Model">
      <View style={{ gap: 8, paddingBottom: 16 }}>
        <Text style={[s.heading, { color: c.muted }]}>Pocket Lab · Offline</Text>
        {localModels.filter(m => m.kind !== 'segmenter' && downloads[m.id]?.phase === 'ready').map(m => <Pressable key={m.id} onPress={() => pick('on-device', m.id)} accessibilityRole="radio" accessibilityState={{ checked: current.providerId === 'on-device' && current.model === m.id }} style={s.row}><Text style={{ flex: 1, color: c.text, fontFamily: font.medium, fontSize: fs.base }}>{m.name}</Text><Icon name={current.providerId === 'on-device' && current.model === m.id ? 'check' : 'sparkles'} size={18} color={c.moss} /></Pressable>)}
        <ActionButton title="Explore Pocket Lab" variant="secondary" icon="download" onPress={() => (close(), router.push('/models'))} />
      </View>
      {keyed.length === 0 ? (
        <View style={{ gap: 16, paddingVertical: 8 }}>
          <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 22 }}>
            Add a key for a free provider like NVIDIA NIM, Gemini or OpenRouter, and its models show up here.
          </Text>
          <ActionButton title="Add a provider" icon="plus" onPress={() => (close(), router.push('/providers'))} />
        </View>
      ) : (
        <>
          <TextField label="Search models" value={query} onChangeText={setQuery} placeholder="qwen, gemini, llama…" autoCapitalize="none" autoCorrect={false} />
          <ScrollView style={{ marginTop: 8 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {keyed.map(id => {
              const preset = presetOf(id);
              const list = lists[id];
              const models = (list?.models ?? []).filter(m => !q || m.toLowerCase().includes(q));
              return (
                <View key={id}>
                  <Text accessibilityRole="header" style={[s.heading, { color: c.muted }]}>
                    {preset?.name ?? id}
                    {preset?.freeLimit ? ` · ${preset.freeLimit}` : ''}
                  </Text>
                  {!list ? (
                    <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                      <Loader size={20} />
                    </View>
                  ) : list.error ? (
                    <Text style={[s.note, { color: c.danger }]}>{list.error}</Text>
                  ) : models.length === 0 ? (
                    <Text style={[s.note, { color: c.muted }]}>{q ? 'No match.' : 'No chat models on this key.'}</Text>
                  ) : (
                    models.slice(0, q ? 50 : 30).map(m => {
                      const selected = current.providerId === id && current.model === m;
                      return (
                        <Pressable key={m} onPress={() => pick(id, m)} accessibilityRole="radio" accessibilityState={{ checked: selected }} android_ripple={{ color: c.surface3 }} style={s.row}>
                          <Text numberOfLines={1} style={{ flex: 1, fontFamily: selected ? font.semibold : font.sans, fontSize: fs.base, color: c.text }}>{m}</Text>
                          {selected ? <Icon name="check" size={20} color={c.moss} /> : null}
                        </Pressable>
                      );
                    })
                  )}
                </View>
              );
            })}
            <View style={{ paddingVertical: 16 }}>
              <ActionButton title="Manage providers" variant="ghost" icon="settings" onPress={() => (close(), router.push('/providers'))} />
            </View>
          </ScrollView>
        </>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  heading: { fontFamily: font.medium, fontSize: fs.xs, paddingTop: 16, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP },
  note: { fontFamily: font.sans, fontSize: fs.sm, paddingVertical: 8, lineHeight: 20 },
});
