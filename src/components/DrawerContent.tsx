import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated, { Keyframe, useReducedMotion } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { refreshAll, useRemote, type RemoteSession } from '@/remote/store';
import { deleteChat, renameChat, restoreChat, toggleStar, useStore, type Chat } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { ContextMenu } from '@/ui/context-menu';
import { EASE_OUT } from '@/ui/motion';
import { TextField } from '@/ui/input';
import { PullToRefreshScrollView } from '@/ui/pull-to-refresh';
import { SwipeableRow } from '@/ui/swipeable-row';
import { RowsSkeleton } from '@/ui/skeleton';
import { StatusDot } from '@/ui/status-dot';
import { SegmentedTabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';

// Claude's drawer: starred chats on top, then everything else newest first under "Recents".
function groupChats(chats: Chat[]) {
  const groups: [string, Chat[]][] = [['Starred', chats.filter(ch => ch.starred)], ['Recents', chats.filter(ch => !ch.starred)]];
  return groups.filter(([, list]) => list.length);
}

// Claude's chat-row glyph: a thin, round speech bubble with its tail at the lower left.
function ChatBubble({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3.5c4.97 0 9 3.36 9 7.75S16.97 19 12 19c-1.05 0-2.06-.15-3-.43L4.5 20.5l1.2-3.6C4.03 15.5 3 13.47 3 11.25 3 6.86 7.03 3.5 12 3.5Z" />
    </Svg>
  );
}

// Panels slide a few points in from the side they were picked on and fade up, so the switch reads as one motion.
const panelIn = (from: 1 | -1) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ translateX: 28 * from }, { scale: 0.985 }] },
    100: { opacity: 1, transform: [{ translateX: 0 }, { scale: 1 }], easing: EASE_OUT },
  }).duration(460);

export function DrawerContent({ close }: { close: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const toast = useToast();
  const chats = useStore(s => s.chats);
  const remote = useRemote(s => s);
  const [tab, setTab] = useState(path.startsWith('/desktop') || path.startsWith('/team') ? 'desktop' : 'chats');
  const [desktopMode, setDesktopMode] = useState(path.startsWith('/team') ? 'team' : 'code');
  const [refreshing, setRefreshing] = useState(false);
  const reduce = useReducedMotion();
  const enter = (from: 1 | -1) => (reduce ? undefined : panelIn(from));
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<Chat | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? chats.filter(ch => ch.title.toLowerCase().includes(q) || ch.messages.some(m => m.text.toLowerCase().includes(q))) : chats;
  const startRename = (chat: Chat) => (setRenaming(chat), setNewTitle(chat.title));
  const saveRename = () => {
    if (renaming && newTitle.trim()) renameChat(renaming.id, newTitle.trim());
    setRenaming(null);
  };

  // expo-router applies a navigation a moment later, carrying the drawer's open state from before it, so a close
  // sent alongside it gets undone. Close once the route has actually changed instead.
  const go = (href: string) => (href === path ? close() : router.navigate(href as never));
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    close();
  }, [path, close]);

  const remove = (chat: Chat) => {
    deleteChat(chat.id);
    if (path === `/chat/${chat.id}`) router.navigate('/');
    toast.show({ title: 'Chat deleted', description: chat.title, action: { label: 'Undo', onPress: () => restoreChat(chat) } });
  };

  const row = (key: string, label: string, href: string, opts: { sub?: string; trailing?: ReactNode; icon?: ReactNode } = {}) => {
    const active = path === href;
    return (
      <Pressable
        key={key}
        onPress={() => go(href)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        android_ripple={{ color: c.surface3 }}
        style={[s.row, active && { backgroundColor: c.surface3 }]}
      >
        {opts.icon}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: active ? font.medium : font.sans, fontSize: fs.base, color: c.text }}>{label}</Text>
          {opts.sub ? <Text numberOfLines={1} style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{opts.sub}</Text> : null}
        </View>
        {opts.trailing}
      </Pressable>
    );
  };

  const heading = (label: string) => (
    <Text key={`h-${label}`} accessibilityRole="header" style={[s.heading, { color: c.muted }]}>{label}</Text>
  );

  const chatRow = (chat: Chat) => (
    <SwipeableRow
      key={chat.id}
      actions={[
        { key: 'star', label: chat.starred ? 'Unstar' : 'Star', icon: 'star', color: c.codeChip, onPress: () => toggleStar(chat.id) },
        { key: 'rename', label: 'Rename', icon: 'compose', color: c.link, onPress: () => startRename(chat) },
        { key: 'delete', label: 'Delete', icon: 'trash', color: c.danger, onPress: () => remove(chat) },
      ]}
    >
      <ContextMenu
        items={[
          { label: chat.starred ? 'Unstar' : 'Star', icon: 'star', onPress: () => toggleStar(chat.id) },
          { label: 'Rename', icon: 'compose', onPress: () => startRename(chat) },
          { label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(chat) },
        ]}
      >
        {row(chat.id, chat.title, `/chat/${chat.id}`, { icon: <ChatBubble color={path === `/chat/${chat.id}` ? c.text : c.muted} /> })}
      </ContextMenu>
    </SwipeableRow>
  );

  const desktop = () => {
    if (!remote.desktopName)
      return (
        <View style={s.pairCard}>
          <Icon name="desktop" size={28} color={c.sage} />
          <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>Watch your desktop sessions</Text>
          <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 20 }}>
            Pair with Neru on your computer to follow its work, approve changes and reply from here.
          </Text>
          <ActionButton title="Pair a desktop" icon="qr" onPress={() => go('/pair')} />
        </View>
      );
    const waiting = remote.sessions.filter(x => x.waiting);
    const running = remote.sessions.filter(x => x.running && !x.waiting);
    const rest = remote.sessions.filter(x => !x.running && !x.waiting).slice(0, 20);
    const state = (text: string, color: string, pulse = false) => (
      <View style={s.state}>
        <StatusDot color={color} pulse={pulse} />
        <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: c.secondary }}>{text}</Text>
      </View>
    );
    const sessionState = (x: RemoteSession) => (x.waiting ? state('Needs you', c.codeChip) : x.running ? state('Working', c.link, true) : undefined);
    const glyph = (name: 'terminal' | 'team', href: string) => <Icon name={name} size={17} color={path === href ? c.text : c.muted} />;
    const section = (label: string, list: RemoteSession[]) =>
      list.length ? [heading(label), ...list.map(x => row(x.id, x.title, `/desktop/${x.id}`, { sub: x.project, icon: glyph('terminal', `/desktop/${x.id}`), trailing: sessionState(x) }))] : [];
    const link = { connected: ['Connected', c.sage], connecting: ['Connecting…', c.codeChip], offline: ['Offline', c.danger] } as const;
    const [linkText, linkColor] = link[remote.status === 'connected' ? 'connected' : remote.status === 'connecting' ? 'connecting' : 'offline'];
    return [
      <Pressable key="device" onPress={() => go('/pair')} accessibilityRole="button" accessibilityLabel={`${remote.desktopName}, ${linkText}. Pairing settings`} android_ripple={{ color: c.surface3 }} style={[s.device, { backgroundColor: c.surface2, borderColor: c.border }]}>
        <View style={[s.deviceIcon, { backgroundColor: c.surface3 }]}><Icon name="laptop" size={20} color={c.text} /></View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{remote.desktopName}</Text>
          <View style={s.state}>
            <StatusDot color={linkColor} pulse={remote.status === 'connecting'} />
            <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary }}>{linkText}</Text>
          </View>
        </View>
        <Icon name="chevronRight" size={18} color={c.muted} />
      </Pressable>,
      <View key="mode" style={s.mode}><SegmentedTabs items={[{ value: 'code', label: 'Code' }, { value: 'team', label: 'Team' }]} value={desktopMode} onChange={setDesktopMode} /></View>,
      <Animated.View key={`mode-${desktopMode}`} entering={enter(desktopMode === 'team' ? 1 : -1)}>
        {desktopMode === 'code' ? <>
          {section('Needs you', waiting)}{section('Running', running)}{section('Recent', rest)}
          {!remote.sessions.length && remote.status === 'connecting' ? <RowsSkeleton /> : null}
          {!remote.sessions.length && remote.status !== 'connecting' ? <Text style={[s.note, { color: c.muted }]}>Open a Code session on your desktop. Its conversation and approvals will appear here.</Text> : null}
        </> : <>
          <ActionButton key="new-team" title="New task" icon="plus" variant="secondary" onPress={() => go('/team-new')} style={{ marginHorizontal: 16, marginBottom: 8 }} />
          {remote.teams.map(t => row(t.id, t.title, `/team/${t.id}`, { sub: `${t.members.length} ${t.members.length === 1 ? 'member' : 'members'}`, icon: glyph('team', `/team/${t.id}`), trailing: t.running ? state('Working', c.link, true) : undefined }))}
          {!remote.teams.length && remote.status === 'connecting' ? <RowsSkeleton /> : null}
          {!remote.teams.length && remote.status !== 'connecting' ? <Text style={[s.note, { color: c.muted }]}>Start a Team on your desktop, then send messages to its members from here.</Text> : null}
        </>}
      </Animated.View>,
      remote.error ? <Text key="err" style={[s.note, { color: c.danger }]}>{remote.error}</Text> : null,
    ];
  };

  const refresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 8, backgroundColor: c.surface }}>
      <View style={s.brandRow}>
        <Text style={[s.brand, { color: c.text }]}>Neru</Text>
        <Text lang="ja" accessibilityLabel="neru, to knead" style={[s.brandJa, { color: c.muted }]}>練る</Text>
      </View>
      <View style={{ paddingHorizontal: 12, gap: 12 }}>
        <ActionButton title="New chat" icon="compose" variant="secondary" onPress={() => go('/')} />
        <SegmentedTabs items={[{ value: 'chats', label: 'Chats', icon: color => <ChatBubble color={color} size={17} /> }, { value: 'desktop', label: 'Desktop', icon: color => <Icon name="laptop" size={17} color={color} /> }]} value={tab} onChange={setTab} />
      </View>

      <Animated.View key={tab} entering={enter(tab === 'desktop' ? 1 : -1)} style={{ flex: 1 }}>
      {tab === 'chats' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          {chats.length > 3 ? (
            <View style={{ paddingHorizontal: 4, paddingTop: 12 }}>
              <TextField label="Search chats" value={query} onChangeText={setQuery} placeholder="Search titles and messages" autoCorrect={false} returnKeyType="search" />
            </View>
          ) : null}
          {groupChats(shown).flatMap(([label, list]) => [heading(label), ...list.map(chatRow)])}
          {chats.length === 0 ? <Text style={[s.note, { color: c.muted }]}>No chats yet. Start one with New chat.</Text> : null}
          {chats.length > 0 && shown.length === 0 ? <Text style={[s.note, { color: c.muted }]}>No chats match “{query.trim()}”.</Text> : null}
        </ScrollView>
      ) : (
        <PullToRefreshScrollView refreshing={refreshing} onRefresh={refresh} style={{ flex: 1, backgroundColor: c.surface }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}>
          {desktop()}
        </PullToRefreshScrollView>
      )}
      </Animated.View>

      <BottomSheet open={!!renaming} onClose={() => setRenaming(null)} title="Rename chat">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <TextField label="Title" value={newTitle} onChangeText={setNewTitle} autoFocus onSubmitEditing={saveRename} returnKeyType="done" />
          <ActionButton title="Save" onPress={saveRename} disabled={!newTitle.trim()} />
        </View>
      </BottomSheet>

      <Pressable
        onPress={() => (close(), router.push('/settings'))}
        accessibilityRole="button"
        android_ripple={{ color: c.surface3 }}
        style={[s.row, s.footer, { borderTopColor: c.border, paddingBottom: insets.bottom + 8 }]}
      >
        <Icon name="settings" size={20} color={c.secondary} />
        <Text style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>Settings</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 20, paddingBottom: 8 },
  brand: { fontFamily: font.serif, fontSize: 30 },
  brandJa: { fontSize: fs.sm, letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, overflow: 'hidden' },
  heading: { fontFamily: font.medium, fontSize: fs.sm, paddingHorizontal: 12, paddingTop: 20, paddingBottom: 6 },
  note: { fontFamily: font.sans, fontSize: fs.sm, padding: 12, paddingTop: 20, lineHeight: 20 },
  pairCard: { margin: 8, marginTop: 20, padding: 16, gap: 10, borderRadius: 16 },
  device: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 4, marginTop: 14, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  deviceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mode: { paddingHorizontal: 4, paddingTop: 14, paddingBottom: 2 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0, paddingHorizontal: 20, paddingTop: 8 },
});
