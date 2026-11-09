// Every vibration in Neru goes through here, so Settings → Haptics turns all of them off at once.
// The vocabulary follows Claude's and ChatGPT's apps: a soft tick for choices, a light tap for presses,
// a firmer tap for commitments like sending, and notification patterns for outcomes.
//
// Why Android felt nothing before 0.16: expo-haptics' impactAsync/selectionAsync drive the Vibrator with a raw
// waveform at amplitude 30-50 of 255 for ~50 ms. Most phone motors (Pixel, Samsung) don't spin up at that
// strength, so the call "worked" and nothing was felt. Android's own haptic primitives
// (View.performHapticFeedback, exposed as performAndroidHapticsAsync) use the device's tuned clicks instead, the
// same ones the keyboard and system switches use.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { getState } from '@/store';

const on = () => getState().settings.haptics !== false;
const android = Platform.OS === 'android';
const A = Haptics.AndroidHaptics;

/** Plays an Android primitive; older Android versions without it get the closest one every version has. */
function play(type: Haptics.AndroidHaptics, fallback: Haptics.AndroidHaptics = A.Virtual_Key) {
  Haptics.performAndroidHapticsAsync(type).catch(() => Haptics.performAndroidHapticsAsync(fallback).catch(() => {}));
}

/** Two primitives a beat apart, for outcomes that should feel different from a press. */
function twice(type: Haptics.AndroidHaptics, gap = 90) {
  play(type);
  setTimeout(() => play(type), gap);
}

// A press that also opens a sheet or menu would otherwise tap twice a few ms apart: keep the first of a burst.
let last = 0;
const fire = (androidFx: () => void, ios: () => Promise<void>) => () => {
  if (!on()) return;
  const now = Date.now();
  if (now - last < 60) return;
  last = now;
  if (android) androidFx();
  else void ios().catch(() => {});
};

export const haptic = {
  /** Moving between options: tabs, switches, pickers. */
  select: fire(() => play(A.Segment_Tick, A.Clock_Tick), () => Haptics.selectionAsync()),
  /** Pressing something: buttons, long-press menus, copy. */
  light: fire(() => play(A.Virtual_Key), () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Committing: sending a message, starting dictation. */
  medium: fire(() => play(A.Confirm, A.Context_Click), () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** A switch turning on or off. */
  toggle: (value: boolean) => fire(() => play(value ? A.Toggle_On : A.Toggle_Off, A.Clock_Tick), () => Haptics.selectionAsync())(),
  /** Long press opening a menu. */
  long: fire(() => play(A.Long_Press), () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: fire(() => play(A.Confirm, A.Context_Click), () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: fire(() => twice(A.Clock_Tick), () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: fire(() => play(A.Reject, A.Long_Press), () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
