// One message in a conversation. Kept apart from ChatView so it can be memoized: while a reply streams, only the
// streaming row should re-render, never the rest of the list.
import { memo } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { t as tx } from '@/i18n';
import type { IconName } from '@/components/Icon';
import { NO_MODEL, retry, setModelSheet, type Attachment, type Message } from '@/store';
import { font, fs, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { ContextMenu } from '@/ui/context-menu';
import { AssistantMessage } from '@/ui/message';
import { MessageAttachments } from '@/ui/message-attachments';
import { MessageBubble } from '@/ui/message-bubble';
import { ReasoningText } from '@/ui/reasoning-text';
import { ThinkingShimmer } from '@/ui/thinking-shimmer';
import { useLiveReply } from '@/ui/stream/live';
import { ToolResult } from '@/ui/tool-result';

export type MessageRowProps = {
  item: Message;
  chatId: string | null;
  /** Newest message in the chat. */
  isLast: boolean;
  /** This row is the reply streaming right now. */
  live: boolean;
  /** Created after the screen opened: animate it in. */
  fresh: boolean;
  /** This message is being read aloud. */
  speaking: boolean;
  onCopy: (text: string) => void;
  onSpeak: (m: Message) => void;
  onEdit: (m: Message) => void;
  onOpenImage: (items: Attachment[], id: string) => void;
};

export const MessageRow = memo(function MessageRow({ item, chatId, isLast, live, fresh, speaking, onCopy, onSpeak, onEdit, onOpenImage }: MessageRowProps) {
  const c = useColors();
  // The streaming reply's text comes from the live channel, paced frame by frame, and keeps coming from it for the few
  // frames it needs to catch up after the reply ends. Only this row re-renders for it.
  const stream = useLiveReply(item.id, item.role === 'assistant' && (live || isLast));
  const text = stream ? stream.text : item.text;
  const reasoning = stream ? stream.reasoning : item.reasoning;
  const streaming = live || !!stream;
  if (item.role === 'user')
    return (
      <View style={{ gap: 6 }}>
        {item.attachments?.length ? <MessageAttachments items={item.attachments} onOpenImage={id => onOpenImage(item.attachments!, id)} /> : null}
        {item.text ? (
          <ContextMenu
            items={[
              { label: tx('Copy'), icon: 'copy', onPress: () => onCopy(item.text) },
              { label: tx('Edit'), icon: 'compose', onPress: () => onEdit(item) },
              { label: tx('Share'), icon: 'share', onPress: () => Share.share({ message: item.text }) },
            ]}
          >
            <MessageBubble text={item.text} animateIn={fresh} />
          </ContextMenu>
        ) : null}
      </View>
    );
  return (
    <Animated.View entering={fresh ? FadeIn.duration(220).delay(120) : undefined} style={{ paddingHorizontal: 20, gap: 8 }}>
      {/* While a reply streams, the orb footer below says what the model is doing, as on the desktop. */}
      {reasoning?.trim() ? <ReasoningText text={reasoning.trim()} streaming={false} /> : null}
      {(item.tools ?? []).map((t, i) => (
        <ToolResult key={i} tool={t.label} detail={t.detail} summary={t.status === 'denied' ? tx('{name} · declined', { name: t.name }) : t.name} status={t.status === 'running' ? 'running' : t.status === 'done' ? 'done' : 'failed'} />
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
      ) : text ? (
        <ContextMenu
          disabled={streaming}
          items={[
            { label: tx('Copy'), icon: 'copy', onPress: () => onCopy(item.text) },
            { label: speaking ? tx('Stop reading') : tx('Read aloud'), icon: 'speaker', onPress: () => onSpeak(item) },
            { label: tx('Share'), icon: 'share', onPress: () => Share.share({ message: item.text }) },
            ...(isLast && chatId ? [{ label: tx('Retry'), icon: 'retry' as IconName, onPress: () => retry(chatId) }] : []),
          ]}
        >
          <AssistantMessage text={text} streaming={streaming} chatId={chatId} messageId={item.id} onCopy={() => onCopy(item.text)} onRetry={isLast && chatId ? () => retry(chatId) : undefined} />
        </ContextMenu>
      ) : null}
      {live && !item.error ? <ThinkingShimmer {...(text ? { state: 'composing', label: tx('Composing') } : reasoning?.trim() ? { state: 'solving', label: tx('Reasoning') } : { state: 'working', label: tx('Thinking') })} /> : null}
      {!live && item.model && isLast ? <Text style={[s.model, { color: c.muted }]}>{item.model}</Text> : null}
    </Animated.View>
  );
});

const s = StyleSheet.create({
  error: { gap: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  model: { fontFamily: font.mono, fontSize: fs.xs },
});
