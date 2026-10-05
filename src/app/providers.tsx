import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { score } from '@/llm/fallback';
import { providerPresets, type ProviderPreset } from '@/shared/providerCatalog';
import { chooseModel, getState, saveProviderKey, testKey, useStore } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { useToast } from '@/ui/toast';

const NEEDS_URL = new Set(['custom', 'local', 'ollama']);
// Ollama and local gateways run on a computer, so the phone needs that computer's LAN address.
const LAN_HINT: Record<string, string> = { ollama: 'http://192.168.1.10:11434/v1', local: 'http://192.168.1.10:3001/v1', custom: 'https://api.example.com/v1' };

const groups: [string, ProviderPreset[]][] = [
  ['Free', providerPresets.filter(p => p.freeLimit)],
  ['Your keys', providerPresets.filter(p => !p.freeLimit && !NEEDS_URL.has(p.id))],
  ['On your network', providerPresets.filter(p => NEEDS_URL.has(p.id))],
];

function Editor({ preset, onClose }: { preset: ProviderPreset; onClose: () => void }) {
  const c = useColors();
  const toast = useToast();
  const saved = useStore(s => s.keyed.includes(preset.id));
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(getState().settings.baseUrls[preset.id] ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const models = await testKey(preset.id, key, url);
      await saveProviderKey(preset.id, key, NEEDS_URL.has(preset.id) ? url : undefined);
      // First key: start on its strongest model so the first message just works.
      if (!getState().settings.model && models.length) chooseModel(preset.id, [...models].sort((a, b) => score(b) - score(a))[0]);
      toast.show({ title: `${preset.name} added`, description: `${models.length} models available` });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await saveProviderKey(preset.id, '');
    toast.show({ title: `${preset.name} removed` });
    onClose();
  };

  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 20 }}>{preset.description}</Text>
      {NEEDS_URL.has(preset.id) ? (
        <TextField label="Address" value={url} onChangeText={setUrl} placeholder={LAN_HINT[preset.id]} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      ) : null}
      <TextField label={saved ? 'New API key' : 'API key'} value={key} onChangeText={setKey} placeholder={saved ? 'Saved. Paste to replace it' : 'Paste your key'} secureTextEntry autoCapitalize="none" autoCorrect={false} error={error} />
      {preset.keyUrl ? <ActionButton title="Get a key" variant="ghost" icon="link" onPress={() => Linking.openURL(preset.keyUrl!)} /> : null}
      <ActionButton title="Save" onPress={save} loading={busy} disabled={!key.trim() && !(NEEDS_URL.has(preset.id) && url.trim())} />
      {saved ? <ActionButton title="Remove key" variant="destructive" onPress={remove} /> : null}
    </View>
  );
}

export default function Providers() {
  const c = useColors();
  const keyed = useStore(s => s.keyed);
  const [editing, setEditing] = useState<ProviderPreset | null>(null);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {groups.map(([title, list]) => (
        <View key={title} style={{ marginTop: 16 }}>
          <Text accessibilityRole="header" style={[s.heading, { color: c.muted }]}>{title}</Text>
          <View style={[s.group, { backgroundColor: c.surface2, borderColor: c.border }]}>
            {list.map(p => (
              <Pressable key={p.id} onPress={() => setEditing(p)} accessibilityRole="button" android_ripple={{ color: c.surface3 }} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{p.name}</Text>
                  {p.freeLimit ? <Text numberOfLines={1} style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{p.freeLimit}</Text> : null}
                </View>
                {keyed.includes(p.id) ? <Icon name="check" size={20} color={c.moss} /> : <Icon name="chevronRight" size={18} color={c.muted} />}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <BottomSheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {editing ? <Editor preset={editing} onClose={() => setEditing(null)} /> : null}
      </BottomSheet>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  heading: { fontFamily: font.medium, fontSize: fs.xs, paddingHorizontal: 4, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP + 12, paddingHorizontal: 16 },
});
