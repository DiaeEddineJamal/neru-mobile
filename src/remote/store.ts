// Paired desktop state: connection, session list, the open session's snapshot plus live agent events,
// and Team tasks. Fed by RemoteClient; screens read it with useRemote().
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { RemoteClient, type Status } from '@/remote/client';
import { parsePairing, toBase64Url, type Pairing } from '@/remote/crypto';
import type { RemoteCommands, SessionSummaryForPhone } from '@/shared/remoteProtocol';
import type { AgentEvent, AgentModel, ChatEntry, PendingView, SessionSnapshot, TeamEvent, TeamAgent, TeamPost, TeamTask, TeamTaskSummary, Todo } from '@/shared/types';

export type RemoteSession = SessionSummaryForPhone;
export type LiveTool = { id: string; label: string; status: 'running' | 'done' | 'error' | 'pending' };
export type SessionView = {
  entries: ChatEntry[];
  pending: PendingView | null;
  todos: Todo[];
  /** The reply being written right now, until the next snapshot includes it. */
  live: { text: string; reasoning: string; tools: LiveTool[] } | null;
  notices: string[];
};

type State = {
  desktopName: string | null;
  status: Status;
  host?: string;
  sessions: RemoteSession[];
  views: Record<string, SessionView>;
  teams: TeamTaskSummary[];
  teamViews: Record<string, TeamTask & { live: Record<string, { text: string; steps: string[]; drawing?: boolean }> }>;
  error: string | null;
};

let state: State = { desktopName: null, status: 'off', sessions: [], views: {}, teams: [], teamViews: {}, error: null };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
export const subscribeRemote = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const getRemote = () => state;
export function useRemote<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribeRemote, () => pick(state));
}

let client: RemoteClient | null = null;
const PAIRING = 'remote.pairing';

const normalizeSessions = (rows: RemoteSession[]) => [...rows].sort((a, b) => b.updatedAt - a.updatedAt);

function onEvent(event: string, payload: unknown) {
  if (event === 'sessions') return set({ sessions: normalizeSessions(payload as never) });
  if (event === 'agent') return onAgent(payload as AgentEvent);
  if (event === 'team') return onTeam(payload as TeamEvent);
}

const emptyView = (): SessionView => ({ entries: [], pending: null, todos: [], live: null, notices: [] });

function updateView(id: string, fn: (v: SessionView) => SessionView) {
  set({ views: { ...state.views, [id]: fn(state.views[id] ?? emptyView()) } });
}

function onAgent(e: AgentEvent) {
  if (!state.views[e.sessionId]) return; // only sessions the phone has open
  const live = (v: SessionView) => v.live ?? { text: '', reasoning: '', tools: [] };
  switch (e.type) {
    case 'delta':
      return updateView(e.sessionId, v => ({ ...v, live: { ...live(v), text: live(v).text + e.text } }));
    case 'reasoning':
      return updateView(e.sessionId, v => ({ ...v, live: { ...live(v), reasoning: e.text } }));
    case 'tool':
      return updateView(e.sessionId, v => {
        const l = live(v);
        const tools = l.tools.some(t => t.id === e.id) ? l.tools.map(t => (t.id === e.id ? { ...t, label: e.label, status: e.status } : t)) : [...l.tools, { id: e.id, label: e.label, status: e.status }];
        return { ...v, live: { ...l, tools } };
      });
    case 'todos':
      return updateView(e.sessionId, v => ({ ...v, todos: e.todos }));
    case 'notice':
      return updateView(e.sessionId, v => ({ ...v, notices: [...v.notices, e.text] }));
    case 'status':
      set({ sessions: state.sessions.map(s => (s.id === e.sessionId ? { ...s, running: e.running } : s)) });
      // A finished or paused turn: the desktop's snapshot now holds the whole reply and any approval.
      return void refreshSession(e.sessionId).catch(err => set({ error: String(err?.message ?? err) }));
  }
}

function onTeam(e: TeamEvent) {
  if (e.type === 'idle') set({ teams: [e.summary, ...state.teams.filter(t => t.id !== e.taskId)] });
  const view = state.teamViews[e.taskId];
  if (!view) return;
  const patch = (p: Partial<State['teamViews'][string]>) => set({ teamViews: { ...state.teamViews, [e.taskId]: { ...view, ...p } } });
  switch (e.type) {
    case 'member':
      return patch({ members: view.members.some(m => m.handle === e.member.handle) ? view.members.map(m => (m.handle === e.member.handle ? e.member : m)) : [...view.members, e.member] });
    case 'live':
      return patch({ live: { ...view.live, [e.handle]: { text: e.text, steps: e.steps, drawing: e.drawing } } });
    case 'post':
    case 'setup': {
      const post: TeamPost = e.post;
      const { [post.author]: _done, ...rest } = view.live;
      return patch({ posts: view.posts.some(p => p.id === post.id) ? view.posts.map(p => (p.id === post.id ? post : p)) : [...view.posts, post], live: rest });
    }
  }
}

// ---- pairing ----

export async function restorePairing() {
  const saved = await SecureStore.getItemAsync(PAIRING);
  if (saved) start(parsePairing(saved));
}

export async function pair(code: string) {
  const pairing = parsePairing(code); // throws a readable error for a bad code
  const next = start(pairing);
  try {
    await next.whenConnected();
    await SecureStore.setItemAsync(PAIRING, code.trim());
  } catch (err) {
    next.close();
    const previous = await SecureStore.getItemAsync(PAIRING);
    if (previous) start(parsePairing(previous));
    else { client = null; set({ desktopName: null, status: 'off', sessions: [], views: {}, teams: [], teamViews: {}, host: undefined }); }
    throw err;
  }
}

export async function unpair() {
  client?.close();
  client = null;
  await SecureStore.deleteItemAsync(PAIRING);
  set({ desktopName: null, status: 'off', host: undefined, error: null, sessions: [], views: {}, teams: [], teamViews: {} });
}

function start(p: Pairing) {
  client?.close();
  set({ desktopName: p.name, host: undefined, sessions: [], views: {}, teams: [], teamViews: {}, error: null });
  client = new RemoteClient(p, onEvent, (status, host) => {
    set({ status, host });
    if (status === 'connected') void refreshAll();
  });
  return client;
}

export const wakeRemote = () => client?.wake();
export const pairingKeyFingerprint = (p: Pairing) => toBase64Url(p.key).slice(0, 6);

async function call<T>(cmd: string, args?: Record<string, unknown>) {
  if (!client) throw new Error('Pair a desktop first.');
  return client.request<T>(cmd, args);
}

export async function refreshAll() {
  try {
    // The desktop starts pushing events once a frame from us decrypts; hello also names the computer.
    const hello = await call<{ name: string; version: string }>('hello');
    set({ desktopName: hello.name });
    const [sessions, teams] = await Promise.all([call<RemoteSession[]>('list_sessions'), call<TeamTaskSummary[]>('list_teams').catch(() => [])]);
    set({ sessions: normalizeSessions(sessions), teams, error: null });
    await Promise.all([...Object.keys(state.views).map(refreshSession), ...Object.keys(state.teamViews).map(openTeam)]);
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  }
}

export async function refreshSession(sessionId: string) {
  const snap = await call<SessionSnapshot>('session_snapshot', { sessionId });
  updateView(sessionId, v => ({ ...v, entries: snap.messages, pending: snap.pending, todos: snap.todos ?? v.todos, live: snap.session.running ? v.live : null }));
  set({ sessions: state.sessions.map(s => (s.id === sessionId ? { ...s, running: !!snap.session.running, waiting: !!snap.pending } : s)) });
}

export async function openSession(sessionId: string) {
  if (!state.views[sessionId]) updateView(sessionId, v => v);
  await refreshSession(sessionId);
}

export const sendPrompt = (sessionId: string, text: string) => call('send_prompt', { sessionId, text });
export const stopSession = (sessionId: string) => call('stop', { sessionId });
export async function answerApproval(sessionId: string, approve: boolean, always = false) {
  await call(approve ? 'approve' : 'deny', approve ? { sessionId, always } : { sessionId });
  updateView(sessionId, v => ({ ...v, pending: null }));
  set({ sessions: state.sessions.map(s => (s.id === sessionId ? { ...s, waiting: false } : s)) });
}

export async function answerQuestion(sessionId: string, answers: string[]) {
  await call('answer', { sessionId, answers });
  updateView(sessionId, v => ({ ...v, pending: null }));
}

export async function openTeam(id: string) {
  const task = await call<TeamTask>('team_snapshot', { id });
  set({ teamViews: { ...state.teamViews, [id]: { ...task, live: state.teamViews[id]?.live ?? {} } } });
}
export const sendTeamMessage = (id: string, text: string, to: string[] = []) => call('send_team_message', { id, text, to });
export const stopTeam = (id: string) => call('stop_team', { id });

export const listTeamAgents = () => call<TeamAgent[]>('list_team_agents');
export const listAgentModels = (kind: string) => call<AgentModel[]>('list_agent_models', { kind });
/** Changes a member's model or reasoning effort on the desktop; the member event updates the open view. */
export const updateTeamMember = (id: string, handle: string, change: { model?: string; effort?: string }) => call<TeamTask>('update_team_member', { id, handle, ...change });
/** A generated image from a team post, as a data URI. */
export async function teamImage(id: string, name: string) {
  const image = await call<{ mime: string; base64: string }>('team_image', { id, name });
  return `data:${image.mime};base64,${image.base64}`;
}
/** Starts a team task on the desktop with `text` as its first message, and puts it in the Team list. */
export async function createTeamTask(args: RemoteCommands['create_team_task']['args']) {
  const task = await call<TeamTask>('create_team_task', args);
  set({ teams: await call<TeamTaskSummary[]>('list_teams').catch(() => state.teams) });
  return task;
}
