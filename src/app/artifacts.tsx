// Artifacts: every page, document, image, diagram and code file models wrote in chats, newest first, pinned on top.
// Cards carry a small live preview (web pages render only while the card is on screen), a filter in the header and
// a floating search button.
import { router, Stack, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ArtifactThumb, THUMB_H } from '@/artifacts/ArtifactView';
import { displayTitle, editedLabel, kindsLabel } from '@/artifacts/kinds';
import { artifactKey, togglePin, useArtifactIndex, usePins, type ArtifactEntry } from '@/artifacts/library';
import { ARTIFACT_KINDS } from '@/artifacts/parse';
import { Icon, IconButton } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { ContextMenu } from '@/ui/context-menu';
import { CARD_RADIUS, EmptyState, SearchField, Squish } from '@/ui/page';
import { SelectSheet } from '@/ui/select';

type Filter = 'all' | 'pinned' | (typeof ARTIFACT_KINDS)[number];

export default function ArtifactsScreen() {
  const c = useColors();
  const bottom = useBottomPad();
  const all = useArtifactIndex();
  const pins = usePins();
  const [filter, setFilter] = useState<Filter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState<Set<string>>(() => new Set());

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pinned = new Set(pins);
    return all
      .filter(e => (filter === 'all' ? true : filter === 'pinned' ? pinned.has(e.key) : e.latest.kind === filter))
      .filter(e => !q || displayTitle(e.latest).toLowerCase().includes(q) || e.chatTitle.toLowerCase().includes(q) || e.latest.content.slice(0, 4000).toLowerCase().includes(q))
      .sort((a, b) => Number(pinned.has(b.key)) - Number(pinned.has(a.key)) || b.updatedAt - a.updatedAt);
  }, [all, pins, filter, query]);

  // Must stay the same function for the FlatList's lifetime.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<ArtifactEntry>[] }) => {
    setVisible(new Set(viewableItems.map(v => v.item.key)));
  }, []);

  const options = useMemo(
    () => [
      { value: 'all', label: t('All') },
      { value: 'pinned', label: t('Pinned') },
      ...ARTIFACT_KINDS.map(k => ({ value: k, label: kindsLabel(k) })),
    ],
    [],
  );

  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery('');
  }, []);

  const filtered = filter !== 'all';
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View>
              <IconButton name="filter" label={t('Filter')} color={c.text} onPress={() => setFilterOpen(true)} style={{ marginRight: -8 }} />
              {filtered ? <View style={[s.dot, { backgroundColor: c.moss }]} /> : null}
            </View>
          ),
        }}
      />
      {searching ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={s.searchRow}>
          <SearchField autoFocus value={query} onChangeText={setQuery} placeholder={t('Search artifacts')} style={{ flex: 1 }} />
          <IconButton name="close" label={t('Close search')} color={c.text} onPress={closeSearch} />
        </Animated.View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={e => e.key}
        renderItem={({ item }) => <ArtifactRow entry={item} pinned={pins.includes(item.key)} visible={visible.has(item.key)} />}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 10, minimumViewTime: 120 }}
        initialNumToRender={6}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottom + 96, gap: 14, flexGrow: 1 }}
        ListEmptyComponent={
          query || filtered ? (
            <EmptyState icon="search" title={t('No matching artifacts')} hint={t('Try another search or filter.')} />
          ) : (
            <EmptyState icon="artifact" title={t('No artifacts yet')} hint={t('Ask for a document, a web page, an image or a code file and it will be kept here.')} />
          )
        }
      />
      {!searching ? (
        <Animated.View entering={FadeIn.duration(180)} style={[s.fab, { bottom: bottom + 16 }]}>
          <Squish onPress={() => setSearching(true)} accessibilityLabel={t('Search artifacts')} style={[s.fabInner, { backgroundColor: c.surface3, borderColor: c.border }]}>
            <Icon name="search" size={26} color={c.text} />
          </Squish>
        </Animated.View>
      ) : null}
      <SelectSheet open={filterOpen} onClose={() => setFilterOpen(false)} title={t('Show')} options={options} value={filter} onChange={v => setFilter(v as Filter)} />
    </View>
  );
}

function ArtifactRow({ entry, pinned, visible }: { entry: ArtifactEntry; pinned: boolean; visible: boolean }) {
  const c = useColors();
  const a = entry.latest;
  const title = displayTitle(a);
  const open = () => router.push(`/artifact/${encodeURIComponent(artifactKey(entry.chatId, a.id))}` as Href);
  const pin = () => (haptic.toggle(!pinned), togglePin(entry.key));
  return (
    <ContextMenu
      items={[
        { label: pinned ? t('Unpin') : t('Pin'), icon: 'pin', onPress: pin },
        { label: t('Open chat'), icon: 'chat', onPress: () => router.push(`/chat/${entry.chatId}`) },
      ]}
    >
      <Squish onPress={open} accessibilityLabel={`${title}, ${editedLabel(entry.updatedAt)}${pinned ? `, ${t('Pinned')}` : ''}`} style={[s.card, { backgroundColor: c.surface2 }]}>
        <ArtifactThumb artifact={a} visible={visible} />
        <View style={{ flex: 1, gap: 6, paddingRight: 30 }}>
          <Text numberOfLines={2} style={{ fontFamily: font.bold, fontSize: fs.lg, lineHeight: 25, color: c.text }}>{title}</Text>
          <View style={s.line}>
            <Icon name="lock" size={16} color={c.muted} />
            <Text style={[s.sub, { color: c.muted }]}>{t('Only you')}</Text>
          </View>
          <Text numberOfLines={1} style={[s.sub, { color: c.muted }]}>{editedLabel(entry.updatedAt)}</Text>
        </View>
        <Pressable
          onPress={pin}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={pinned ? t('Unpin') : t('Pin')}
          accessibilityState={{ selected: pinned }}
          style={[s.pin, { backgroundColor: pinned ? c.mossDeep : 'transparent' }]}
        >
          <Icon name="pin" size={18} color={pinned ? c.sage : c.muted} />
        </Pressable>
      </Squish>
    </ContextMenu>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 14, borderRadius: CARD_RADIUS, minHeight: THUMB_H + 28 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sub: { fontFamily: font.semibold, fontSize: fs.base },
  pin: { position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, paddingRight: 8, paddingBottom: 8 },
  fab: { position: 'absolute', left: 20 },
  fabInner: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, elevation: 6 },
  dot: { position: 'absolute', top: 10, right: 2, width: 8, height: 8, borderRadius: 4 },
});
