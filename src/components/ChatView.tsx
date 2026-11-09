import * as Clipboard from 'expo-clipboard';
import { haptic } from '@/haptics';
import { askForNotifications } from '@/notify';
import { router, useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { cameraChat, recoverPhoto } from '@/attach';
import { mergeAttachments, useComposerDraft } from '@/drafts';
import { greeting } from '@/greetings';
import { t as tx } from '@/i18n';
import { ChatScreen, VoiceComposer } from '@/components/ChatShell';
import { MessageRow } from '@/components/MessageRow';
import { Icon, IconButton } from '@/components/Icon';
import { PlusSheet } from '@/components/PlusSheet';
import { expandMessage, visibleText, type Skill } from '@/skills';
import { editMessage, modelLabel, send, setModelSheet, stop, useStore, type Attachment, type Message } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { ImageViewer } from '@/ui/image-viewer';
import { TextReveal } from '@/ui/text-reveal';
import { useToast } from '@/ui/toast';
import { ToolApproval } from '@/ui/tool-approval';
import { Mascot } from '@/ui/mascot';
import { answerToolAsk, useToolAsk } from '@/llm/tools';
import { preloadLocal } from '@/local/runtime';


/** Markdown read aloud sounds like punctuation soup; speak the words only. */
const speakable = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ` ${tx('(code block)')} `)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// Messages created after the screen opened animate in, even when the reply placeholder already sits below
// them; the allowance covers a chat started on the home screen, which mounts just after its first message.
const FRESH_MS = 1000;

const researchOn = new Map<string, boolean>();

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
  const model = useStore(st => (st.settings.model ? modelLabel(st.settings) : ''));
  // Research mode for this chat's next messages: the + sheet's switch. Kept per chat for the app's lifetime, and
  // carried from the new-chat screen into the chat its first message creates.
  const [research, setResearchState] = useState(() => researchOn.get(chatId ?? 'new') ?? false);
  const setResearch = (on: boolean) => {
    researchOn.set(chatId ?? 'new', on);
    setResearchState(on);
  };
  // An on-device model starts loading as the chat opens, while the question is still being typed.
  const localModelId = useStore(st => (st.settings.providerId === 'on-device' ? st.settings.model : ''));
  useEffect(() => {
    if (localModelId) preloadLocal(localModelId);
  }, [localModelId]);
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
  const [hello, setHello] = useState(() => greeting(name, undefined, tx));
  const shown = useRef(false);
  useFocusEffect(useCallback(() => {
    if (shown.current) setHello(greeting(name, undefined, tx));
    shown.current = true;
  }, [name]));

  const messages = chat?.messages ?? [];
  const reversed = [...messages].reverse(); // inverted list: newest first, pinned to the bottom

  const copy = (value: string) => {
    Clipboard.setStringAsync(visibleText(value));
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
    // A leading "/skill" brings its instructions along, and research mode its own; the bubble shows only what was typed.
    const body = expandMessage(value.trim(), { research });
    if (editing && chatId) {
      editMessage(chatId, editing.id, body);
      setEditing(null);
    } else {
      const id = send(chatId, body, pending);
      if (!chatId && research) {
        researchOn.set(id, true);
        setResearch(false);
      }
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
    setText(visibleText(m.text));
  };

  // A skill from the + sheet: "/slug " leads the message, replacing any other skill already there.
  const pickSkill = (skill: Skill) => setText(`/${skill.slug} ${text.replace(/^\s*\/[a-z0-9-]+\s*/i, '')}`);

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

  // Stable callbacks so MessageRow's memo holds: only the streaming row re-renders per token. The React Compiler
  // memoizes these on what they read (toast, speaking, setText), as the old useCallback wrappers did.
  const onCopy = copy;
  const onSpeak = speak;
  const onEdit = startEdit;
  const onOpenImage = openImage;
  const render = ({ item, index }: { item: Message; index: number }) => (
    <MessageRow
      item={item}
      chatId={chatId}
      isLast={index === 0}
      live={index === 0 && streaming}
      fresh={item.createdAt > openedAt - FRESH_MS}
      speaking={speaking === item.id}
      onCopy={onCopy}
      onSpeak={onSpeak}
      onEdit={onEdit}
      onOpenImage={onOpenImage}
    />
  );

  const ask = useToolAsk();

  return (
    <ChatScreen>
      {messages.length ? (
        <View style={{ flex: 1 }}>
          <Animated.FlatList
            ref={list}
            inverted
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
          <Mascot size={84} interactive />
          <TextReveal key={hello} text={hello} style={[s.hello, { color: c.text }]} />
          {hasModel ? null : (
            <ActionButton title={tx('Choose a model')} variant="secondary" onPress={() => setModelSheet(true)} style={{ marginTop: 8 }} />
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
        placeholder={editing ? tx('Edit your message') : tx('Chat with Neru…')}
        onAttach={() => setAttachOpen(true)}
        minimizable={!messages.length && !editing}
        modelLabel={model || undefined}
        onModel={() => setModelSheet(true)}
        attachments={pending}
        onRemoveAttachment={id => setPending(p => p.filter(a => a.id !== id))}
        onOpenImage={id => openImage(pending, id)}
        tour={chatId === null}
      />

      <PlusSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onDismiss={finishAttach}
        chatId={chatId}
        onAttach={attach}
        onSkill={pickSkill}
        research={research}
        onResearch={setResearch}
      />

      <ImageViewer images={viewer?.images.map(a => ({ uri: a.uri, name: a.name })) ?? []} index={viewer?.index ?? null} onClose={() => setViewer(null)} />
    </ChatScreen>
  );
}

const s = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  // Claude's "Let's noodle": big serif, centered under the mascot.
  hello: { fontFamily: font.serif, fontSize: 36, lineHeight: 44, letterSpacing: -0.5, textAlign: 'center', marginTop: 6 },
  error: { gap: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  notice: { fontFamily: font.sans, fontSize: fs.xs, textAlign: 'center', paddingHorizontal: 24, paddingBottom: 4 },
  model: { fontFamily: font.mono, fontSize: fs.xs },
  editing: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, paddingHorizontal: 14, minHeight: 40, borderRadius: 12 },
  jumpWrap: { position: 'absolute', alignSelf: 'center', bottom: 12 },
  jump: { borderRadius: TAP / 2, borderWidth: StyleSheet.hairlineWidth },
});
