import * as Clipboard from 'expo-clipboard';
import { haptic } from '@/haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useEffect, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { answerApproval, answerQuestion, openSession, sendPrompt, stopSession, useRemote, type LiveTool } from '@/remote/store';
import type { AgentQuestion, ChatEntry } from '@/shared/types';
import { ActionButton } from '@/ui/button-base';
import { ConversationSkeleton } from '@/ui/skeleton';
import { ChatScreen, VoiceComposer } from '@/components/ChatShell';
import { IconButton } from '@/components/Icon';
import { font, fs, useColors } from '@/theme';
import { AnimatedBadge } from '@/ui/animated-badge';
import { FileDiffCard } from '@/ui/file-diff';
import { AssistantMessage } from '@/ui/message';
import { MessageBubble } from '@/ui/message-bubble';
import { ReasoningText } from '@/ui/reasoning-text';
import { ThinkingShimmer } from '@/ui/thinking-shimmer';
import { TodoList } from '@/ui/todo-list';
import { ToolApproval } from '@/ui/tool-approval';
import { ToolResult, type ToolResultStatus } from '@/ui/tool-result';
import { useToast } from '@/ui/toast';

type Row = { key: string; kind: 'entry'; entry: ChatEntry } | { key: string; kind: 'live' };

/** "Read src/app.ts" -> tool "Read", summary "src/app.ts". */
const splitStep = (label: string) => {
  const [tool, ...rest] = label.split(' ');
  return { tool, summary: rest.join(' ') || label };
};
const toolStatus = (s: LiveTool['status']): ToolResultStatus => (s === 'done' ? 'done' : s === 'error' ? 'failed' : 'running');
const lineCount = (text: string) => (text ? text.split('\n').length : 0);

/** The agent's ask-user-question card: one pick per question (several for multi-select), then send. */
function QuestionCard({ questions, onSubmit }: { questions: AgentQuestion[]; onSubmit: (answers: string[]) => void }) {
  const c = useColors();
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const toggle = (qi: number, label: string, multi: boolean) =>
    setPicks(p => p.map((sel, i) => (i !== qi ? sel : multi ? (sel.includes(label) ? sel.filter(l => l !== label) : [...sel, label]) : [label])));
  return (
    <View style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }]}>
      {questions.map((q, qi) => (
        <View key={qi} style={{ gap: 8 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{q.question}</Text>
          {q.options.map(o => (
            <ActionButton key={o.label} title={o.label} variant={picks[qi].includes(o.label) ? 'primary' : 'secondary'} onPress={() => toggle(qi, o.label, q.multiSelect)} />
          ))}
        </View>
      ))}
      <ActionButton title="Send answers" icon="send" disabled={picks.some(p => !p.length)} onPress={() => onSubmit(picks.map(p => p.join(', ')))} />
    </View>
  );
}

export default function DesktopSession() {
  const c = useColors();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useRemote(st => st.sessions.find(x => x.id === id));
  const view = useRemote(st => st.views[id]);
  const connected = useRemote(st => st.status === 'connected');
  const list = useRef<FlatList<Row>>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);
  const follow = useRef(true);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    if (connected) openSession(id).catch(err => toast.show({ title: 'Could not open the session', description: String(err.message ?? err) }));
  }, [id, connected, toast]);

  if (!session) return <Text style={[s.empty, { color: c.muted }]}>This session is not on your desktop anymore.</Text>;

  const rows: Row[] = [...(view?.entries ?? []).map(e => ({ key: e.id, kind: 'entry' as const, entry: e })), ...(view?.live ? [{ key: 'live', kind: 'live' as const }] : [])];
  const pending = view?.pending;

  const run = (p: Promise<unknown>, failure: string) => p.catch(err => toast.show({ title: failure, description: String(err?.message ?? err) }));
  const answer = (approve: boolean, always = false) => {
    if (approve) haptic.success(); else haptic.warning();
    run(answerApproval(id, approve, always), 'Your answer did not reach the desktop');
  };
  const send = async (value: string) => {
    if (!value.trim() || sending) return;
    setSending(true);
    try {
      await sendPrompt(id, value.trim());
      setText(current => current.trim() === value.trim() ? '' : current);
      follow.current = true;
      setScrolledUp(false);
      await openSession(id);
    } catch (err) { toast.show({ title: 'Your message did not reach the desktop', description: String(err) }); }
    finally { setSending(false); }
  };

  const files = (entry: ChatEntry) =>
    (entry.files ?? []).map(f => (
      <FileDiffCard key={f.id} file={f.path} added={lineCount(f.content)} removed={0} onPress={() => router.push(`/diff/${id}/${encodeURIComponent(f.id)}`)} />
    ));

  const render = ({ item }: { item: Row }) => {
    if (item.kind === 'live') {
      const live = view!.live!;
      return (
        <View style={s.block}>
          {live.reasoning ? <ReasoningText text={live.reasoning} streaming={!live.text} /> : null}
          {live.tools.map(t => <ToolResult key={t.id} {...splitStep(t.label)} status={toolStatus(t.status)} />)}
          {live.text ? <AssistantMessage text={live.text} streaming onCopy={() => Clipboard.setStringAsync(live.text)} /> : <ThinkingShimmer label="Working" />}
        </View>
      );
    }
    const e = item.entry;
    if (e.role === 'user') return <MessageBubble text={e.content} animateIn={false} onLongPress={() => Clipboard.setStringAsync(e.content)} />;
    if (e.role === 'note') return <Text style={[s.note, { color: c.muted }]}>{e.content}</Text>;
    return (
      <View style={s.block}>
        {e.thinking ? <ReasoningText text={e.thinking} streaming={false} /> : null}
        {(e.steps ?? []).map((step, i) => <ToolResult key={i} {...splitStep(step)} status="done" />)}
        {files(e)}
        {e.content ? <AssistantMessage text={e.content} streaming={false} onCopy={() => Clipboard.setStringAsync(e.content)} /> : null}
      </View>
    );
  };

  return (
    <ChatScreen>
      <Drawer.Screen
        options={{
          headerTitle: () => (
            <View style={{ alignItems: 'center', maxWidth: width - 112, gap: 2 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{session.title}</Text>
              <Text numberOfLines={1} style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{session.project}</Text>
            </View>
          ),
          headerRight: () => null,
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
        <Text style={{ fontFamily: font.medium, fontSize: fs.xs, color: c.muted }}>DESKTOP · CODE</Text>
        <AnimatedBadge status={!connected ? 'failed' : session.waiting ? 'waiting' : session.running ? 'running' : 'done'} label={!connected ? 'Offline' : session.waiting ? 'Needs you' : session.running ? 'Running' : 'Idle'} />
      </View>
      <View style={{ flex: 1 }}>
      {!view && connected ? <ConversationSkeleton /> : (
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={r => r.key}
        renderItem={render}
        ListHeaderComponent={view?.todos.length ? <View style={s.block}><TodoList todos={view.todos} /></View> : null}
        ListFooterComponent={view?.notices.length ? <Text style={[s.note, { color: c.muted }]}>{view.notices.at(-1)}</Text> : null}
        contentContainerStyle={{ paddingVertical: 16, gap: 16 }}
        onContentSizeChange={() => follow.current && list.current?.scrollToEnd({ animated: false })}
        onLayout={() => list.current?.scrollToEnd({ animated: false })}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: e }) => {
          follow.current = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 100;
          setScrolledUp(!follow.current);
        }}
      />
      )}
      {scrolledUp ? <View style={{ position: 'absolute', bottom: 12, alignSelf: 'center', borderRadius: 24, backgroundColor: c.surface3 }}><IconButton name="chevronDown" label="Jump to latest message" color={c.text} onPress={() => { follow.current = true; setScrolledUp(false); list.current?.scrollToEnd({ animated: true }); }} /></View> : null}
      </View>

      {pending ? (
        <ScrollView style={{ maxHeight: height * 0.35 }} contentContainerStyle={[s.block, { paddingVertical: 8 }]} keyboardShouldPersistTaps="handled">
          {pending.kind === 'question' ? (
            pending.questions?.length ? (
              <QuestionCard questions={pending.questions} onSubmit={answers => run(answerQuestion(id, answers), 'Your answer did not reach the desktop')} />
            ) : (
              <Text style={[s.note, { color: c.secondary }]}>Neru is asking you a question. Answer it on your desktop.</Text>
            )
          ) : (
            <>
              {pending.diff && pending.kind === 'edit' ? (
                <FileDiffCard file={pending.label} added={pending.diff.split('\n').filter(l => l.startsWith('+')).length} removed={pending.diff.split('\n').filter(l => l.startsWith('-')).length} onPress={() => router.push(`/diff/${id}/pending`)} />
              ) : null}
              <ToolApproval
                tool={pending.kind === 'plan' ? 'Plan' : pending.kind[0].toUpperCase() + pending.kind.slice(1)}
                summary={pending.label}
                detail={pending.kind === 'edit' ? '' : (pending.diff ?? '')}
                onApprove={() => answer(true)}
                onDeny={() => answer(false)}
                onAlways={pending.kind === 'plan' ? undefined : () => answer(true, true)}
              />
            </>
          )}
        </ScrollView>
      ) : null}

      <VoiceComposer
        value={text}
        onChangeText={setText}
        onSend={send}
        onStop={() => run(stopSession(id), 'Could not stop the session')}
        streaming={session.running}
        allowSteer
        placeholder={connected ? 'Reply to Neru on your desktop' : 'Your desktop is offline'}
        disabled={!connected || sending}
        onAttach={() => toast.show({ title: 'Attach files on your desktop', description: 'Sessions there read your project directly.' })}
      />
    </ChatScreen>
  );
}

const s = StyleSheet.create({
  block: { paddingHorizontal: 16, gap: 10 },
  card: { padding: 16, gap: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  note: { fontFamily: font.sans, fontSize: fs.sm, paddingHorizontal: 20, textAlign: 'center', lineHeight: 20 },
  empty: { padding: 24, fontFamily: font.sans, fontSize: fs.base },
});
