import * as Clipboard from 'expo-clipboard';
import { haptic } from '@/haptics';
import { askForNotifications } from '@/notify';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { pickFiles, pickPhotos, takePhoto } from '@/attach';
import { greeting } from '@/greetings';
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


/** Markdown read aloud sounds like punctuation soup; speak the words only. */
const speakable = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' (code block) ')
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
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
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
    toast.show({ title: 'Copied' });
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

  const attach = async (pick: () => Promise<Attachment[]>) => {
    setAttachOpen(false);
    const picked = await pick();
    if (picked.length) setPending(p => [...p, ...picked]);
  };

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
                { label: 'Copy', icon: 'copy', onPress: () => copy(item.text) },
                { label: 'Edit', icon: 'compose', onPress: () => startEdit(item) },
                { label: 'Share', icon: 'share', onPress: () => Share.share({ message: item.text }) },
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
        {item.error ? (
          <View style={[s.error, { backgroundColor: c.surface2, borderColor: c.border }]} accessibilityLiveRegion="polite">
            <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.danger, lineHeight: 20 }}>{item.error}</Text>
            {isLast && chatId ? (
              item.error === NO_MODEL ? (
                <ActionButton title="Choose a model" variant="secondary" icon="sparkles" onPress={() => setModelSheet(true)} />
              ) : (
                <ActionButton title="Try again" variant="secondary" icon="retry" onPress={() => retry(chatId)} />
              )
            ) : null}
          </View>
        ) : item.text ? (
          <ContextMenu
            disabled={live}
            items={[
              { label: 'Copy', icon: 'copy', onPress: () => copy(item.text) },
              { label: speaking === item.id ? 'Stop reading' : 'Read aloud', icon: 'speaker', onPress: () => speak(item) },
              { label: 'Share', icon: 'share', onPress: () => Share.share({ message: item.text }) },
              ...(isLast && chatId ? [{ label: 'Retry', icon: 'retry' as IconName, onPress: () => retry(chatId) }] : []),
            ]}
          >
            <AssistantMessage text={item.text} streaming={live} onCopy={() => copy(item.text)} onRetry={isLast && chatId ? () => retry(chatId) : undefined} />
          </ContextMenu>
        ) : null}
        {live && !item.error ? <ThinkingShimmer {...(item.text ? { state: 'composing', label: 'Composing' } : item.reasoning ? { state: 'solving', label: 'Reasoning' } : { state: 'working', label: 'Thinking' })} /> : null}
        {!live && item.model && isLast ? <Text style={[s.model, { color: c.muted }]}>{item.model}</Text> : null}
      </Animated.View>
    );
  };

  const options: [IconName, string, () => Promise<Attachment[]>][] = [
    ['camera', 'Camera', takePhoto],
    ['photo', 'Photos', pickPhotos],
    ['file', 'Files', pickFiles],
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
              <IconButton name="chevronDown" label="Jump to the latest message" color={c.text} onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} style={{ ...s.jump, backgroundColor: c.surface2, borderColor: c.border }} />
            </Animated.View>
          ) : null}
        </View>
      ) : (
        <View style={s.empty}>
          <Image source={require('@/assets/images/neru-mascot.png')} style={{ width: 72, height: 72 }} contentFit="contain" accessibilityIgnoresInvertColors />
          <TextReveal key={hello} text={hello} style={[s.hello, { color: c.text }]} />
          {hasModel ? (
            <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.muted }}>How can I help?</Text>
          ) : (
            <ActionButton title="Choose a model" variant="secondary" onPress={() => setModelSheet(true)} />
          )}
        </View>
      )}

      {notice ? <Text style={[s.notice, { color: c.muted }]} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {editing ? (
        <View style={[s.editing, { backgroundColor: c.surface2 }]}>
          <Icon name="compose" size={16} color={c.secondary} />
          <Text style={{ flex: 1, fontFamily: font.medium, fontSize: fs.sm, color: c.secondary }}>Editing your message</Text>
          <Pressable onPress={() => (setEditing(null), setText(''))} accessibilityRole="button" hitSlop={12}>
            <Text style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.text }}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      <VoiceComposer
        value={text}
        onChangeText={setText}
        onSend={onSend}
        onStop={stop}
        streaming={streaming}
        placeholder={editing ? 'Edit your message' : 'Message Neru'}
        onAttach={() => setAttachOpen(true)}
        attachments={pending}
        onRemoveAttachment={id => setPending(p => p.filter(a => a.id !== id))}
        onOpenImage={id => openImage(pending, id)}
        tour={chatId === null}
      />

      <BottomSheet open={attachOpen} onClose={() => setAttachOpen(false)} title="Add to chat">
        <View style={{ flexDirection: 'row', gap: 12, paddingBottom: 8 }}>
          {options.map(([icon, label, pick]) => (
            <Pressable key={label} onPress={() => attach(pick)} accessibilityRole="button" style={[s.tile, { backgroundColor: c.surface3 }]}>
              <Icon name={icon} size={26} color={c.text} />
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.text }}>{label}</Text>
            </Pressable>
          ))}
        </View>
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
