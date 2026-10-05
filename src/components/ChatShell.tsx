// Shared bottom of every conversation screen: keyboard handling, the beUI prompt input, and dictation
// with Claude-style voice stripes inside the input.
import type { ReactNode } from 'react';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useBottomPad, useColors } from '@/theme';
import { PromptInput, type PromptAttachment } from '@/ui/prompt-input';
import { useVoice } from '@/voice';
type ComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
  onAttach: () => void;
  disabled?: boolean;
  allowSteer?: boolean;
  attachments?: PromptAttachment[];
  onRemoveAttachment?: (id: string) => void;
  onOpenImage?: (id: string) => void;
  tour?: boolean;
};

/**
 * Keeps the composer above the keyboard (Android edge-to-edge included) and the list above it.
 * Chat screens always reach the bottom of the window, so the keyboard's own height is the whole lift.
 * KeyboardAvoidingView measured its position once, and a measurement taken mid-transition left the
 * composer under the keyboard by the header's height.
 */
export function ChatScreen({ children }: { children: ReactNode }) {
  const c = useColors();
  const bottomPad = useBottomPad();
  const { height } = useReanimatedKeyboardAnimation();
  // The composer already pads for the gesture bar; with the keyboard up, that space sits on the keyboard instead.
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -height.get() - bottomPad + 8) }));
  return <Animated.View style={[{ flex: 1, backgroundColor: c.bg }, lift]}>{children}</Animated.View>;
}

export function VoiceComposer({ value, onChangeText, onSend, placeholder, ...rest }: ComposerProps) {
  const voice = useVoice(onChangeText, value);
  const listening = voice.state !== 'idle';

  return (
    <PromptInput
      {...rest}
      value={value}
      // Typing or deleting mid-dictation keeps the edit; the next words land after it.
      onChangeText={text => (listening && voice.edit(text), onChangeText(text))}
      onSend={text => {
        if (listening) voice.cancel();
        onSend(text);
      }}
      placeholder={voice.state === 'listening' ? 'Listening…' : placeholder}
      onVoice={voice.toggle}
      listening={listening}
      voiceLevel={voice.level}
      voiceProcessing={voice.state === 'processing'}
    />
  );
}
