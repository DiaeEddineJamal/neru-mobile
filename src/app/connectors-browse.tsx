// Browse connectors: search the catalog, filter by category, and connect with one tap.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ConnectorLogo } from '@/components/connect/ConnectorLogo';
import { useConnectFlow } from '@/components/connect/useConnectFlow';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { catalog, categories, type CatalogEntry, type Category } from '@/mcp/catalog';
import { available, useMcp } from '@/mcp/store';
import { font, fs, useColors } from '@/theme';
import { Loader } from '@/ui/loader';
import { Card, EmptyState, PageScroll, PillButton, SearchField } from '@/ui/page';

type Filter = 'all' | Category;

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => (haptic.select(), onPress())}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      // No android_ripple: on a rounded Pressable it paints a square for a frame before the corners clip it.
      style={({ pressed }) => ({ height: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center', backgroundColor: selected ? c.surface3 : pressed ? `${c.surface3}80` : 'transparent' })}
    >
      <Text style={{ fontFamily: selected ? font.bold : font.semibold, fontSize: fs.md, color: selected ? c.text : c.muted }}>{label}</Text>
    </Pressable>
  );
}

export default function BrowseConnectors() {
  const c = useColors();
  const flow = useConnectFlow();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Re-render when connectors are added or their status changes.
  const connectors = useMcp(st => st.connectors);
  const live = useMcp(st => st.live);

  const notAdded = new Set(available().map(e => e.id));
  const used = categories.filter(cat => catalog.some(e => e.category === cat));
  const q = query.trim().toLowerCase();
  const list = catalog.filter(
    e => (filter === 'all' || e.category === filter) && (!q || [e.name, t(e.description), t(e.category)].some(s => s.toLowerCase().includes(q))),
  );

  /** The added connector for an entry (same address, or the same Google service), if any. */
  const addedAs = (e: CatalogEntry) => {
    if (notAdded.has(e.id)) return null;
    return connectors.find(x => x.url === e.url) ?? connectors.find(x => !!e.logo && x.logo === e.logo) ?? null;
  };

  const trailing = (e: CatalogEntry) => {
    const x = addedAs(e);
    if (x && flow.busy === x.id) return <Loader size={20} />;
    if (x) {
      const ready = live[x.id]?.status === 'ready';
      return (
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/connectors'))} accessibilityRole="button" hitSlop={8}>
          <Text style={{ fontFamily: font.bold, fontSize: fs.md, color: ready ? c.sage : c.muted }}>{ready ? t('Connected') : t('Added')}</Text>
        </Pressable>
      );
    }
    return <PillButton label={t('Connect')} onPress={() => flow.add(e)} style={{ height: 44, paddingHorizontal: 20, borderRadius: 22 }} />;
  };

  return (
    <>
      <PageScroll contentContainerStyle={{ gap: 12 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder={t('Search connectors')} accessibilityLabel={t('Search connectors')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }} style={{ marginHorizontal: -16, flexGrow: 0 }}>
          <View style={{ width: 10 }} />
          <Chip label={t('All')} selected={filter === 'all'} onPress={() => setFilter('all')} />
          {used.map(cat => (
            <Chip key={cat} label={t(cat)} selected={filter === cat} onPress={() => setFilter(cat)} />
          ))}
          <View style={{ width: 10 }} />
        </ScrollView>

        {list.length === 0 ? <EmptyState icon="search" title={t('No connectors found')} hint={t('Try another name, or add any MCP server by its address on the Connectors page.')} /> : null}
        {list.map(e => (
          <Card key={e.id} style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <ConnectorLogo name={e.name} logo={e.logo} color={e.color} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: fs.lg, color: c.text }}>{e.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: font.medium, fontSize: fs.base, color: c.muted }}>
                  {e.auth === 'none' ? t('{category} · No sign-in', { category: t(e.category) }) : t(e.category)}
                </Text>
              </View>
              {trailing(e)}
            </View>
            <Text style={{ fontFamily: font.medium, fontSize: fs.md, lineHeight: 23, color: c.secondary }}>{t(e.description)}</Text>
          </Card>
        ))}
      </PageScroll>
      {flow.sheet}
    </>
  );
}
