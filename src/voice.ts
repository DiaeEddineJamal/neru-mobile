// Dictation with the platform speech recognizer. Text streams into the composer as you speak,
// and the volume drives the voice stripes.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';

import { getState } from '@/store';
import { notice } from '@/ui/confirm';

export type VoiceState = 'idle' | 'listening' | 'processing';

/** `onText(base, spoken)`: the composer text from before dictation and everything said since. */
export function useVoice(onText: (text: string) => void, currentText: string) {
  const [state, setState] = useState<VoiceState>('idle');
  // A shared value, not state: ten readings a second would otherwise re-render the whole composer, and while a
  // reply streams those renders queue up behind it and the stripes stutter.
  const level = useSharedValue(0);
  const setLevel = (value: number) => level.set(value);
  const base = useRef('');
  const finals = useRef('');
  const interim = useRef('');
  // Off once dictation is cancelled, so a result still in flight cannot refill a composer that was just sent.
  const live = useRef(false);

  const join = (...parts: string[]) => parts.map(p => p.trim()).filter(Boolean).join(' ');

  useSpeechRecognitionEvent('result', e => {
    if (!live.current) return;
    const spoken = e.results[0]?.transcript ?? '';
    if (e.isFinal) finals.current = join(finals.current, spoken);
    interim.current = e.isFinal ? '' : spoken;
    onText(join(base.current, finals.current, e.isFinal ? '' : spoken));
  });
  // Measured on a Galaxy S25: about -2 in silence, peaks near 4-5 for normal speech (the documented
  // -2..10 range is never reached). Map that span to 0..1, with a gentle curve so quiet syllables still register.
  useSpeechRecognitionEvent('volumechange', e => setLevel(Math.min(1, Math.max(0, (e.value + 2) / 6.5)) ** 0.8));
  useSpeechRecognitionEvent('end', () => (live.current = false, setState('idle'), setLevel(0)));
  useSpeechRecognitionEvent('error', e => {
    live.current = false;
    setState('idle');
    setLevel(0);
    if (e.error !== 'aborted' && e.error !== 'no-speech') void notice({ title: 'Dictation stopped', message: e.message || 'Speech recognition stopped. Try again in a moment.', icon: 'mic' });
  });

  const start = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return void notice({ title: 'Allow the microphone', message: 'Neru needs the microphone and speech recognition to turn your voice into text. You can allow them in your phone’s settings.', icon: 'mic', settings: true });
    base.current = currentText;
    finals.current = '';
    interim.current = '';
    live.current = true;
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

  /** Ends dictation and drops whatever the recognizer has not delivered yet. */
  const cancel = () => {
    live.current = false;
    setState('idle');
    setLevel(0);
    ExpoSpeechRecognitionModule.abort();
  };

  /** The user typed or deleted mid-dictation: keep their text, and add the next words after it. */
  const edit = (text: string) => {
    const tail = interim.current;
    base.current = tail && text.endsWith(tail) ? text.slice(0, -tail.length) : text;
    finals.current = '';
  };

  return { state, level, start, stop, cancel, edit, toggle: () => (state === 'idle' ? start() : stop()) };
}
