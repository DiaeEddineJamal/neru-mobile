// Port of beui.dev/components/agents/prompt-input (auto-growing field, ghost "+" action, send/stop swap on SPRING_SWAP).
// Not ported: the actions popover and model select (Neru opens its own sheets via onAttach), Enter-to-send (touch keyboards).
// The Claude-style attachment tray and the mic button are Neru additions built from beUI parts: items enter and
// leave like beUI attachment-upload thumbnails (opacity + scale 0.8, 0.2s EASE_OUT) and reflow on SPRING_LAYOUT.
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { font, fs, useBottomPad, useColors } from '@/theme';
import { Button, SwapIcon } from '@/ui/button';
import { DocCard } from '@/ui/message-attachments';
import { EASE_OUT } from '@/ui/motion';
import { TourTarget } from '@/ui/tour';
import { VoiceWaveform } from '@/ui/voice-waveform';

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
};

const LINE = 22;
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

export function PromptInput({ value, onChangeText, onSend, onStop, streaming, placeholder = 'Message Neru', onAttach, onVoice, listening = false, attachments = [], onRemoveAttachment, onOpenImage, voiceLevel, voiceProcessing = false, disabled, allowSteer = false, tour = false }: Props) {
  const c = useColors();
  const bottomPad = useBottomPad();
  const reduce = useReducedMotion();
  const focus = useSharedValue(0);
  // border-border/80 → focus-within:border-foreground/25, Tailwind transition-colors (150ms).
  const border = useAnimatedStyle(() => ({ borderColor: interpolateColor(focus.get(), [0, 1], [c.border, `${c.text}40`]) }));
  const canSubmit = (value.trim().length > 0 || attachments.length > 0) && !disabled && (!streaming || allowSteer);
  const showStop = streaming && !canSubmit;

  const submit = () => {
    if (canSubmit) onSend(value.trim());
  };

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
                    <Button label={`Open ${a.name}`} onPress={() => onOpenImage(a.id)} pressScale={0.98} hitSlop={0}>
                      <Image source={{ uri: a.uri }} style={[s.thumb, { backgroundColor: c.surface3 }]} contentFit="cover" accessibilityIgnoresInvertColors />
                    </Button>
                  ) : (
                    <Image source={{ uri: a.uri }} style={[s.thumb, { backgroundColor: c.surface3 }]} contentFit="cover" accessibilityLabel={a.name} accessibilityIgnoresInvertColors />
                  )
                ) : (
                  <View accessible accessibilityLabel={`Attached file ${a.name}`}>
                    <DocCard name={a.name} mime={a.mime} />
                  </View>
                )}
                {onRemoveAttachment ? (
                  // 20dp badge in the corner; the 28dp pressable plus 10dp slop gives a 48dp target.
                  <Button label={`Remove ${a.name}`} onPress={() => onRemoveAttachment(a.id)} hitSlop={10} style={s.remove}>
                    <View style={s.removeBadge}>
                      <Icon name="close" size={11} color="#fff" />
                    </View>
                  </Button>
                ) : null}
              </Animated.View>
            ))}
          </ScrollView>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={`${c.muted}8c`}
          editable={!disabled}
          multiline
          accessibilityLabel="Prompt"
          onFocus={() => focus.set(withTiming(1, { duration: 150 }))}
          onBlur={() => focus.set(withTiming(0, { duration: 150 }))}
          style={[s.input, { color: c.text }]}
        />

        <View style={s.row}>
          <TourTarget name={tour ? 'attach' : undefined}><Button label="Add photos or files" onPress={onAttach} disabled={disabled || streaming} style={s.icon}>
            <Icon name="plus" size={18} color={c.muted} />
          </Button></TourTarget>
          <TourTarget name={tour ? 'mic' : undefined}><Button label={listening ? 'Stop dictation' : 'Voice input'} feedback="medium" onPress={onVoice} disabled={disabled} style={[s.icon, listening && { backgroundColor: c.mossDeep, borderRadius: 999 }]}>
            <Icon name="mic" size={18} color={listening ? c.moss : c.muted} />
          </Button></TourTarget>
          {listening && voiceLevel ? <VoiceWaveform level={voiceLevel} active={!voiceProcessing} color={c.text} /> : null}
          {streaming && canSubmit ? <Button label="Stop generating" onPress={onStop} style={s.icon}><Icon name="stop" size={12} color={c.muted} /></Button> : null}
          <Button
            label={showStop ? 'Stop generating' : streaming ? 'Send follow-up' : 'Send prompt'}
            feedback={showStop ? 'light' : 'medium'}
            onPress={showStop ? onStop : submit}
            disabled={showStop ? !!disabled : !canSubmit}
            style={[s.icon, { marginLeft: 'auto', backgroundColor: c.mossAction }]}
          >
            <SwapIcon swapKey={showStop ? 'stop' : 'send'} size={16}>
              <Icon name={showStop ? 'stop' : 'send'} size={showStop ? 12 : 16} color={c.onAction} />
            </SwapIcon>
          </Button>
        </View>

      </Animated.View>
      </TourTarget>
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderRadius: 16, borderWidth: 1, padding: 8 },
  tray: { gap: 8, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 6 },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  remove: { position: 'absolute', top: 0, right: 0, width: 28, height: 28 },
  removeBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  // minRows 2, grows to 6 lines before scrolling (beUI caps at 8 on desktop).
  input: { fontFamily: font.sans, fontSize: fs.base, lineHeight: LINE, minHeight: 2 * LINE + 6, maxHeight: 6 * LINE + 6, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 0, textAlignVertical: 'top' },
  // Left icons sit 16 apart (beUI gap-1) so their 48dp hit areas don't overlap.
  row: { marginTop: 4, minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 16 },
  icon: { width: 32, height: 32, borderRadius: 16 },
});
