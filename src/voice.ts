// Dictation with the platform speech recognizer. Text streams into the composer as you speak,
// and the volume drives the voice glow.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { getState } from '@/store';

export type VoiceState = 'idle' | 'listening' | 'processing';

/** `onText(base, spoken)`: the composer text from before dictation and everything said since. */
export function useVoice(onText: (text: string) => void, currentText: string) {
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const base = useRef('');
  const finals = useRef('');

  const join = (...parts: string[]) => parts.map(p => p.trim()).filter(Boolean).join(' ');

  useSpeechRecognitionEvent('result', e => {
    const spoken = e.results[0]?.transcript ?? '';
    if (e.isFinal) finals.current = join(finals.current, spoken);
    onText(join(base.current, finals.current, e.isFinal ? '' : spoken));
  });
  // Measured on a Galaxy S25: about -2 in silence, peaks near 4-5 for normal speech (the documented
  // -2..10 range is never reached). Map that span to 0..1, with a gentle curve so quiet syllables still register.
  useSpeechRecognitionEvent('volumechange', e => setLevel(Math.min(1, Math.max(0, (e.value + 2) / 6.5)) ** 0.8));
  useSpeechRecognitionEvent('end', () => (setState('idle'), setLevel(0)));
  useSpeechRecognitionEvent('error', e => {
    setState('idle');
    setLevel(0);
    if (e.error !== 'aborted' && e.error !== 'no-speech') Alert.alert('Voice input', e.message || 'Speech recognition stopped.');
  });

  const start = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return Alert.alert('Microphone access', 'Allow Neru to use the microphone and speech recognition in your phone settings to dictate.');
    base.current = currentText;
    finals.current = '';
    setState('listening');
    ExpoSpeechRecognitionModule.start({
      lang: getState().settings.voiceLang,
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  };

  /** Finishes dictation; the recognizer delivers its last result before `end`. */
  const stop = () => {
    setState('processing');
    ExpoSpeechRecognitionModule.stop();
  };

  return { state, level, start, stop, toggle: () => (state === 'idle' ? start() : stop()) };
}
