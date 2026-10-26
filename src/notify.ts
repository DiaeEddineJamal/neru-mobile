// Notifications, the way Claude's app does them: nothing while you are in the app, and a note when something
// you started finishes or needs you after you leave: a chat reply, a desktop session waiting for approval or
// done with its run, a Team task that finished. Tapping one opens that conversation.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { scheduleNudges } from '@/nudges';
import { answerApproval, getRemote, pendingOf, subscribeRemote, wakeRemote, whenConnected } from '@/remote/store';
import { getState, NO_MODEL, subscribe } from '@/store';
import { t as tx } from '@/i18n';

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
  const granted = (await Notifications.requestPermissionsAsync()).granted;
  if (granted) void scheduleNudges();
  return granted;
}

async function post(title: string, body: string, data: Record<string, string>, extra: { identifier?: string; categoryIdentifier?: string } = {}) {
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  // Posted on the high-importance channel so it shows as a heads-up banner, not silently in the shade.
  await Notifications.scheduleNotificationAsync({
    identifier: extra.identifier,
    content: { title, body, data, sound: 'default', categoryIdentifier: extra.categoryIdentifier },
    trigger: Platform.OS === 'android' ? { channelId: 'default' } : null,
  });
}

// Approve or deny a desktop change from the notification itself, without opening Neru.
const APPROVAL = 'approval';
const approvalId = (sessionId: string) => `approval-${sessionId}`;

/** The approval note: what waits, and the second opinion when there is one. Questions open the app instead. */
async function postApproval(sessionId: string, title: string, project: string) {
  const pending = await pendingOf(sessionId).catch(() => null);
  const review = pending?.review;
  const verdict = review?.status === 'agree' ? ` · ${tx('{reviewer} agrees', { reviewer: review.reviewer })}` : review?.status === 'concerns' ? ` · ${tx('{reviewer} has concerns', { reviewer: review.reviewer })}` : '';
  const body = pending ? `${pending.label}${verdict}\n${title} · ${project}` : `${title} · ${project}`;
  const actions = !!pending && pending.kind !== 'question';
  await post(tx('Neru needs your approval'), body, { sessionId }, { identifier: approvalId(sessionId), categoryIdentifier: actions ? APPROVAL : undefined });
}

/** A button on an approval note: answer on the desktop, then replace the note with the outcome. */
async function answerFromNotification(sessionId: string, approve: boolean) {
  await Notifications.dismissNotificationAsync(approvalId(sessionId)).catch(() => {});
  try {
    wakeRemote();
    await whenConnected();
    await answerApproval(sessionId, approve);
    await post(approve ? tx('Approved') : tx('Denied'), approve ? tx('Neru on your desktop carries on.') : tx('Neru on your desktop stopped that step.'), { sessionId });
  } catch (err) {
    await post(tx('Your answer did not reach the desktop'), tx('{error} Open Neru to answer.', { error: err instanceof Error ? err.message : String(err) }), { sessionId });
  }
}

// The morning summary: one note the morning after queued work runs, opening "While you were away".
const MORNING = 'digest-morning';
async function planMorning() {
  await Notifications.cancelScheduledNotificationAsync(MORNING).catch(() => {});
  const queued = getRemote().queue.filter(t => t.status === 'queued');
  if (!queued.length || !(await Notifications.getPermissionsAsync()).granted) return;
  const at = new Date(Math.max(...queued.map(t => t.at)) + 30 * 60_000);
  if (at.getHours() >= 8) at.setDate(at.getDate() + 1);
  at.setHours(8, 0, 0, 0);
  await Notifications.scheduleNotificationAsync({
    identifier: MORNING,
    content: { title: tx('Good morning'), body: queued.length === 1 ? tx('See what your desktop did with your queued task overnight.') : tx('See what your desktop did with your {n} queued tasks overnight.', { n: queued.length }), data: { digest: '1' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'default' },
  });
}

// ponytail: local notifications fire while Android keeps Neru's process and connection alive in the background
// (minutes, not hours). Push through a relay would cover a killed app.
export function startNotifications() {
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', { name: tx('Replies and approvals'), importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 120, 80, 120], lightColor: '#486b51' });
  }
  void Notifications.setNotificationCategoryAsync(APPROVAL, [
    { identifier: 'approve', buttonTitle: tx('Approve'), options: { opensAppToForeground: false } },
    { identifier: 'deny', buttonTitle: tx('Deny'), options: { opensAppToForeground: false, isDestructive: true } },
  ]);

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
    void post(last.error ? tx('Neru couldn’t finish') : chat.title, last.error ? (last.error === NO_MODEL ? tx(NO_MODEL) : last.error) : preview(last.text) || tx('Your reply is ready.'), { chatId: chat.id });
  });

  // Desktop sessions and Team tasks.
  let waiting = new Set(getRemote().sessions.filter(s => s.waiting).map(s => s.id));
  let running = new Set(getRemote().sessions.filter(s => s.running).map(s => s.id));
  let teamsRunning = new Set(getRemote().teams.filter(t => t.running).map(t => t.id));
  let queueRunning = new Set(getRemote().queue.filter(t => t.status === 'running').map(t => t.id));
  let queueKey = '';
  const stopRemote = subscribeRemote(() => {
    const { sessions, teams, queue } = getRemote();
    const doneQueued = queue.filter(t => queueRunning.has(t.id) && t.status !== 'running');
    queueRunning = new Set(queue.filter(t => t.status === 'running').map(t => t.id));
    const key = queue.filter(t => t.status === 'queued').map(t => `${t.id}@${t.at}`).join(',');
    if (key !== queueKey) {
      queueKey = key;
      void planMorning();
    }
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
    for (const s of freshWaiting) void postApproval(s.id, s.title, s.project);
    for (const t of doneQueued) {
      const body = t.status === 'done' ? tx('Your queued task finished.') : t.status === 'waiting' ? tx('Your queued task is waiting for your approval.') : t.status === 'failed' ? (t.error ? tx('Your queued task stopped: {error}', { error: t.error }) : tx('Your queued task stopped: open it to see why')) : tx('Your queued task was canceled.');
      void post(t.title, body, t.sessionId ? { sessionId: t.sessionId } : { tasks: '1' });
    }
    for (const s of doneRunning) void post(s.title, getRemote().desktopName ? tx('Finished on {desktop} · {project}', { desktop: getRemote().desktopName!, project: s.project }) : tx('Finished on your desktop · {project}', { project: s.project }), { sessionId: s.id });
    for (const t of doneTeams) void post(t.title, t.failed ? tx('The team stopped with a problem. Open it to see what happened.') : tx('Your team finished working.'), { teamId: t.id });
  });

  // Check-ins: planned again whenever Neru is back on screen (so they only come after quiet days) and when the
  // setting or the name they use changes.
  void scheduleNudges();
  const appState = AppState.addEventListener('change', s => s === 'active' && void scheduleNudges());
  let profile = `${getState().settings.nudges}|${getState().settings.name}`;
  const stopProfile = subscribe(() => {
    const now = `${getState().settings.nudges}|${getState().settings.name}`;
    if (now !== profile) void scheduleNudges();
    profile = now;
  });

  const open = (data: Record<string, unknown> | undefined) => {
    if (data?.checkin) router.navigate('/');
    else if (data?.digest) router.navigate('/digest');
    else if (data?.tasks) router.navigate('/tasks');
    else if (typeof data?.chatId === 'string') router.navigate(`/chat/${data.chatId}`);
    else if (typeof data?.sessionId === 'string') router.navigate(`/desktop/${data.sessionId}`);
    else if (typeof data?.teamId === 'string') router.navigate(`/team/${data.teamId}`);
  };
  const tap = Notifications.addNotificationResponseReceivedListener(r => {
    const data = r.notification.request.content.data;
    if ((r.actionIdentifier === 'approve' || r.actionIdentifier === 'deny') && typeof data?.sessionId === 'string') return void answerFromNotification(data.sessionId, r.actionIdentifier === 'approve');
    open(data);
  });
  // A tap that launched Neru from a closed state.
  void Notifications.getLastNotificationResponseAsync().then(r => r && open(r.notification.request.content.data));

  return () => (stopChats(), stopRemote(), stopProfile(), appState.remove(), tap.remove());
}
