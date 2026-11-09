// Neru's sidebar: a full-screen surface, as in Claude's Android app. The wordmark and search on top, the main places
// (Projects, Artifacts, Scheduled, Desktop), then your projects, pinned chats and recents; your avatar and the
// "+ New session" pill float at the bottom. The paired computer lives in its own panel, opened from the Desktop row.
// Pages (Settings, Projects…) push over the open sidebar and come back to it; chats close it.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname } from 'expo-router';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Keyframe, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Icon, IconButton, type IconName } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t as tx } from '@/i18n';
import { useProjects } from '@/projects';
import { refreshAll, useRemote, type RemoteSession } from '@/remote/store';
import { deleteChat, renameChat, restoreChat, setDraftChat, toggleStar, useStore, type Chat } from '@/store';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { ContextMenu } from '@/ui/context-menu';
import { TextField } from '@/ui/input';
import { MascotImage } from '@/ui/mascot';
import { EASE_OUT } from '@/ui/motion';
import { Group, PillButton, Row, SearchField } from '@/ui/page';
import { PullToRefreshScrollView } from '@/ui/pull-to-refresh';
import { RowsSkeleton } from '@/ui/skeleton';
import { StatusDot } from '@/ui/status-dot';
import { SwipeableRow } from '@/ui/swipeable-row';
import { useToast } from '@/ui/toast';
import { TourTarget } from '@/ui/tour';

// ---- Open state, shared by the layout (which animates it), the header's menu button and the walkthrough. ----
let sidebarOpen = false;
const subscribers = new Set<() => void>();
const setSidebar = (open: boolean) => {
  if (open === sidebarOpen) return;
  sidebarOpen = open;
  if (open) Keyboard.dismiss();
  subscribers.forEach(l => l());
};
const subscribe = (l: () => void) => (subscribers.add(l), () => void subscribers.delete(l));
export const sidebar = { open: () => setSidebar(true), close: () => setSidebar(false), set: setSidebar, isOpen: () => sidebarOpen };
export const useSidebarOpen = () => useSyncExternalStore(subscribe, () => sidebarOpen);

/** Claude's chat-row glyph: a thin, round speech bubble with its tail at the lower left. */
function ChatBubble({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3.5c4.97 0 9 3.36 9 7.75S16.97 19 12 19c-1.05 0-2.06-.15-3-.43L4.5 20.5l1.2-3.6C4.03 15.5 3 13.47 3 11.25 3 6.86 7.03 3.5 12 3.5Z" />
    </Svg>
  );
}

// The Desktop panel slides in from the right over the main one, and back.
const panelIn = (from: 1 | -1) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ translateX: 36 * from }] },
    100: { opacity: 1, transform: [{ translateX: 0 }], easing: EASE_OUT },
  }).duration(300);

/** Deletes a chat with an Undo toast, leaving it first if it is open. */
export function useRemoveChat() {
  const toast = useToast();
  const path = usePathname();
  return (chat: Chat) => {
    deleteChat(chat.id);
    if (path === `/chat/${chat.id}`) router.navigate('/');
    toast.show({ title: tx('Chat deleted'), description: chat.title, action: { label: tx('Undo'), onPress: () => restoreChat(chat) } });
  };
}

/** A chat's options (rename, pin, delete), or straight to renaming it. Used by the sidebar rows and the chat header. */
export function ChatSheet({ chat, mode, onClose }: { chat: Chat | null; mode: 'options' | 'rename'; onClose: () => void }) {
  const remove = useRemoveChat();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [shownFor, setShownFor] = useState<string | null>(null);
  // A new chat (or reopening) starts in the mode asked for, with its current title in the field.
  if (chat && shownFor !== chat.id + mode) {
    setShownFor(chat.id + mode);
    setRenaming(mode === 'rename');
    setTitle(chat.title);
  }
  const close = () => (setShownFor(null), onClose());
  const save = () => {
    if (chat && title.trim()) renameChat(chat.id, title.trim());
    close();
  };
  return (
    <BottomSheet open={!!chat} onClose={close} title={renaming ? tx('Rename chat') : chat?.title}>
      {renaming ? (
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <TextField label={tx('Title')} value={title} onChangeText={setTitle} autoFocus onSubmitEditing={save} returnKeyType="done" />
          <ActionButton title={tx('Save')} onPress={save} disabled={!title.trim()} />
        </View>
      ) : chat ? (
        <Group style={{ marginBottom: 8 }}>
          <Row icon="pencil" title={tx('Rename')} onPress={() => setRenaming(true)} chevron={false} />
          <Row icon="pin" title={chat.starred ? tx('Unpin') : tx('Pin')} onPress={() => (toggleStar(chat.id), close())} chevron={false} />
          <Row icon="trash" title={tx('Delete')} destructive onPress={() => (close(), remove(chat))} chevron={false} />
        </Group>
      ) : null}
    </BottomSheet>
  );
}

/** One big sidebar row: an outline glyph and a bold label. */
function NavRow({ icon, label, onPress, active, trailing, sub, muted, accessibilityLabel }: { icon: ReactNode; label: string; onPress: () => void; active?: boolean; trailing?: ReactNode; sub?: string; muted?: boolean; accessibilityLabel?: string }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => (haptic.light(), onPress())}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!active }}
      android_ripple={{ color: c.surface3 }}
      style={[s.row, active && { backgroundColor: c.surface2 }]}
    >
      <View style={s.glyph}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[s.label, { color: muted ? c.secondary : c.text }]}>{label}</Text>
        {sub ? <Text numberOfLines={1} style={[s.sub, { color: c.muted }]}>{sub}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

function Heading({ children, trailing }: { children: string; trailing?: ReactNode }) {
  const c = useColors();
  return (
    <View style={s.headingRow}>
      <Text accessibilityRole="header" style={[s.heading, { color: c.muted }]}>{children}</Text>
      {trailing}
    </View>
  );
}

function Divider() {
  const c = useColors();
  return <View style={[s.divider, { backgroundColor: c.border }]} />;
}

function Avatar({ size = 56 }: { size?: number }) {
  const c = useColors();
  const uri = useStore(st => st.settings.avatarUri);
  const name = useStore(st => st.settings.fullName?.trim() || st.settings.name?.trim() || '');
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={box} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[box, { backgroundColor: c.mossDeep, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
      {initials ? <Text style={{ fontFamily: font.bold, fontSize: size * 0.36, color: c.sage }}>{initials}</Text> : <MascotImage style={{ width: size * 0.8, height: size * 0.8 }} contentFit="contain" />}
    </View>
  );
}

export function DrawerContent() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = useBottomPad();
  const path = usePathname();
  const reduce = useReducedMotion();
  const open = useSidebarOpen();
  const chats = useStore(st => st.chats);
  const projects = useProjects();
  const remote = useRemote(st => st);
  const remove = useRemoveChat();
  const [panel, setPanel] = useState<'main' | 'desktop'>(() => (/^\/(desktop|team)\//.test(path) ? 'desktop' : 'main'));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<{ chat: Chat; mode: 'options' | 'rename' } | null>(null);

  // Search ends with the sidebar, so it opens on your chats next time.
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => (setSearching(false), setQuery('')), 300);
    return () => clearTimeout(timer);
  }, [open]);

  /** A screen of the chat area: it swaps in under the sidebar as the sidebar slides away. */
  const go = (href: string) => {
    if (href !== path) router.navigate(href as never);
    sidebar.close();
  };
  /** A full page: it slides in over the open sidebar, and Back returns to it. */
  const push = (href: string) => router.push(href as never);
  const newSession = () => (setDraftChat(null), go('/'));
  const enter = (from: 1 | -1) => (reduce ? undefined : panelIn(from));

  const chatRow = (chat: Chat) => {
    const href = `/chat/${chat.id}`;
    const active = path === href;
    return (
      <SwipeableRow
        key={chat.id}
        actions={[
          { key: 'star', label: chat.starred ? tx('Unpin') : tx('Pin'), icon: 'pin', color: c.codeChip, onPress: () => toggleStar(chat.id) },
          { key: 'rename', label: tx('Rename'), icon: 'pencil', color: c.link, onPress: () => setSheet({ chat, mode: 'rename' }) },
          { key: 'delete', label: tx('Delete'), icon: 'trash', color: c.danger, onPress: () => remove(chat) },
        ]}
      >
        <ContextMenu
          items={[
            { label: chat.starred ? tx('Unpin') : tx('Pin'), icon: 'pin', onPress: () => toggleStar(chat.id) },
            { label: tx('Rename'), icon: 'pencil', onPress: () => setSheet({ chat, mode: 'rename' }) },
            { label: tx('Delete'), icon: 'trash', destructive: true, onPress: () => remove(chat) },
          ]}
        >
          <NavRow icon={<ChatBubble color={active ? c.text : c.secondary} />} label={chat.title} active={active} onPress={() => go(href)} />
        </ContextMenu>
      </SwipeableRow>
    );
  };

  const paired = !!remote.desktopName;
  const linkColor = remote.status === 'connected' ? c.sage : remote.status === 'connecting' ? c.codeChip : c.danger;
  const waiting = remote.sessions.filter(x => x.waiting).length;
  const queued = remote.queue.filter(q => q.status === 'queued').length;
  const pinned = chats.filter(ch => ch.starred);
  const recents = chats.filter(ch => !ch.starred);
  const shownProjects = projects.filter(p => !p.archived).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt).slice(0, 3);
  const q = query.trim().toLowerCase();
  const results = q ? chats.filter(ch => ch.title.toLowerCase().includes(q) || ch.messages.some(m => m.text.toLowerCase().includes(q))) : chats;
  const count = (n: number) => (n ? <Text style={[s.count, { color: c.muted }]}>{n}</Text> : null);

  const main = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: bottomPad + 96 }} keyboardShouldPersistTaps="handled">
      {searching ? (
        <>
          {results.map(chatRow)}
          {chats.length === 0 ? <Text style={[s.note, { color: c.muted }]}>{tx('No chats yet. Start one with New session.')}</Text> : null}
          {chats.length > 0 && results.length === 0 ? <Text style={[s.note, { color: c.muted }]}>{tx('No chats match “{query}”.', { query: query.trim() })}</Text> : null}
        </>
      ) : (
        <>
          <NavRow icon={<Icon name="project" size={24} color={c.secondary} />} label={tx('Projects')} muted onPress={() => push('/projects')} />
          <NavRow icon={<Icon name="artifact" size={24} color={c.secondary} />} label={tx('Artifacts')} muted onPress={() => push('/artifacts')} />
          {paired ? <NavRow icon={<Icon name="clock" size={24} color={c.secondary} />} label={tx('Scheduled')} muted onPress={() => push('/tasks')} trailing={count(queued)} /> : null}
          <TourTarget name="sidebar-desktop">
            <NavRow
              icon={<Icon name="laptop" size={24} color={c.secondary} />}
              label={tx('Desktop')}
              muted
              accessibilityLabel={paired ? tx('Desktop: {name}', { name: remote.desktopName ?? '' }) : tx('Desktop: pair a computer')}
              onPress={() => setPanel('desktop')}
              trailing={
                <View style={s.state}>
                  {waiting ? <Text style={[s.count, { color: c.codeChip }]}>{tx('{n} need you', { n: waiting })}</Text> : null}
                  {paired ? <StatusDot color={linkColor} pulse={remote.status === 'connecting'} /> : null}
                  <Icon name="chevronRight" size={20} color={c.muted} />
                </View>
              }
            />
          </TourTarget>

          {shownProjects.length ? (
            <>
              <Divider />
              <Heading>{tx('Projects')}</Heading>
              {shownProjects.map(p => <NavRow key={p.id} icon={<Icon name="project" size={20} color={c.secondary} />} label={p.name} onPress={() => push(`/project/${p.id}`)} />)}
            </>
          ) : null}

          <Divider />
          {pinned.length ? <><Heading>{tx('Pinned')}</Heading>{pinned.map(chatRow)}</> : null}
          <Heading>{tx('Recents')}</Heading>
          {recents.map(chatRow)}
          {chats.length === 0 ? <Text style={[s.note, { color: c.muted }]}>{tx('No chats yet. Start one with New session.')}</Text> : null}
        </>
      )}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: c.surface }}>
      {panel === 'desktop' ? (
        <Animated.View key="desktop" entering={enter(1)} style={{ flex: 1 }}>
          <DesktopPanel onBack={() => setPanel('main')} go={go} push={push} />
        </Animated.View>
      ) : (
        <Animated.View key="main" entering={enter(-1)} style={{ flex: 1 }}>
          <View style={s.top}>
            {searching ? (
              <>
                <SearchField value={query} onChangeText={setQuery} placeholder={tx('Search chats')} autoFocus style={{ flex: 1 }} accessibilityLabel={tx('Search chats')} />
                <IconButton name="close" label={tx('Close search')} color={c.text} onPress={() => (setSearching(false), setQuery(''))} />
              </>
            ) : (
              <>
                <View style={s.brandRow}>
                  <Text style={[s.brand, { color: c.text }]}>Neru</Text>
                  <Text lang="ja" accessibilityLabel={tx('neru, to knead')} style={[s.brandJa, { color: c.muted }]}>練る</Text>
                </View>
                <IconButton name="search" size={26} label={tx('Search chats')} color={c.text} onPress={() => setSearching(true)} />
              </>
            )}
          </View>
          {main}
          <View pointerEvents="box-none" style={[s.bottom, { paddingBottom: bottomPad }]}>
            <LinearGradient pointerEvents="none" colors={[`${c.surface}00`, c.surface]} locations={[0, 0.55]} style={StyleSheet.absoluteFill} />
            <TourTarget name="settings">
              <Pressable onPress={() => (haptic.light(), push('/settings'))} accessibilityRole="button" accessibilityLabel={tx('Settings and profile')} hitSlop={6} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                <Avatar />
              </Pressable>
            </TourTarget>
            <TourTarget name="new-session">
              <PillButton label={tx('New session')} icon="plus" onPress={newSession} />
            </TourTarget>
          </View>
        </Animated.View>
      )}
      <ChatSheet chat={sheet?.chat ?? null} mode={sheet?.mode ?? 'options'} onClose={() => setSheet(null)} />
    </View>
  );
}

/** The paired computer: its status, Code sessions by what they need, and Teams. One place for everything desktop. */
function DesktopPanel({ onBack, go, push }: { onBack: () => void; go: (href: string) => void; push: (href: string) => void }) {
  const c = useColors();
  const bottomPad = useBottomPad();
  const path = usePathname();
  const remote = useRemote(st => st);
  const [refreshing, setRefreshing] = useState(false);
  const paired = !!remote.desktopName;
  const queued = remote.queue.filter(q => q.status === 'queued').length;

  const refresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  const state = (text: string, color: string, pulse = false) => (
    <View style={s.state}>
      <StatusDot color={color} pulse={pulse} />
      <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.secondary }}>{text}</Text>
    </View>
  );
  const glyph = (name: IconName, href: string) => <Icon name={name} size={20} color={path === href ? c.text : c.secondary} />;
  const sessionRow = (x: RemoteSession) => {
    const href = `/desktop/${x.id}`;
    return <NavRow key={x.id} icon={glyph('terminal', href)} label={x.title} sub={x.project} active={path === href} onPress={() => go(href)} trailing={x.waiting ? state(tx('Needs you'), c.codeChip) : x.running ? state(tx('Working'), c.link, true) : undefined} />;
  };
  const section = (label: string, list: RemoteSession[]) => (list.length ? <View key={label}><Heading>{label}</Heading>{list.map(sessionRow)}</View> : null);

  const link = remote.status === 'connected' ? [tx('Connected'), c.sage] : remote.status === 'connecting' ? [tx('Connecting…'), c.codeChip] : [tx('Offline'), c.danger];
  const waiting = remote.sessions.filter(x => x.waiting);
  const running = remote.sessions.filter(x => x.running && !x.waiting);
  const rest = remote.sessions.filter(x => !x.running && !x.waiting).slice(0, 20);

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.top, { paddingLeft: 4 }]}>
        <IconButton name="back" label={tx('Back to chats')} color={c.text} onPress={onBack} />
        <Text accessibilityRole="header" numberOfLines={1} style={[s.panelTitle, { color: c.text }]}>{tx('Desktop')}</Text>
        {paired ? (
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="plus" label={tx('New desktop task')} color={c.text} onPress={() => push('/task-new')} />
            <View>
              <IconButton name="clock" label={queued ? tx('Queue, {n} waiting', { n: queued }) : tx('Queue')} color={c.text} onPress={() => push('/tasks')} />
              {queued ? <View pointerEvents="none" style={[s.dotBadge, { backgroundColor: c.codeChip }]}><Text style={[s.dotBadgeText, { color: c.bg }]}>{queued > 9 ? '9+' : queued}</Text></View> : null}
            </View>
          </View>
        ) : null}
      </View>

      {!paired ? (
        <View style={s.pairCard}>
          <Icon name="laptop" size={36} color={c.secondary} />
          <Text style={{ fontFamily: font.bold, fontSize: fs.xl, color: c.text }}>{tx('Watch your desktop sessions')}</Text>
          <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 22 }}>
            {tx('Pair with Neru on your computer to follow its work, approve changes and reply from here.')}
          </Text>
          <PillButton label={tx('Pair a desktop')} icon="qr" onPress={() => push('/pair')} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        </View>
      ) : (
        <PullToRefreshScrollView refreshing={refreshing} onRefresh={refresh} style={{ flex: 1, backgroundColor: c.surface }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: bottomPad + 24 }}>
          <NavRow
            icon={<Icon name="laptop" size={24} color={c.text} />}
            label={remote.desktopName ?? ''}
            accessibilityLabel={tx('{name}, {status}. Pairing settings', { name: remote.desktopName ?? '', status: link[0] })}
            onPress={() => push('/pair')}
            trailing={<View style={s.state}>{state(link[0], link[1], remote.status === 'connecting')}<Icon name="chevronRight" size={20} color={c.muted} /></View>}
          />
          <Divider />
          {section(tx('Needs you'), waiting)}
          {section(tx('Running'), running)}
          {section(tx('Recent'), rest)}
          {!remote.sessions.length && remote.status === 'connecting' ? <RowsSkeleton count={3} /> : null}
          {!remote.sessions.length && remote.status !== 'connecting' ? <Text style={[s.note, { color: c.muted }]}>{tx('Open a Code session on your desktop. Its conversation and approvals will appear here.')}</Text> : null}

          <Divider />
          <Heading trailing={<Pressable onPress={() => (haptic.light(), push('/team-new'))} accessibilityRole="button" accessibilityLabel={tx('New team task')} hitSlop={8} style={s.headingAction}><Icon name="plus" size={18} color={c.secondary} /><Text style={[s.count, { color: c.secondary }]}>{tx('New')}</Text></Pressable>}>{tx('Teams')}</Heading>
          {remote.teams.map(team => {
            const href = `/team/${team.id}`;
            return <NavRow key={team.id} icon={glyph('team', href)} label={team.title} sub={team.members.length === 1 ? tx('1 member') : tx('{n} members', { n: team.members.length })} active={path === href} onPress={() => go(href)} trailing={team.running ? state(tx('Working'), c.link, true) : undefined} />;
          })}
          {!remote.teams.length && remote.status === 'connecting' ? <RowsSkeleton count={2} /> : null}
          {!remote.teams.length && remote.status !== 'connecting' ? <Text style={[s.note, { color: c.muted }]}>{tx('Start a Team on your desktop, then send messages to its members from here.')}</Text> : null}
          {remote.error ? <Text style={[s.note, { color: c.danger }]}>{remote.error}</Text> : null}
        </PullToRefreshScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 72, paddingLeft: 24, paddingRight: 12, paddingTop: 8, paddingBottom: 8 },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  brand: { fontFamily: font.title, fontSize: 40, lineHeight: 48 },
  brandJa: { fontSize: fs.sm, letterSpacing: 1 },
  panelTitle: { flex: 1, fontFamily: font.title, fontSize: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, overflow: 'hidden' },
  glyph: { width: 28, alignItems: 'center' },
  label: { fontFamily: font.semibold, fontSize: 19 },
  sub: { fontFamily: font.medium, fontSize: fs.sm, marginTop: 1 },
  count: { fontFamily: font.semibold, fontSize: fs.sm },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 18, paddingBottom: 6 },
  heading: { fontFamily: font.semibold, fontSize: 19 },
  headingAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12, marginTop: 12 },
  note: { fontFamily: font.sans, fontSize: fs.sm, padding: 12, paddingTop: 16, lineHeight: 20 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 36 },
  pairCard: { marginHorizontal: 24, marginTop: 24, gap: 10 },
  dotBadge: { position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  dotBadgeText: { fontFamily: font.bold, fontSize: 11 },
});
