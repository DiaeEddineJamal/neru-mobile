import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ChatScreen, VoiceComposer } from '@/components/ChatShell';
import { IconButton } from '@/components/Icon';
import { openTeam, sendTeamMessage, stopTeam, useRemote } from '@/remote/store';
import type { TeamMember, TeamPost } from '@/shared/types';
import { type Colors, font, fs, useColors } from '@/theme';
import { AgentActivity } from '@/ui/agent-activity';
import { AgentLogo } from '@/ui/agent-logo';
import { AssistantMessage } from '@/ui/message';
import { MessageBubble } from '@/ui/message-bubble';
import { ConversationSkeleton } from '@/ui/skeleton';
import { StatusDot } from '@/ui/status-dot';
import { useToast } from '@/ui/toast';

// The desktop's names for each agent CLI (TeamView's AGENT_NAMES, the ones a member can be).
const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', gemini: 'Gemini CLI', cursor: 'Cursor Agent', neru: 'Neru', qwen: 'Qwen Code', amp: 'Amp', droid: 'Factory Droid', goose: 'Goose', crush: 'Crush', aider: 'Aider', auggie: 'Auggie', kiro: 'Kiro CLI' };
/** Consecutive posts by one member within this long read as one group. */
const GROUP_MS = 5 * 60_000;

/** Each member keeps one theme hue, by its place in the team. */
const tints = (c: Colors) => [c.sage, c.link, c.codeChip, c.secondary];
const statusColor = (c: Colors, m?: TeamMember) => (m?.status === 'working' ? c.link : m?.status === 'failed' ? c.danger : m?.status === 'stopped' ? c.codeChip : c.sage);
const statusLabel = (m: TeamMember) => (m.status === 'working' ? 'Working' : m.status === 'failed' ? 'Failed' : m.status === 'stopped' ? 'Stopped' : 'Idle');
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function TeamScreen() {
  const c = useColors();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useRemote(s => s.teamViews[id]);
  const summary = useRemote(s => s.teams.find(t => t.id === id));
  const connected = useRemote(s => s.status === 'connected');
  const list = useRef<FlatList<TeamPost>>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);
  const follow = useRef(true);
  const { width } = useWindowDimensions();

  useEffect(() => {
    if (connected) openTeam(id).catch(err => toast.show({ title: 'Could not open the team', description: String(err?.message ?? err) }));
  }, [id, connected, toast]);

  const send = async (value: string) => {
    if (!value.trim() || sending) return;
    setSending(true);
    try {
      await sendTeamMessage(id, value.trim());
      setText(current => current.trim() === value.trim() ? '' : current);
      follow.current = true;
      setScrolledUp(false);
      await openTeam(id);
    } catch (err) { toast.show({ title: 'Your message did not reach the desktop', description: String(err) }); }
    finally { setSending(false); }
  };

  const members = task?.members ?? [];
  const palette = tints(c);
  const tintOf = (handle: string) => {
    const at = members.findIndex(m => m.handle === handle);
    return at < 0 ? c.muted : palette[at % palette.length];
  };
  const posts = task?.posts ?? [];

  const authorRow = (handle: string, at: number | null) => {
    const tint = tintOf(handle);
    const model = members.find(m => m.handle === handle)?.model;
    return (
      <View style={s.authorRow}>
        <AgentLogo kind={members.find(m => m.handle === handle)?.kind ?? handle} initial={handle} tint={tint} size={20} />
        <Text numberOfLines={1} ellipsizeMode="tail" style={[s.author, { color: tint }]}>@{handle}</Text>
        {model ? <Text numberOfLines={1} ellipsizeMode="tail" style={[s.authorModel, { color: c.muted }]}>{model}</Text> : null}
        <View style={{ flex: 1 }} />
        {at ? <Text style={[s.time, { color: c.muted }]}>{clock(at)}</Text> : <StatusDot color={c.link} pulse size={6} />}
      </View>
    );
  };

  const render = ({ item: p, index }: { item: TeamPost; index: number }) => {
    const prev = posts[index - 1];
    const grouped = !!prev && prev.author === p.author && prev.kind === p.kind && p.at - prev.at < GROUP_MS;
    const top = index === 0 ? 0 : grouped ? 4 : 20;
    if (p.author === 'you') return <View style={{ paddingTop: top }}><MessageBubble text={p.text} animateIn={false} /></View>;
    if (p.kind === 'notice' || p.kind === 'error' || p.kind === 'queued')
      return (
        <View style={[s.noteWrap, { paddingTop: top }]}>
          <Text style={[s.note, { color: p.kind === 'error' ? c.danger : c.muted, backgroundColor: c.surface2, borderColor: c.border }]}>{p.kind === 'queued' ? `Queued · ${p.text}` : p.text}</Text>
        </View>
      );
    return (
      <View style={[s.block, { paddingTop: top }]}>
        {grouped ? null : authorRow(p.author, p.at)}
        {p.steps.length ? <AgentActivity items={p.steps.map((step, i) => ({ id: `${p.id}-${i}`, label: step, status: 'done' }))} /> : null}
        <AssistantMessage text={p.text} streaming={false} onCopy={() => Clipboard.setStringAsync(p.text)} />
      </View>
    );
  };

  const live = Object.entries(task?.live ?? {});
  // "@" at the end of the draft: suggest the members, like the desktop composer.
  const mention = /(^|\s)@([\w-]*)$/.exec(text);
  const query = mention?.[2].toLowerCase() ?? '';
  const mentionItems = mention && task
    ? [...members.map(m => ({ id: m.handle, kind: m.kind, label: AGENT_NAMES[m.kind] ?? m.kind, model: m.model })), { id: 'all', kind: 'all', label: 'Everyone on the task', model: '' }]
        .filter(i => i.id.startsWith(query) || i.label.toLowerCase().startsWith(query))
    : [];
  const running = !!summary?.running || members.some(m => m.status === 'working');
  const [teamColor, teamLabel] = !connected ? [c.danger, 'Offline'] : running ? [c.link, 'Working'] : [c.sage, 'Idle'];

  return (
    <ChatScreen>
      <Drawer.Screen
        options={{
          headerTitle: () => <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text, maxWidth: width - 160 }}>{summary?.title ?? task?.title ?? 'Team'}</Text>,
          headerRight: () => (
            <View accessible accessibilityLabel={`Team ${teamLabel}`} style={s.headerState}>
              <StatusDot color={teamColor} pulse={connected && running} />
              <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: c.secondary }}>{teamLabel}</Text>
            </View>
          ),
        }}
      />
      {members.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.strip, { borderBottomColor: c.border }]} contentContainerStyle={s.stripContent}>
          {members.map(m => (
            <View key={m.handle} accessible accessibilityLabel={`@${m.handle}, ${m.model || AGENT_NAMES[m.kind] || m.kind}, ${statusLabel(m)}`} style={[s.member, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <AgentLogo kind={m.kind} initial={m.handle} tint={tintOf(m.handle)} size={24} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={s.memberTop}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1, minWidth: 0, fontFamily: font.semibold, fontSize: fs.sm, color: c.text }}>@{m.handle}</Text>
                  <StatusDot color={statusColor(c, m)} pulse={m.status === 'working'} size={6} />
                </View>
                <Text numberOfLines={1} ellipsizeMode="tail" style={{ fontFamily: font.mono, fontSize: fs.xs, color: c.muted }}>{m.model || AGENT_NAMES[m.kind] || m.kind}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ flex: 1 }}>
      {!task ? <ConversationSkeleton /> : <FlatList
        ref={list}
        data={posts}
        keyExtractor={p => p.id}
        renderItem={render}
        ListFooterComponent={
          live.length ? (
            <View style={{ gap: 20, paddingTop: posts.length ? 20 : 0 }}>
              {live.map(([handle, l]) => (
                <View key={handle} style={s.block}>
                  {authorRow(handle, null)}
                  {l.steps.length ? <AgentActivity items={l.steps.map((step, i) => ({ id: `${handle}-${i}`, label: step, status: i === l.steps.length - 1 && !l.text ? 'running' : 'done' }))} /> : null}
                  {l.text ? <AssistantMessage text={l.text} streaming onCopy={() => Clipboard.setStringAsync(l.text)} /> : null}
                </View>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={live.length ? null : <Text style={[s.empty, { color: c.muted }]}>Say what you need. Mention @{members[0]?.handle ?? 'claude'} to pick who answers, or @all for everyone.</Text>}
        contentContainerStyle={{ paddingVertical: 16 }}
        onContentSizeChange={() => follow.current && list.current?.scrollToEnd({ animated: false })}
        onLayout={() => list.current?.scrollToEnd({ animated: false })}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: e }) => { follow.current = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 100; setScrolledUp(!follow.current); }}
      />}
      {scrolledUp ? <View style={{ position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: c.surface3, borderRadius: 24 }}><IconButton name="chevronDown" label="Jump to latest message" color={c.text} onPress={() => { follow.current = true; setScrolledUp(false); list.current?.scrollToEnd({ animated: true }); }} /></View> : null}
      </View>
      {mentionItems.length ? (
        <View accessibilityRole="list" accessibilityLabel="Mention a teammate" style={[s.mentions, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <Text style={[s.mentionCaption, { color: c.muted }]}>MENTION A TEAMMATE</Text>
          {mentionItems.map(i => (
            <Pressable key={i.id} onPress={() => setText(current => current.replace(/@([\w-]*)$/, `@${i.id} `))} accessibilityRole="button" accessibilityLabel={`Mention @${i.id}, ${i.label}`} android_ripple={{ color: c.surface3 }} style={s.mention}>
              <AgentLogo kind={i.kind} initial={i.id} tint={i.id === 'all' ? c.secondary : tintOf(i.id)} size={28} />
              <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.text }}>@{i.id}</Text>
                <Text numberOfLines={1} ellipsizeMode="tail" style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.secondary }}>{i.label}</Text>
              </View>
              {i.model ? <Text numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1, fontFamily: font.mono, fontSize: fs.xs, color: c.muted, maxWidth: 140 }}>{i.model}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <VoiceComposer
        value={text}
        onChangeText={setText}
        onSend={send}
        onStop={() => stopTeam(id).catch(err => toast.show({ title: 'Could not stop the team', description: String(err?.message ?? err) }))}
        streaming={running}
        allowSteer
        placeholder={connected ? 'Message the team, @ to mention' : 'Your desktop is offline'}
        disabled={!connected || sending}
        onAttach={() => toast.show({ title: 'Attach files on your desktop', description: 'Team members read your project directly.' })}
      />
    </ChatScreen>
  );
}

const s = StyleSheet.create({
  headerState: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 16 },
  strip: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  // A compact strip of equal cards under the header; any number of members scrolls sideways.
  stripContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  member: { width: 136, height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  block: { paddingHorizontal: 16, gap: 8 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { fontFamily: font.semibold, fontSize: fs.sm, flexShrink: 1, minWidth: 0 },
  authorModel: { fontFamily: font.mono, fontSize: fs.xs, flexShrink: 2, minWidth: 0 },
  time: { fontFamily: font.sans, fontSize: fs.xs },
  noteWrap: { alignItems: 'center', paddingHorizontal: 24 },
  note: { fontFamily: font.sans, fontSize: fs.xs, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  empty: { fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, textAlign: 'center', paddingHorizontal: 32, paddingTop: 48 },
  mentions: { marginHorizontal: 12, marginBottom: 8, paddingVertical: 4, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  mentionCaption: { fontFamily: font.medium, fontSize: fs.xs, paddingHorizontal: 16, paddingVertical: 4 },
  mention: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16 },
});
