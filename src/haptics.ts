// Every vibration in Neru goes through here, so Settings → Haptics turns all of them off at once.
// The vocabulary follows Claude's and ChatGPT's apps: a soft tick for choices, a light tap for presses,
// a firmer tap for commitments like sending, and notification patterns for outcomes.
import * as Haptics from 'expo-haptics';

import { getState } from '@/store';

const on = () => getState().settings.haptics;

export const haptic = {
  /** Moving between options: tabs, switches, pickers. */
  select: () => void (on() && Haptics.selectionAsync()),
  /** Pressing something: buttons, long-press menus, copy. */
  light: () => void (on() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Committing: sending a message, starting dictation. */
  medium: () => void (on() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => void (on() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => void (on() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => void (on() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
