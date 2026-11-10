// One artifact, full screen: rendered page, image, diagram, document or code, with copy, share, a link back to its
// chat and a switcher between the versions the model wrote with the same id. Opened while the reply is still being
// written, it shows the artifact growing as the model writes it.
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ArtifactBody, CodeView } from '@/artifacts/ArtifactView';
import { displayTitle, editedLabel, iconFor, typeLabel } from '@/artifacts/kinds';
import { findArtifact, isStreaming, parseArtifactKey } from '@/artifacts/library';
import { shareArtifact, shareOptions, type ShareFormat } from '@/artifacts/share';
import { Icon, IconButton } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { useStore, type Chat } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { EmptyState, Squish } from '@/ui/page';
import { useLiveReply } from '@/ui/stream/live';
import { useToast } from '@/ui/toast';

/** The streaming reply's text, at most every `ms`: re-highlighting a long page on every frame would stall the phone. */
function useThrottledLive(messageId: string, ms: number): string | null {
  const live = useLiveReply(messageId, !!messageId);
  const text = live?.text ?? null;
  const [shown, setShown] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (text === null || wait <= 0) {
      last.current = Date.now();
      setShown(text);
      return;
    }
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(text);
    }, wait);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return text === null ? null : shown;
}

/** The chats with the streaming reply's text in place: the store only gets that text when the reply ends. */
function withLiveText(chats: Chat[], messageId: string, text: string | null): Chat[] {
  if (text === null) return chats;
  return chats.map(c => (c.messages.some(m => m.id === messageId) ? { ...c, messages: c.messages.map(m => (m.id === messageId ? { ...m, text } : m)) } : c));
}

export default function ArtifactScreen() {
  const c = useColors();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const key = String(id ?? '');
  const { messageId } = useMemo(() => parseArtifactKey(key), [key]);
  const liveText = useThrottledLive(messageId, 120);
  const chats = useStore(s => s.chats);
  const found = useMemo(() => findArtifact(withLiveText(chats, messageId, liveText), key), [chats, messageId, liveText, key]);
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [sharing, setSharing] = useState<ShareFormat | null>(null);
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
  const lines = artifact.content ? artifact.content.split('\n').length : 0;
  const first = shareOptions(artifact)[0];
  const fileOption = artifact.format || artifact.kind === 'slides' || artifact.kind === 'sheet' ? first : null;

  const copy = async () => {
    await Clipboard.setStringAsync(artifact.content);
    haptic.success();
    toast.show({ title: t('Copied') });
  };
  const share = async (format: ShareFormat) => {
    if (sharing) return;
    setSharing(format);
    try {
      await shareArtifact(artifact, format);
      setSheet(false);
    } catch (e) {
      toast.show({ title: t('Could not share'), description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSharing(null);
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
              <IconButton name="share" label={t('Share')} color={c.text} onPress={() => setSheet(true)} disabled={writing || !artifact.content} />
            </View>
          ),
        }}
      />
      <View style={s.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.barContent}>
          <View style={[s.meta, { backgroundColor: c.surface2 }]}>
            {writing ? <ActivityIndicator size="small" color={c.secondary} /> : <Icon name={iconFor(artifact)} size={16} color={c.secondary} />}
            <Text style={[s.metaText, { color: c.secondary }]} accessibilityLiveRegion={writing ? 'polite' : 'none'}>
              {writing
                ? lines > 1 ? `${t('Writing…')} ${t('{n} lines', { n: lines })}` : t('Writing…')
                : `${artifact.kind === 'code' && artifact.language ? artifact.language : typeLabel(artifact)} · ${editedLabel(version.createdAt)}`}
            </Text>
          </View>
          {/* A file artifact (Word, PDF, PowerPoint, Excel) gets its file one tap away, like a download button. */}
          {fileOption && !writing ? (
            <Squish onPress={() => void share(fileOption.format)} disabled={sharing !== null} accessibilityLabel={t('Share {name}', { name: fileOption.label })} style={[s.chip, { backgroundColor: c.mossDeep, borderColor: c.moss }]}>
              {sharing === fileOption.format ? <ActivityIndicator size="small" color={c.sage} /> : <Icon name="share" size={16} color={c.sage} />}
              <Text numberOfLines={1} style={[s.metaText, { color: c.sage }]}>{`.${fileOption.format}`}</Text>
            </Squish>
          ) : null}
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
      {/* The body stays mounted while the artifact grows (so it keeps its scroll), and remounts once when it is done. */}
      <Animated.View key={`${version.messageId}-${index}-${writing ? 'source' : 'done'}`} entering={FadeIn.duration(220)} style={{ flex: 1 }}>
        {/* A page or diagram still being written shows its source as it arrives; it renders once complete. */}
        {writing && artifact.kind !== 'markdown' && artifact.kind !== 'code' ? <CodeView code={artifact.content} lang={artifact.kind === 'mermaid' ? 'mermaid' : 'html'} follow /> : <ArtifactBody artifact={artifact} follow={writing} />}
      </Animated.View>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title={t('Share as')}>
        <View style={s.list}>
          {shareOptions(artifact).map(o => (
            <Pressable
              key={o.format}
              accessibilityRole="button"
              accessibilityLabel={`${o.label}, ${o.description}`}
              disabled={sharing !== null}
              onPress={() => (haptic.light(), void share(o.format))}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: c.surface3 }]}
            >
              <View style={[s.rowIcon, { backgroundColor: c.surface3 }]}>
                <Icon name={o.icon} size={20} color={c.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.rowLabel, { color: c.text }]}>{o.label}</Text>
                <Text numberOfLines={1} style={[s.rowHint, { color: c.muted }]}>{o.description}</Text>
              </View>
              {sharing === o.format ? <ActivityIndicator size="small" color={c.muted} /> : null}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { paddingBottom: 10 },
  barContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 14, borderRadius: 18 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1 },
  metaText: { fontFamily: font.semibold, fontSize: fs.sm },
  list: { padding: 4, gap: 2 },
  row: { minHeight: TAP + 12, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontFamily: font.semibold, fontSize: fs.base },
  rowHint: { fontFamily: font.sans, fontSize: fs.sm, marginTop: 1 },
});
