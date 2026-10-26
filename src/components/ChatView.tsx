import * as Clipboard from 'expo-clipboard';
import { haptic } from '@/haptics';
import { askForNotifications } from '@/notify';
import { router, useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { cameraChat, pickFiles, pickPhotos, recoverPhoto, takePhoto } from '@/attach';
import { mergeAttachments, useComposerDraft } from '@/drafts';
import { greeting } from '@/greetings';
import { t as tx } from '@/i18n';
import { ChatScreen, VoiceComposer } from '@/components/ChatShell';
import { Icon, IconButton, type IconName } from '@/components/Icon';
import { editMessage, NO_MODEL, retry, send, setModelSheet, stop, useStore, type Attachment, type Message } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { ActionButton } from '@/ui/button-base';
import { ContextMenu } from '@/ui/context-menu';
import { ImageViewer } from '@/ui/image-viewer';
import { AssistantMessage } from '@/ui/message';
import { MessageAttachments } from '@/ui/message-attachments';
import { MessageBubble } from '@/ui/message-bubble';
import { ReasoningText } from '@/ui/reasoning-text';
import { TextReveal } from '@/ui/text-reveal';
import { ThinkingShimmer } from '@/ui/thinking-shimmer';
import { useToast } from '@/ui/toast';
import { ToolApproval } from '@/ui/tool-approval';
import { MascotImage } from '@/ui/mascot';
import { ToolResult } from '@/ui/tool-result';
import { answerToolAsk, useToolAsk } from '@/llm/tools';


/** Markdown read aloud sounds like punctuation soup; speak the words only. */
const speakable = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ` ${tx('(code block)')} `)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

const ROW_GLIDE = LinearTransition.springify().stiffness(340).damping(30).mass(0.8);
// Messages created after the screen opened animate in, even when the reply placeholder already sits below
// them; the allowance covers a chat started on the home screen, which mounts just after its first message.
const FRESH_MS = 1000;

export function ChatView({ chatId }: { chatId: string | null }) {
  const c = useColors();
  const toast = useToast();
  const chat = useStore(st => (chatId ? st.chats.find(x => x.id === chatId) : undefined));
  const streaming = useStore(st => chatId !== null && st.streamingChat === chatId);
  // A soft tap when a reply finishes, as Claude's and ChatGPT's apps do.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming) haptic.light();
    wasStreaming.current = streaming;
  }, [streaming]);
  const notice = useStore(st => (st.notice && st.notice.chatId === chatId ? st.notice.text : null));
  const hasModel = useStore(st => !!st.settings.model);
  const list = useRef<FlatList<Message>>(null);
  const { text, setText, attachments: pending, setAttachments: setPending } = useComposerDraft(chatId ?? 'new');
  const queuedPicker = useRef<(() => Promise<Attachment[]>) | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ images: Attachment[]; index: number } | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [openedAt] = useState(Date.now);
  const name = useStore(st => st.settings.name);
  // A new line every time the new-chat screen comes back into view (it stays mounted in the drawer).
  const [hello, setHello] = useState(() => greeting(name));
  const shown = useRef(false);
  useFocusEffect(useCallback(() => {
    if (shown.current) setHello(greeting(name));
    shown.current = true;
  }, [name]));

  const messages = chat?.messages ?? [];
  const reversed = [...messages].reverse(); // inverted list: newest first, pinned to the bottom

  const copy = (value: string) => {
    Clipboard.setStringAsync(value);
    haptic.light();
    toast.show({ title: tx('Copied') });
  };

  const speak = (m: Message) => {
    if (speaking === m.id) return (Speech.stop(), setSpeaking(null));
    Speech.stop();
    setSpeaking(m.id);
    Speech.speak(speakable(m.text), { onDone: () => setSpeaking(null), onStopped: () => setSpeaking(null), onError: () => setSpeaking(null) });
  };

  const onSend = (value: string) => {
    const body = value.trim();
    if (editing && chatId) {
      editMessage(chatId, editing.id, body);
      setEditing(null);
    } else {
      const id = send(chatId, body, pending);
      // Like Claude's app: ask about notifications once there is a reply worth hearing about.
      void askForNotifications();
      if (!chatId) router.navigate(`/chat/${id}`);
    }
    setText('');
    setPending([]);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const startEdit = (m: Message) => {
    setEditing(m);
    setText(m.text);
  };

  // Launch external activities only after the modal has completely left the screen.
  const attach = (pick: () => Promise<Attachment[]>) => {
    queuedPicker.current = pick;
    setAttachOpen(false);
  };
  const finishAttach = useCallback(() => {
    const pick = queuedPicker.current;
    queuedPicker.current = null;
    if (!pick) return;
    void pick().then(picked => {
      if (picked.length) {
        setPending(p => mergeAttachments(p, picked));
        // Android can recreate the navigation activity while a picker is open.
        // Return to the original composer, whose persisted draft now owns the result.
        router.navigate(chatId ? `/chat/${chatId}` : '/');
      }
    }).catch(error => toast.show({ title: tx('Add to chat'), description: String(error?.message ?? error) }));
  }, [chatId, setPending, toast]);

  // Neru was killed while the camera was open: go back to the chat that asked, and attach the photo there.
  useEffect(() => {
    const target = cameraChat();
    if (!target) return;
    if (target === (chatId ?? 'new')) void recoverPhoto().then(p => p.length && setPending(x => mergeAttachments(x, p)));
    else if (!chatId) router.navigate(target === 'task' ? '/task-new' : target.startsWith('desktop:') ? `/desktop/${target.slice(8)}` : `/chat/${target}`);
  }, [chatId, setPending]);

  const openImage = (items: Attachment[], id: string) => {
    const images = items.filter(a => a.kind === 'image');
    setViewer({ images, index: Math.max(0, images.findIndex(a => a.id === id)) });
  };

  const render = ({ item, index }: { item: Message; index: number }) => {
    const isLast = index === 0;
    if (item.role === 'user')
      return (
        <View style={{ gap: 6 }}>
          {item.attachments?.length ? <MessageAttachments items={item.attachments} onOpenImage={id => openImage(item.attachments!, id)} /> : null}
          {item.text ? (
            <ContextMenu
              items={[
                { label: tx('Copy'), icon: 'copy', onPress: () => copy(item.text) },
                { label: tx('Edit'), icon: 'compose', onPress: () => startEdit(item) },
                { label: tx('Share'), icon: 'share', onPress: () => Share.share({ message: item.text }) },
              ]}
            >
              <MessageBubble text={item.text} animateIn={item.createdAt > openedAt - FRESH_MS} />
            </ContextMenu>
          ) : null}
        </View>
      );
    const live = isLast && streaming;
    return (
      <Animated.View entering={item.createdAt > openedAt - FRESH_MS ? FadeIn.duration(220).delay(120) : undefined} style={{ paddingHorizontal: 20, gap: 8 }}>
        {/* While a reply streams, the orb footer below says what the model is doing, as on the desktop. */}
        {item.reasoning ? <ReasoningText text={item.reasoning} streaming={false} /> : null}
        {(item.tools ?? []).map((t, i) => (
          <ToolResult key={i} tool={t.label} summary={t.status === 'denied' ? tx('{name} · declined', { name: t.name }) : t.name} status={t.status === 'running' ? 'running' : t.status === 'done' ? 'done' : 'failed'} />
        ))}
        {item.error ? (
          <View style={[s.error, { backgroundColor: c.surface2, borderColor: c.border }]} accessibilityLiveRegion="polite">
            <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.danger, lineHeight: 20 }}>{item.error === NO_MODEL ? tx(NO_MODEL) : item.error}</Text>
            {isLast && chatId ? (
              item.error === NO_MODEL ? (
                <ActionButton title={tx('Choose a model')} variant="secondary" icon="sparkles" onPress={() => setModelSheet(true)} />
              ) : (
                <ActionButton title={tx('Try again')} variant="secondary" icon="retry" onPress={() => retry(chatId)} />
              )
            ) : null}
          </View>
        ) : item.text ? (
          <ContextMenu
            disabled={live}
            items={[
              { label: tx('Copy'), icon: 'copy', onPress: () => copy(item.text) },
              { label: speaking === item.id ? tx('Stop reading') : tx('Read aloud'), icon: 'speaker', onPress: () => speak(item) },
              { label: tx('Share'), icon: 'share', onPress: () => Share.share({ message: item.text }) },
              ...(isLast && chatId ? [{ label: tx('Retry'), icon: 'retry' as IconName, onPress: () => retry(chatId) }] : []),
            ]}
          >
            <AssistantMessage text={item.text} streaming={live} onCopy={() => copy(item.text)} onRetry={isLast && chatId ? () => retry(chatId) : undefined} />
          </ContextMenu>
        ) : null}
        {live && !item.error ? <ThinkingShimmer {...(item.text ? { state: 'composing', label: tx('Composing') } : item.reasoning ? { state: 'solving', label: tx('Reasoning') } : { state: 'working', label: tx('Thinking') })} /> : null}
        {!live && item.model && isLast ? <Text style={[s.model, { color: c.muted }]}>{item.model}</Text> : null}
      </Animated.View>
    );
  };

  const ask = useToolAsk();
  const options: [IconName, string, () => Promise<Attachment[]>][] = [
    ['camera', tx('Camera'), () => takePhoto(chatId)],
    ['photo', tx('Photos'), () => pickPhotos(chatId)],
    ['file', tx('Files'), pickFiles],
  ];

  return (
    <ChatScreen>
      {messages.length ? (
        <View style={{ flex: 1 }}>
          <Animated.FlatList
            ref={list}
            inverted
            // Rows glide to make room for a new message instead of jumping, like iMessage.
            itemLayoutAnimation={ROW_GLIDE}
            data={reversed}
            keyExtractor={m => m.id}
            renderItem={render}
            contentContainerStyle={{ paddingVertical: 16, gap: 20 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScroll={e => setScrolledUp(e.nativeEvent.contentOffset.y > 400)}
            scrollEventThrottle={100}
          />
          {scrolledUp ? (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={s.jumpWrap}>
              <IconButton name="chevronDown" label={tx('Jump to the latest message')} color={c.text} onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} style={{ ...s.jump, backgroundColor: c.surface2, borderColor: c.border }} />
            </Animated.View>
          ) : null}
        </View>
      ) : (
        <View style={s.empty}>
          <MascotImage style={{ width: 72, height: 72 }} contentFit="contain" accessibilityIgnoresInvertColors />
          <TextReveal key={hello} text={hello} style={[s.hello, { color: c.text }]} />
          {hasModel ? (
            <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.muted }}>{tx('How can I help?')}</Text>
          ) : (
            <ActionButton title={tx('Choose a model')} variant="secondary" onPress={() => setModelSheet(true)} />
          )}
        </View>
      )}

      {notice ? <Text style={[s.notice, { color: c.muted }]} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {ask && ask.chatId === chatId ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <ToolApproval
            tool={ask.tool.label}
            summary={tx('Let Neru use {tool}?', { tool: ask.tool.title })}
            detail={JSON.stringify(ask.args, null, 2)}
            onApprove={() => (haptic.success(), answerToolAsk('once'))}
            onAlways={() => (haptic.success(), answerToolAsk('always'))}
            onDeny={() => (haptic.warning(), answerToolAsk('deny'))}
          />
        </View>
      ) : null}
      {editing ? (
        <View style={[s.editing, { backgroundColor: c.surface2 }]}>
          <Icon name="compose" size={16} color={c.secondary} />
          <Text style={{ flex: 1, fontFamily: font.medium, fontSize: fs.sm, color: c.secondary }}>{tx('Editing your message')}</Text>
          <Pressable onPress={() => (setEditing(null), setText(''))} accessibilityRole="button" hitSlop={12}>
            <Text style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.text }}>{tx('Cancel')}</Text>
          </Pressable>
        </View>
      ) : null}

      <VoiceComposer
        value={text}
        onChangeText={setText}
        onSend={onSend}
        onStop={stop}
        streaming={streaming}
        placeholder={editing ? tx('Edit your message') : tx('Message Neru')}
        onAttach={() => setAttachOpen(true)}
        attachments={pending}
        onRemoveAttachment={id => setPending(p => p.filter(a => a.id !== id))}
        onOpenImage={id => openImage(pending, id)}
        tour={chatId === null}
      />

      <BottomSheet open={attachOpen} onClose={() => setAttachOpen(false)} onDismiss={finishAttach} title={tx('Add to chat')}>
        <View style={{ flexDirection: 'row', gap: 12, paddingBottom: 8 }}>
          {options.map(([icon, label, pick]) => (
            <Pressable key={label} onPress={() => attach(pick)} accessibilityRole="button" style={[s.tile, { backgroundColor: c.surface3 }]}>
              <Icon name={icon} size={26} color={c.text} />
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.text }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <ActionButton title={tx('Connectors: Gmail, GitHub, Jira…')} variant="secondary" icon="link" onPress={() => (setAttachOpen(false), router.push('/connectors'))} style={{ marginBottom: 8 }} />
      </BottomSheet>

      <ImageViewer images={viewer?.images.map(a => ({ uri: a.uri, name: a.name })) ?? []} index={viewer?.index ?? null} onClose={() => setViewer(null)} />
    </ChatScreen>
  );
}

const s = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  hello: { fontFamily: font.serif, fontSize: fs.display, textAlign: 'center' },
  error: { gap: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  notice: { fontFamily: font.sans, fontSize: fs.xs, textAlign: 'center', paddingHorizontal: 24, paddingBottom: 4 },
  model: { fontFamily: font.mono, fontSize: fs.xs },
  editing: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, paddingHorizontal: 14, minHeight: 40, borderRadius: 12 },
  jumpWrap: { position: 'absolute', alignSelf: 'center', bottom: 12 },
  jump: { borderRadius: TAP / 2, borderWidth: StyleSheet.hairlineWidth },
  tile: { flex: 1, minHeight: TAP * 2, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
