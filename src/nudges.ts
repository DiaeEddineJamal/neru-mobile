// Check-ins: an occasional, friendly note that Neru is there for the day's plans and tasks. Never annoying by
// design: every time Neru opens, the upcoming notes are pushed out again, so they only arrive after a couple
// of quiet days, at a daytime hour, at most one every two to three days, and the wording walks through a
// shuffled list so a line does not come back until all the others have been used.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { kvGetSync, kvSet } from '@/db';
import { getRemote } from '@/remote/store';
import { getState } from '@/store';
import { t } from '@/i18n';

const COUNT = 3; // queued ahead, so a phone left alone for a week still hears from Neru twice or three times
const CHANNEL = 'checkins';

type Note = (first: string, paired: boolean) => { title: string; body: string } | null;
const notes: Note[] = [
  f => ({ title: f ? t('Hey {name}', { name: f }) : t('Hey there'), body: t('Got something on your mind? Let’s think it through together.') }),
  () => ({ title: t('Today’s plan'), body: t('Tell me what’s on your list and I’ll help you sort it into easy steps.') }),
  () => ({ title: t('Stuck on something?'), body: t('Two minutes with Neru might untangle it.') }),
  f => ({ title: t('Big idea brewing?'), body: f ? t('Let’s sketch it out, {name}. Rough notes are fine.', { name: f }) : t('Let’s sketch it out. Rough notes are fine.') }),
  () => ({ title: t('Curious about something?'), body: t('Ask me anything, from quick facts to deep dives.') }),
  () => ({ title: t('Need the right words?'), body: t('I can help with that email or message, in your tone.') }),
  () => ({ title: t('Week ahead'), body: t('Planning a few days out? Let’s break it into something doable.') }),
  f => ({ title: f ? t('Quick one, {name}', { name: f }) : t('Quick one'), body: t('That question you’ve been meaning to ask? Now’s a good time.') }),
  () => ({ title: t('Learn something small'), body: t('Pick a topic and I’ll explain it in five minutes.') }),
  (_, paired) => (paired ? { title: t('Your projects'), body: t('Check in on your desktop sessions, right from your phone.') } : null),
  () => ({ title: t('No signal? No problem'), body: t('Models you download in Pocket Lab answer offline.') }),
  f => ({ title: t('Clear your head'), body: f ? t('Dump everything on your mind here, {name}, and I’ll help you make sense of it.', { name: f }) : t('Dump everything on your mind here, and I’ll help you make sense of it.') }),
];

/** The next line indexes to use: a shuffled deck, dealt in order and reshuffled once it runs out. */
function deal(n: number, usable: (i: number) => boolean) {
  let deck: number[] = JSON.parse(kvGetSync('nudges.deck') || '[]');
  const out: number[] = [];
  for (let guard = 0; out.length < n && guard < notes.length * 3; guard++) {
    if (!deck.length) deck = notes.map((_, i) => i).sort(() => Math.random() - 0.5);
    const i = deck.shift()!;
    if (usable(i)) out.push(i);
  }
  void kvSet('nudges.deck', JSON.stringify(deck));
  return out;
}

/** Re-plans the queued check-ins from now. Call whenever Neru comes to the foreground or the setting changes. */
export async function scheduleNudges() {
  if (Platform.OS === 'web') return;
  await Promise.all(Array.from({ length: COUNT }, (_, i) => Notifications.cancelScheduledNotificationAsync(`checkin-${i}`).catch(() => {})));
  const { settings } = getState();
  if (!settings.nudges || !(await Notifications.getPermissionsAsync()).granted) return;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, { name: t('Check-ins'), importance: Notifications.AndroidImportance.DEFAULT });
  const first = settings.name?.trim().split(/\s+/)[0] ?? '';
  const paired = !!getRemote().desktopName;
  const picks = deal(COUNT, i => notes[i](first, paired) !== null);
  let day = 0;
  for (const [k, i] of picks.entries()) {
    day += 2 + Math.floor(Math.random() * 2); // two or three days after the previous one
    const at = new Date();
    at.setDate(at.getDate() + day);
    at.setHours(10 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60), 0, 0); // 10:00–18:59
    const content = notes[i](first, paired)!;
    await Notifications.scheduleNotificationAsync({
      identifier: `checkin-${k}`,
      content: { ...content, data: { checkin: '1' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
  }
}
