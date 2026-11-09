// Port of beui.dev/components/agents/prompt-input (auto-growing field, ghost "+" action, send/stop swap on SPRING_SWAP).
// Not ported: the actions popover (Neru opens its + sheet via onAttach), Enter-to-send (touch keyboards).
// Claude-style layout: a big rounded surface; on an empty chat it starts as one field with a mic and springs open on
// focus to show +, the model pill, the mic and the send / voice / stop button.
// The Claude-style attachment tray and the mic button are Neru additions built from beUI parts: items enter and
// leave like beUI attachment-upload thumbnails (opacity + scale 0.8, 0.2s EASE_OUT) and reflow on SPRING_LAYOUT.
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  type EntryExitAnimationFunction,
  FadeIn,
  FadeOut,
  interpolateColor,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { Button, SwapIcon } from '@/ui/button';
import { DocCard } from '@/ui/message-attachments';
import { EASE_OUT, SPRING_LAYOUT } from '@/ui/motion';
import { TourTarget } from '@/ui/tour';
import { VoiceWaveform } from '@/ui/voice-waveform';
import { t } from '@/i18n';

export type PromptAttachment = { id: string; name: string; uri?: string; kind: 'image' | 'file'; mime?: string };

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  placeholder?: string;
  onAttach: () => void;
  onVoice: () => void;
  /** Dictation is on: the mic shows as active. */
  listening?: boolean;
  attachments?: PromptAttachment[];
  onRemoveAttachment?: (id: string) => void;
  /** Tapping an image thumbnail in the tray. */
  onOpenImage?: (id: string) => void;
  /** Dictation volume 0..1, drawn as Claude-style stripes while listening. */
  voiceLevel?: SharedValue<number>;
  /** Dictation stopped and the last words are still arriving. */
  voiceProcessing?: boolean;
  disabled?: boolean;
  /** Desktop sessions accept follow-ups while running. */
  allowSteer?: boolean;
  /** This composer's controls are stops on the walkthrough (the home screen's). */
  tour?: boolean;
  /** An empty chat: only the field and a mic until focused, then the controls spring open. */
  minimizable?: boolean;
  /** The current model, shown as a pill that opens the model sheet. */
  modelLabel?: string;
  onModel?: () => void;
};

const LINE = 23;
const ICON = 44;
const ROW = 48;
const itemLayout = LinearTransition.springify().stiffness(360).damping(32).mass(0.6); // SPRING_LAYOUT
const ITEM = { duration: 200, easing: EASE_OUT };
const itemIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.8 }] },
    animations: { opacity: withTiming(1, ITEM), transform: [{ scale: withTiming(1, ITEM) }] },
  };
};
const itemOut: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: { opacity: withTiming(0, ITEM), transform: [{ scale: withTiming(0.8, ITEM) }] },
  };
};

export function PromptInput({ value, onChangeText, onSend, onStop, streaming, placeholder = t('Message Neru'), onAttach, onVoice, listening = false, attachments = [], onRemoveAttachment, onOpenImage, voiceLevel, voiceProcessing = false, disabled, allowSteer = false, tour = false, minimizable = false, modelLabel, onModel }: Props) {
  const c = useColors();
  const bottomPad = useBottomPad();
  const reduce = useReducedMotion();
  const focus = useSharedValue(0);
  const [focused, setFocused] = useState(false);
  // border-border/80 → focus-within:border-foreground/25, Tailwind transition-colors (150ms).
  const border = useAnimatedStyle(() => ({ borderColor: interpolateColor(focus.get(), [0, 1], [c.border, `${c.text}40`]) }));
  const canSubmit = (value.trim().length > 0 || attachments.length > 0) && !disabled && (!streaming || allowSteer);
  const showStop = streaming && !canSubmit;

  // Like Claude's empty chat: one row (+, the field and the mic) until it is focused, then the model
  // pill and the send button spring open under the text.
  const expanded = !minimizable || focused || value.length > 0 || attachments.length > 0 || listening || streaming;
  const open = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    open.set(reduce ? withTiming(expanded ? 1 : 0, { duration: 150 }) : withSpring(expanded ? 1 : 0, SPRING_LAYOUT));
  }, [expanded, reduce, open]);
  const rowStyle = useAnimatedStyle(() => ({ height: ROW * open.get(), marginTop: 4 * open.get(), opacity: Math.min(1, Math.max(0, open.get() * 1.4 - 0.4)) }));
  const miniMic = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, open.get() * 1.6), transform: [{ scale: 1 - 0.2 * Math.min(1, open.get()) }] }));

  const submit = () => {
    if (canSubmit) onSend(value.trim());
  };

  const mic = (
    <Button label={listening ? t('Stop dictation') : t('Voice input')} feedback="medium" onPress={onVoice} disabled={disabled} style={[s.icon, { backgroundColor: listening ? c.mossDeep : c.surface3 }]}>
      <Icon name="mic" size={20} color={listening ? c.moss : c.secondary} />
    </Button>
  );

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: bottomPad, backgroundColor: c.bg }}>
      <TourTarget name={tour ? 'prompt' : undefined}>
      <Animated.View style={[s.box, { backgroundColor: c.prompt }, border, disabled && { opacity: 0.6 }]}>
        {attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.tray}>
            {attachments.map(a => (
              <Animated.View key={a.id} entering={reduce ? FadeIn.duration(200) : itemIn} exiting={reduce ? FadeOut.duration(200) : itemOut} layout={reduce ? undefined : itemLayout}>
                {a.kind === 'image' && a.uri ? (
                  onOpenImage ? (
                    <Button label={t('Open {name}', { name: a.name })} onPress={() => onOpenImage(a.id)} pressScale={0.98} hitSlop={0}>
                      <Image source={{ uri: a.uri }} style={[s.thumb, { backgroundColor: c.surface3 }]} contentFit="cover" accessibilityIgnoresInvertColors />
                    </Button>
                  ) : (
                    <Image source={{ uri: a.uri }} style={[s.thumb, { backgroundColor: c.surface3 }]} contentFit="cover" accessibilityLabel={a.name} accessibilityIgnoresInvertColors />
                  )
                ) : (
                  <View accessible accessibilityLabel={t('Attached file {name}', { name: a.name })}>
                    <DocCard name={a.name} mime={a.mime} />
                  </View>
                )}
                {onRemoveAttachment ? (
                  // 20dp badge in the corner; the 28dp pressable plus 10dp slop gives a 48dp target.
                  <Button label={t('Remove {name}', { name: a.name })} onPress={() => onRemoveAttachment(a.id)} hitSlop={10} style={s.remove}>
                    <View style={s.removeBadge}>
                      <Icon name="close" size={11} color="#fff" />
                    </View>
                  </Button>
                ) : null}
              </Animated.View>
            ))}
          </ScrollView>
        ) : null}

        <View>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={`${c.muted}b0`}
            editable={!disabled}
            multiline
            accessibilityLabel={t('Prompt')}
            onFocus={() => (setFocused(true), focus.set(withTiming(1, { duration: 150 })))}
            onBlur={() => (setFocused(false), focus.set(withTiming(0, { duration: 150 })))}
            style={[s.input, { color: c.text }, !expanded && { paddingLeft: ICON + 14, paddingRight: ICON + 10 }]}
          />
          {minimizable ? (
            <>
              <Animated.View style={[s.miniPlus, miniMic]} pointerEvents={expanded ? 'none' : 'auto'}>
                <Button label={t('Add to chat')} onPress={onAttach} disabled={disabled || streaming} style={[s.icon, { backgroundColor: c.surface3 }]}>
                  <Icon name="plus" size={22} color={c.text} />
                </Button>
              </Animated.View>
              <Animated.View style={[s.miniMic, miniMic]} pointerEvents={expanded ? 'none' : 'auto'}>
                <TourTarget name={tour && !expanded ? 'mic' : undefined}>{mic}</TourTarget>
              </Animated.View>
            </>
          ) : null}
        </View>

        <Animated.View style={[s.rowClip, rowStyle]} pointerEvents={expanded ? 'auto' : 'none'}>
          <View style={s.row}>
            <TourTarget name={tour ? 'attach' : undefined}><Button label={t('Add to chat')} onPress={onAttach} disabled={disabled || streaming} style={[s.icon, { backgroundColor: c.surface3 }]}>
              <Icon name="plus" size={22} color={c.text} />
            </Button></TourTarget>
            {modelLabel && onModel && !listening ? (
              <Pressable onPress={() => (haptic.light(), onModel())} accessibilityRole="button" accessibilityLabel={t('Model: {name}. Change model', { name: modelLabel })} hitSlop={4} style={({ pressed }) => [s.pill, { backgroundColor: c.surface3 }, pressed && { opacity: 0.7 }]}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text, flexShrink: 1 }}>{modelLabel}</Text>
              </Pressable>
            ) : null}
            {listening && voiceLevel ? <VoiceWaveform level={voiceLevel} active={!voiceProcessing} color={c.text} /> : <View style={{ flex: 1 }} />}
            <TourTarget name={tour && expanded ? 'mic' : undefined}>{mic}</TourTarget>
            {streaming && canSubmit ? (
              <Button label={t('Stop generating')} onPress={onStop} style={[s.icon, { backgroundColor: c.surface3 }]}>
                <View style={[s.stopSmall, { backgroundColor: c.text }]} />
              </Button>
            ) : null}
            <Button
              label={showStop ? t('Stop generating') : streaming ? t('Send follow-up') : t('Send prompt')}
              feedback={showStop ? 'light' : 'medium'}
              onPress={showStop ? onStop : submit}
              disabled={showStop ? !!disabled : !canSubmit}
              style={[s.icon, { backgroundColor: c.text }]}
            >
              <SwapIcon swapKey={showStop ? 'stop' : 'send'} size={24}>
                {showStop ? (
                  // A big filled square, as in Claude: easy to hit while a reply or an image is being made.
                  <View style={[s.stop, { backgroundColor: c.bg }]} />
                ) : (
                  <Icon name="send" size={20} color={c.bg} strokeWidth={2.2} />
                )}
              </SwapIcon>
            </Button>
          </View>
        </Animated.View>

      </Animated.View>
      </TourTarget>
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderRadius: 30, borderWidth: 1, padding: 8, borderCurve: 'continuous' },
  tray: { gap: 8, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 6 },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  remove: { position: 'absolute', top: 0, right: 0, width: 28, height: 28 },
  removeBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  // One line when minimized (as tall as the mic beside it), grows to 6 lines before scrolling.
  input: { fontFamily: font.sans, fontSize: fs.md, lineHeight: LINE, minHeight: ICON, maxHeight: 6 * LINE + 12, paddingHorizontal: 10, paddingTop: 11, paddingBottom: 8, textAlignVertical: 'top' },
  miniMic: { position: 'absolute', right: 0, top: 0, flexDirection: 'row', gap: 6 },
  miniPlus: { position: 'absolute', left: 0, top: 0 },
  rowClip: { overflow: 'hidden' },
  row: { height: ROW, flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: ICON, height: ICON, borderRadius: ICON / 2 },
  pill: { height: ICON, flexShrink: 1, minWidth: 0, maxWidth: '50%', borderRadius: ICON / 2, paddingHorizontal: 16, justifyContent: 'center' },
  stop: { width: 18, height: 18, borderRadius: 4 },
  stopSmall: { width: 14, height: 14, borderRadius: 3 },
});
