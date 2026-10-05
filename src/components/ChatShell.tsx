// Shared bottom of every conversation screen: keyboard handling, the beUI prompt input, dictation,
// and the voice glow wrapped around the input the way the desktop composer shows it.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import VoiceGlow from '@/components/VoiceGlow';
import { useColors, useScheme } from '@/theme';
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
};

/** Keeps the composer above the keyboard (Android edge-to-edge included) and the list above it. */
export function ChatScreen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={{ flex: 1, backgroundColor: c.bg }}>
      {children}
    </KeyboardAvoidingView>
  );
}

export function VoiceComposer({ value, onChangeText, onSend, placeholder, ...rest }: ComposerProps) {
  const scheme = useScheme();
  const voice = useVoice(onChangeText, value);
  const listening = voice.state !== 'idle';

  return (
    <PromptInput
      {...rest}
      value={value}
      onChangeText={onChangeText}
      onSend={text => {
        if (listening) voice.stop();
        onSend(text);
      }}
      placeholder={voice.state === 'listening' ? 'Listening…' : placeholder}
      onVoice={voice.toggle}
      listening={listening}
      overlay={
        listening ? (
          <VoiceGlow
            level={voice.level}
            processing={voice.state === 'processing'}
            light={scheme === 'light'}
            dom={{ style: { flex: 1, backgroundColor: scheme === 'light' ? '#ffffff' : '#20201F' }, scrollEnabled: false, containerStyle: { backgroundColor: scheme === 'light' ? '#ffffff' : '#20201F' } }}
          />
        ) : undefined
      }
    />
  );
}
