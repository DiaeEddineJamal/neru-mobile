// Notifications, the way Claude's app does them: nothing while you are in the app, and a note when something
// you started finishes or needs you after you leave: a chat reply, a desktop session waiting for approval or
// done with its run, a Team task that finished. Tapping one opens that conversation.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { getRemote, subscribeRemote } from '@/remote/store';
import { getState, subscribe } from '@/store';

Notifications.setNotificationHandler({
  // In the foreground the conversation is right there, so only keep it in the list.
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const away = () => AppState.currentState !== 'active';
const preview = (text: string) => text.replace(/[#*_`>|~-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

/**
 * Asks once, after the user has sent their first message, the moment Claude's app asks too.
 * Android 13+ shows the system prompt; earlier versions grant notifications by default.
 */
export async function askForNotifications() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) return current.granted;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function post(title: string, body: string, data: Record<string, string>) {
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: 'default' }, trigger: null });
}

// ponytail: local notifications fire while Android keeps Neru's process and connection alive in the background
// (minutes, not hours). Push through a relay would cover a killed app.
export function startNotifications() {
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', { name: 'Replies and approvals', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 120, 80, 120], lightColor: '#486b51' });
  }

  // Chat replies: notify when a reply that was streaming finishes while the app is in the background.
  let streaming = getState().streamingChat;
  const stopChats = subscribe(() => {
    const now = getState().streamingChat;
    const finished = streaming && streaming !== now ? streaming : null;
    streaming = now;
    if (!finished || !away()) return;
    const chat = getState().chats.find(c => c.id === finished);
    const last = chat?.messages.at(-1);
    if (!chat || last?.role !== 'assistant') return;
    void post(last.error ? 'Neru couldn’t finish' : chat.title, last.error ? last.error : preview(last.text) || 'Your reply is ready.', { chatId: chat.id });
  });

  // Desktop sessions and Team tasks.
  let waiting = new Set(getRemote().sessions.filter(s => s.waiting).map(s => s.id));
  let running = new Set(getRemote().sessions.filter(s => s.running).map(s => s.id));
  let teamsRunning = new Set(getRemote().teams.filter(t => t.running).map(t => t.id));
  const stopRemote = subscribeRemote(() => {
    const { sessions, teams } = getRemote();
    const nowWaiting = sessions.filter(s => s.waiting);
    const nowRunning = sessions.filter(s => s.running);
    const nowTeams = teams.filter(t => t.running);
    const freshWaiting = nowWaiting.filter(s => !waiting.has(s.id));
    const doneRunning = sessions.filter(s => running.has(s.id) && !s.running && !s.waiting);
    const doneTeams = teams.filter(t => teamsRunning.has(t.id) && !t.running);
    waiting = new Set(nowWaiting.map(s => s.id));
    running = new Set(nowRunning.map(s => s.id));
    teamsRunning = new Set(nowTeams.map(t => t.id));
    if (!away()) return;
    for (const s of freshWaiting) void post('Neru needs your approval', `${s.title} · ${s.project}`, { sessionId: s.id });
    for (const s of doneRunning) void post(s.title, `Finished on ${getRemote().desktopName ?? 'your desktop'} · ${s.project}`, { sessionId: s.id });
    for (const t of doneTeams) void post(t.title, t.failed ? 'The team stopped with a problem. Open it to see what happened.' : 'Your team finished working.', { teamId: t.id });
  });

  const open = (data: Record<string, unknown> | undefined) => {
    if (typeof data?.chatId === 'string') router.navigate(`/chat/${data.chatId}`);
    else if (typeof data?.sessionId === 'string') router.navigate(`/desktop/${data.sessionId}`);
    else if (typeof data?.teamId === 'string') router.navigate(`/team/${data.teamId}`);
  };
  const tap = Notifications.addNotificationResponseReceivedListener(r => open(r.notification.request.content.data));
  // A tap that launched Neru from a closed state.
  void Notifications.getLastNotificationResponseAsync().then(r => r && open(r.notification.request.content.data));

  return () => (stopChats(), stopRemote(), tap.remove());
}
