// The phone's connectors: the MCP servers you add here (they work with no desktop), and, while a paired desktop is
// connected, the connectors running there. Chats with any model, cloud or on-device, can call their tools.
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet } from '@/db';
import { McpHttpError, McpSession, type McpTool } from '@/mcp/client';
import { GoogleWorkspaceClient, googleService } from '@/mcp/google';
import { downloadDocument } from '@/documents';
import { catalog, GOOGLE_CLIENT_ID, type Auth } from '@/mcp/catalog';
import { accessToken, loadToken, signIn, signInGoogle, storeBearer, storeToken } from '@/mcp/oauth';
import { desktopCall, getRemote, subscribeRemote } from '@/remote/store';
import type { DesktopMcpTool } from '@/shared/remoteProtocol';
import { t as tx } from '@/i18n';

export type Connector = { id: string; name: string; url: string; auth: Auth; enabled: boolean; logo?: string; scopes?: string; /** Tools allowed to run without asking. */ allowed: string[] };
export type Status = 'off' | 'connecting' | 'ready' | 'signin' | 'error';
type Live = { status: Status; tools: McpTool[]; error?: string; www?: string | null };

type State = {
  connectors: Connector[];
  live: Record<string, Live>;
  /** Use the paired desktop's connectors in chats while it is connected. */
  useDesktop: boolean;
  desktopTools: DesktopMcpTool[];
  /** Desktop tools allowed to run without asking, by function name. */
  desktopAllowed: string[];
};

const KEY = 'mcp.connectors';
const saved = JSON.parse(kvGetSync(KEY) ?? '{}') as Partial<Pick<State, 'connectors' | 'useDesktop' | 'desktopAllowed'>>;
let state: State = { connectors: saved.connectors ?? [], live: {}, useDesktop: saved.useDesktop ?? true, desktopTools: [], desktopAllowed: saved.desktopAllowed ?? [] };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
const persist = () => void kvSet(KEY, JSON.stringify({ connectors: state.connectors, useDesktop: state.useDesktop, desktopAllowed: state.desktopAllowed }));
export const getMcp = () => state;
export function useMcp<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(l => (listeners.add(l), () => void listeners.delete(l)), () => pick(state));
}

const sessions = new Map<string, McpSession | GoogleWorkspaceClient>();
const session = (c: Connector) => {
  let s = sessions.get(c.id);
  if (!s || s.url !== c.url) {
    const service = c.auth === 'google' ? googleService(c.url) : null;
    s = service ? new GoogleWorkspaceClient(c.url, service, () => accessToken(c.id), downloadDocument) : new McpSession(c.url, () => (c.auth === 'none' ? Promise.resolve(null) : accessToken(c.id)));
    sessions.set(c.id, s);
  }
  return s;
};
const setLive = (id: string, patch: Partial<Live>) => set({ live: { ...state.live, [id]: { ...(state.live[id] ?? { status: 'off', tools: [] }), ...patch } } });
const update = (id: string, patch: Partial<Connector>) => {
  set({ connectors: state.connectors.map(c => (c.id === id ? { ...c, ...patch } : c)) });
  persist();
};

/** Connects and lists tools. A 401 marks it as needing sign-in. */
export async function refresh(id: string) {
  const c = state.connectors.find(x => x.id === id);
  if (!c) return;
  if (!c.enabled) return setLive(id, { status: 'off', tools: [], error: undefined });
  setLive(id, { status: 'connecting', error: undefined });
  try {
    if (c.auth !== 'none' && !(await loadToken(id))) return setLive(id, { status: 'signin', tools: [] });
    const s = session(c);
    s.reset();
    setLive(id, { status: 'ready', tools: await s.tools(), error: undefined });
  } catch (err) {
    if (err instanceof McpHttpError && err.status === 401) return setLive(id, { status: 'signin', tools: [], www: err.wwwAuthenticate });
    setLive(id, { status: 'error', tools: [], error: err instanceof Error ? tx(err.message) : String(err) });
  }
}

export const refreshAll = () => Promise.all(state.connectors.map(c => refresh(c.id)));

/** The paired desktop's connector tools, while it is connected. */
export async function refreshDesktop() {
  const { status } = getRemote();
  if (status !== 'connected' || !state.useDesktop) return set({ desktopTools: [] });
  set({ desktopTools: await desktopCall<DesktopMcpTool[]>('mcp_tools').catch(() => []) });
}

export function setUseDesktop(on: boolean) {
  set({ useDesktop: on });
  persist();
  void refreshDesktop();
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'connector';

/** Adds a connector from the catalog or by URL; returns its id. */
export function addConnector(c: { name: string; url: string; auth: Auth; logo?: string; scopes?: string }) {
  let id = slug(c.name);
  for (let n = 2; state.connectors.some(x => x.id === id); n++) id = `${slug(c.name)}-${n}`;
  set({ connectors: [...state.connectors, { ...c, id, enabled: true, allowed: [] }] });
  persist();
  return id;
}

export async function removeConnector(id: string) {
  sessions.delete(id);
  await storeToken(id, null);
  const { [id]: _gone, ...live } = state.live;
  set({ connectors: state.connectors.filter(c => c.id !== id), live });
  persist();
}

export function setEnabled(id: string, enabled: boolean) {
  update(id, { enabled });
  void refresh(id);
}

/** Signs in (browser), or saves a pasted token, then connects. */
export async function connect(id: string, token?: string) {
  const c = state.connectors.find(x => x.id === id);
  if (!c) return;
  if (c.auth === 'token') {
    if (!token?.trim()) throw new Error(tx('Paste a token first.'));
    await storeBearer(id, c.url, token.trim());
  } else if (c.auth === 'google') {
    await signInGoogle(id, GOOGLE_CLIENT_ID, c.scopes ?? '', c.url);
  } else if (c.auth === 'oauth') {
    // Ask the server first, so sign-in follows its own 401 hints.
    let www = state.live[id]?.www ?? null;
    if (!www) {
      const probe = await fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":0,"method":"ping"}' }).catch(() => null);
      www = probe?.headers.get('www-authenticate') ?? null;
    }
    await signIn(id, c.url, www);
  }
  await refresh(id);
}

export async function signOut(id: string) {
  await storeToken(id, null);
  sessions.get(id)?.reset();
  setLive(id, { status: 'signin', tools: [] });
}

export function allowAlways(source: ChatTool['source']) {
  if (source.kind === 'desktop') {
    set({ desktopAllowed: [...new Set([...state.desktopAllowed, source.fn])] });
    persist();
  } else {
    const c = state.connectors.find(x => x.id === source.id);
    if (c) update(c.id, { allowed: [...new Set([...c.allowed, source.tool])] });
  }
}

// ---- tools for chats ----

export type ChatTool = {
  /** The function name models call: letters, digits, _ and -, at most 64 characters. */
  fn: string;
  description: string;
  schema: Record<string, unknown>;
  readOnly: boolean;
  /** Connector name, for the step line and approval card. */
  label: string;
  title: string;
  source: { kind: 'phone'; id: string; tool: string } | { kind: 'desktop'; fn: string; server: string; tool: string };
};

// Gemini wants a name that starts with a letter or underscore, so a connector called "1Password" still gets one.
const fnName = (prefix: string, tool: string) => `${prefix.replace(/[^a-zA-Z0-9]/g, '_').replace(/^(?=[^a-zA-Z_])/, '_')}__${tool.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);

/** Every tool a chat may call now: ready phone connectors, then the desktop's when it is connected. */
export function chatTools(): ChatTool[] {
  const out: ChatTool[] = [];
  for (const c of state.connectors) {
    const live = state.live[c.id];
    if (!c.enabled || live?.status !== 'ready') continue;
    for (const t of live.tools) out.push({ fn: fnName(c.id, t.name), description: `[${c.name}] ${t.description}`.slice(0, 1024), schema: t.inputSchema, readOnly: t.readOnly, label: c.name, title: t.title ?? t.name, source: { kind: 'phone', id: c.id, tool: t.name } });
  }
  if (state.useDesktop && getRemote().status === 'connected') {
    const taken = new Set(out.map(t => t.fn));
    for (const t of state.desktopTools) {
      const fn = fnName(`pc_${t.server}`, t.tool);
      if (taken.has(fn)) continue;
      out.push({ fn, description: `${t.description} (on your desktop)`.slice(0, 1024), schema: t.inputSchema, readOnly: t.readOnly, label: tx('{server} · desktop', { server: t.server }), title: t.tool, source: { kind: 'desktop', fn: t.name, server: t.server, tool: t.tool } });
    }
  }
  return out;
}

/** Whether a tool may run without asking: read-only, or allowed earlier with "Always allow". */
export function preapproved(t: ChatTool) {
  if (t.readOnly) return true;
  if (t.source.kind === 'desktop') return state.desktopAllowed.includes(t.source.fn);
  const { id, tool } = t.source;
  return !!state.connectors.find(c => c.id === id)?.allowed.includes(tool);
}

export async function runTool(t: ChatTool, args: Record<string, unknown>): Promise<string> {
  if (t.source.kind === 'desktop') {
    return (await desktopCall<{ text: string }>('mcp_call', { server: t.source.server, tool: t.source.tool, arguments: args })).text;
  }
  const { id, tool } = t.source;
  const c = state.connectors.find(x => x.id === id);
  if (!c) throw new Error(tx('That connector was removed.'));
  try {
    return await session(c).call(tool, args);
  } catch (err) {
    if (err instanceof McpHttpError && err.status === 401) setLive(id, { status: 'signin', tools: [], www: err.wwwAuthenticate });
    throw err;
  }
}

/** Catalog entries not added yet. */
export const available = () => catalog.filter(e => !state.connectors.some(c => c.url === e.url || (e.auth === 'google' && c.auth === 'google' && googleService(c.url) === googleService(e.url))));

/** Connects every enabled connector, and follows the paired desktop's connection for its tools. Call once. */
export function startMcp() {
  void refreshAll();
  let connected = getRemote().status === 'connected';
  void refreshDesktop();
  return subscribeRemote(() => {
    const now = getRemote().status === 'connected';
    if (now === connected) return;
    connected = now;
    void refreshDesktop();
  });
}
