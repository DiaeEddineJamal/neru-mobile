// One artifact, full screen: rendered page, image, diagram, document or code, with copy, share, a link back to its
// chat and a switcher between the versions the model wrote with the same id.
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ArtifactBody, CodeView } from '@/artifacts/ArtifactView';
import { displayTitle, editedLabel, fileFor, KIND_ICON, kindLabel } from '@/artifacts/kinds';
import { findArtifact, isStreaming } from '@/artifacts/library';
import type { Artifact } from '@/artifacts/parse';
import { Icon, IconButton } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { EmptyState, Squish } from '@/ui/page';
import { useToast } from '@/ui/toast';

export default function ArtifactScreen() {
  const c = useColors();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chats = useStore(s => s.chats);
  const found = useMemo(() => findArtifact(chats, String(id ?? '')), [chats, id]);
  const [picked, setPicked] = useState<string | null>(null);
  const version = (picked && found?.entry.versions.find(v => v.messageId === picked)) || found?.version;
  const live = useStore(s => !!found && !!version && isStreaming(s, found.entry.chatId, version.messageId));

  if (!found || !version) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Stack.Screen options={{ title: t('Artifact') }} />
        <EmptyState icon="artifact" title={t('Artifact not found')} hint={t('The chat it came from may have been deleted.')} />
      </View>
    );
  }
  const { entry } = found;
  const artifact = version.artifact;
  const writing = artifact.open && live;
  const index = entry.versions.indexOf(version);

  const copy = async () => {
    await Clipboard.setStringAsync(artifact.content);
    haptic.success();
    toast.show({ title: t('Copied') });
  };
  const share = async () => {
    try {
      await shareArtifact(artifact);
    } catch (e) {
      toast.show({ title: t('Could not share'), description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          title: displayTitle(artifact),
          headerRight: () => (
            <View style={{ flexDirection: 'row', marginRight: -8 }}>
              <IconButton name="copy" label={t('Copy')} color={c.text} onPress={() => void copy()} disabled={!artifact.content} />
              <IconButton name="share" label={t('Share')} color={c.text} onPress={() => void share()} disabled={writing || !artifact.content} />
            </View>
          ),
        }}
      />
      <View style={s.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.barContent}>
          <View style={[s.meta, { backgroundColor: c.surface2 }]}>
            <Icon name={KIND_ICON[artifact.kind]} size={16} color={c.secondary} />
            <Text style={[s.metaText, { color: c.secondary }]}>
              {writing ? t('Writing…') : `${artifact.kind === 'code' && artifact.language ? artifact.language : kindLabel(artifact.kind)} · ${editedLabel(version.createdAt)}`}
            </Text>
          </View>
          {entry.versions.length > 1
            ? entry.versions.map((v, i) => {
                const on = v === version;
                return (
                  <Squish key={v.messageId} onPress={() => setPicked(v.messageId)} accessibilityLabel={t('Version {n}', { n: i + 1 })} style={[s.chip, { backgroundColor: on ? c.mossDeep : c.surface2, borderColor: on ? c.moss : 'transparent' }]}>
                    <Text style={[s.metaText, { color: on ? c.sage : c.secondary }]}>{t('v{n}', { n: i + 1 })}</Text>
                  </Squish>
                );
              })
            : null}
          <Squish onPress={() => router.push(`/chat/${entry.chatId}`)} accessibilityLabel={t('Open chat')} style={[s.chip, { backgroundColor: c.surface2, borderColor: 'transparent' }]}>
            <Icon name="chat" size={16} color={c.secondary} />
            <Text numberOfLines={1} style={[s.metaText, { color: c.secondary, maxWidth: 160 }]}>{t('Open chat')}</Text>
          </Squish>
        </ScrollView>
      </View>
      <Animated.View key={`${version.messageId}-${index}`} entering={FadeIn.duration(220)} style={{ flex: 1 }}>
        {/* A page or diagram still being written shows its source; it renders once complete. */}
        {writing && artifact.kind !== 'markdown' && artifact.kind !== 'code' ? <CodeView code={artifact.content} lang={artifact.kind === 'mermaid' ? 'mermaid' : 'html'} /> : <ArtifactBody artifact={artifact} />}
      </Animated.View>
    </View>
  );
}

async function shareArtifact(a: Artifact) {
  const { name, mime } = fileFor(a);
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(a.content);
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('Sharing is not available on this device.'));
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: displayTitle(a) });
}

const s = StyleSheet.create({
  bar: { paddingBottom: 10 },
  barContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 14, borderRadius: 18 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1 },
  metaText: { fontFamily: font.semibold, fontSize: fs.sm },
});
