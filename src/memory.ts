// Memory: a short document of facts about the user, synthesized from past chats by the current model and editable
// on the Memory page; per-project memory the same way from a project's chats; and search over past chats for the
// current message. Incognito chats and chats with memory turned off never feed memory or search.
import { useSyncExternalStore } from 'react';

import { kvGetSync, kvSet, type Chat } from '@/db';
import { streamChat, type ChatMessage } from '@/llm/stream';
import { streamLocal } from '@/local/runtime';
import { BUDGET, assembleMemoryPrompt, cleanMemory, pastChatSnippets, shouldSynthesize, synthesisPrompt, SYNTH_INPUT, transcript, type ChatDoc } from '@/memory/core';
import { allProjects, getProject, updateProject } from '@/projects';
import { redact } from '@/shared/redact';
import { configFor, getState, privacyBlock, setDraftChat, subscribe as subscribeStore, useStore } from '@/store';

type MemoryState = {
  text: string;
  /** When the text last changed (synthesis or edit). */
  updatedAt: number;
  /** When synthesis last read the chats; automatic runs read only what came after. */
  lastRun: number;
  /** Exchanges since lastRun that may hold something to remember. */
  pending: number;
  /** The same per project. */
  projects: Record<string, { lastRun: number; pending: number }>;
};

const KEY = 'memory';
const OFF_KEY = 'memory.off';

let mem: MemoryState = { text: '', updatedAt: 0, lastRun: 0, pending: 0, projects: {}, ...parse(kvGetSync(KEY)) };
/** Chats the user turned memory off for. */
let off = new Set<string>(parse<string[]>(kvGetSync(OFF_KEY)) ?? []);
/** Synthesis in progress: 'global', a project id, or null; and what it is doing. */
let running: { scope: string; phase: string } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function parse<T = Partial<MemoryState>>(raw: string | null): T | undefined {
  try {
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function save(patch: Partial<MemoryState>) {
  mem = { ...mem, ...patch };
  void kvSet(KEY, JSON.stringify(mem));
  emit();
}

const settings = () => getState().settings;
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const clean = (s: string) => redact(s).text;

/** Whether a chat may feed memory and search, and receive memory. */
const chatAllowed = (c: Chat) => !c.incognito && !off.has(c.id);

const asDoc = (c: Chat): ChatDoc => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages.filter(m => !m.error && m.text) });

// ---- what the model reads ----

/** Text added to the system prompt for `chat`: global memory (and the project's) when memory is on for it. '' when off or incognito. */
export function memoryPrompt(chat: Chat, local: boolean): string {
  if (!chatAllowed(chat)) return '';
  const s = settings();
  const useMemory = s.memory !== false;
  const project = getProject(chat.projectId);
  let snippets: string[] = [];
  if (s.searchChats !== false) {
    const query = [...chat.messages].reverse().find(m => m.role === 'user')?.text ?? '';
    // Recent chats only: scoring hundreds of long chats on every reply would slow the phone down.
    const docs = getState().chats.filter(c => c.id !== chat.id && chatAllowed(c) && c.messages.length).slice(0, 200).map(asDoc);
    snippets = pastChatSnippets(query, docs, BUDGET.search[local ? 'local' : 'cloud'], shortDate, clean, local ? 2 : 3);
  }
  return assembleMemoryPrompt({
    memory: useMemory ? mem.text : '',
    projectName: project?.name,
    projectMemory: useMemory ? project?.memory : '',
    snippets,
    local,
  });
}

// ---- synthesis ----

const isLocal = () => settings().providerId === 'on-device';

/** Asks the current model; on-device runs only when the user asked for it. */
async function ask(messages: ChatMessage[], onText: (chars: number) => void, signal: AbortSignal): Promise<string> {
  const { providerId, model } = settings();
  if (!model) throw new Error('Pick a model first.');
  const blocked = privacyBlock(providerId);
  if (blocked) throw new Error(blocked);
  let out = '';
  const onDelta = (d: string) => ((out += d), onText(out.length));
  if (providerId === 'on-device') await streamLocal(model, messages, onDelta, signal, () => {}, () => {});
  else await streamChat(await configFor(providerId, model), messages, { onDelta }, signal);
  return out;
}

let controller: AbortController | null = null;
/** The user tapped Stop (or reset memory): end quietly, changing nothing. */
let stopped = false;

/** Merges chats into memory; false when there was nothing to read. */
async function synthesize(scope: 'global' | string, manual: boolean): Promise<boolean> {
  if (running) throw new Error('Memory is already updating.');
  const project = scope === 'global' ? undefined : getProject(scope);
  if (scope !== 'global' && !project) return false;
  const local = isLocal();
  const cursor = scope === 'global' ? mem.lastRun : (mem.projects[scope]?.lastRun ?? 0);
  // A manual update reads recent chats again; an automatic one only what is new since its last run.
  const since = manual ? 0 : cursor;
  const docs = getState()
    .chats.filter(c => chatAllowed(c) && (scope === 'global' || c.projectId === scope))
    .slice(0, manual ? 40 : 200)
    .map(asDoc);
  const started = Date.now();
  const done = (patch: Partial<MemoryState>) => save(patch);
  const markRun = () =>
    scope === 'global' ? done({ lastRun: started, pending: 0 }) : done({ projects: { ...mem.projects, [scope]: { lastRun: started, pending: 0 } } });

  const conversations = transcript(docs, since, SYNTH_INPUT[local ? 'local' : 'cloud'], shortDate, clean);
  if (!conversations) {
    markRun();
    return false;
  }
  running = { scope, phase: 'reading' };
  emit();
  controller = new AbortController();
  stopped = false;
  const timer = setTimeout(() => controller?.abort(), manual ? 180_000 : 90_000);
  try {
    const existing = scope === 'global' ? mem.text : (project!.memory ?? '');
    const p = synthesisPrompt(existing, conversations, project && { name: project.name, description: project.description });
    const signal = controller.signal;
    let reply: string;
    try {
      reply = await ask(
        [
          { role: 'system', text: p.system },
          { role: 'user', text: p.user },
        ],
        chars => {
          running = { scope, phase: `writing:${chars}` };
          emit();
        },
        signal,
      );
    } catch (e) {
      if (stopped) return true;
      throw signal.aborted ? new Error('Memory update timed out.') : e;
    }
    if (stopped) return true;
    if (signal.aborted) throw new Error('Memory update timed out.');
    const next = cleanMemory(reply, clean);
    // An empty reply to a non-empty memory is a failed answer, not a decision to forget everything.
    if (next || !existing) {
      if (scope === 'global') done({ text: next, updatedAt: Date.now() });
      else updateProject(scope, { memory: next, memoryUpdatedAt: Date.now() }, false);
    }
    markRun();
    return true;
  } finally {
    clearTimeout(timer);
    controller = null;
    running = null;
    emit();
  }
}

/** Rebuilds the global memory from recent chats now ("Update memory now"); works with on-device models too. */
export const updateMemoryNow = () => synthesize('global', true);
/** Rebuilds a project's memory from its chats ("Update from chats"). */
export const updateProjectMemory = (projectId: string) => synthesize(projectId, true);

export function cancelMemoryUpdate() {
  stopped = true;
  controller?.abort();
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Runs due automatic synthesis once no reply is streaming. Cloud models only: a phone model would hold the processor. */
function scheduleAuto(delay = 8000) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const s = getState();
    if (s.settings.memory === false || isLocal() || running) return;
    if (s.streamingChat) return scheduleAuto(30_000);
    const now = Date.now();
    const due = shouldSynthesize(now, mem.lastRun, mem.pending)
      ? 'global'
      : Object.entries(mem.projects).find(([id, p]) => getProject(id) && shouldSynthesize(now, p.lastRun, p.pending))?.[0];
    if (!due) return;
    synthesize(due, false)
      .catch(() => {
        // Try again at the next due time rather than after every reply.
        if (due === 'global') save({ lastRun: now });
        else save({ projects: { ...mem.projects, [due]: { ...mem.projects[due], lastRun: now } } });
      })
      .finally(() => scheduleAuto(60_000)); // a project may be due as well
  }, delay);
}

/** Called by the store after every finished reply; may schedule memory synthesis. Must return quickly. */
export function afterReply(chat: Chat): void {
  if (!chatAllowed(chat) || settings().memory === false) return;
  const patch: Partial<MemoryState> = { pending: mem.pending + 1 };
  if (chat.projectId && getProject(chat.projectId)) {
    const p = mem.projects[chat.projectId] ?? { lastRun: 0, pending: 0 };
    patch.projects = { ...mem.projects, [chat.projectId]: { ...p, pending: p.pending + 1 } };
  }
  save(patch);
  if (!isLocal()) scheduleAuto();
}

// ---- editing ----

export function setMemoryText(text: string) {
  save({ text: text.trim(), updatedAt: Date.now() });
}

/** Forgets everything; automatic synthesis starts again from chats after now. */
export function resetMemory() {
  cancelMemoryUpdate();
  const now = Date.now();
  save({ text: '', updatedAt: now, lastRun: now, pending: 0, projects: Object.fromEntries(allProjects().map(p => [p.id, { lastRun: now, pending: 0 }])) });
}

export type MemoryView = { text: string; updatedAt: number; running: { scope: string; phase: string } | null };
let view: MemoryView = { text: mem.text, updatedAt: mem.updatedAt, running };
/** The global memory and synthesis progress, live. */
export function useMemory(): MemoryView {
  return useSyncExternalStore(subscribe, () => {
    if (view.text !== mem.text || view.updatedAt !== mem.updatedAt || view.running !== running) view = { text: mem.text, updatedAt: mem.updatedAt, running };
    return view;
  });
}

// ---- per-chat switch ----

function setChatOff(chatId: string, isOff: boolean) {
  if (off.has(chatId) === isOff) return;
  off = new Set(off);
  if (isOff) off.add(chatId);
  else off.delete(chatId);
  void kvSet(OFF_KEY, JSON.stringify([...off]));
  emit();
}

/**
 * The store drops draftChat.memory when it creates the chat, so watch for that moment and keep the choice for the
 * new chat. Subscribed lazily: the store imports this module, so it is not ready while this file loads.
 */
let watchingDraft = false;
function watchDraft() {
  if (watchingDraft) return;
  watchingDraft = true;
  let known = new Set(getState().chats.map(c => c.id));
  let draftOff = getState().draftChat.memory === false;
  subscribeStore(() => {
    const s = getState();
    const fresh = s.chats.find(c => !known.has(c.id));
    if (fresh || s.chats.length !== known.size) known = new Set(s.chats.map(c => c.id));
    if (fresh && draftOff && s.draftChat.memory === undefined) setChatOff(fresh.id, true);
    draftOff = s.draftChat.memory === false;
  });
}

const offSnapshot = () => off;

/** Whether memory is on for a chat (null = the next new chat), and a setter: the + sheet's Memory switch. */
export function useChatMemory(chatId: string | null): [boolean, (on: boolean) => void] {
  const offSet = useSyncExternalStore(subscribe, offSnapshot);
  const draft = useStore(s => s.draftChat);
  const globalOn = useStore(s => s.settings.memory !== false);
  const incognito = useStore(s => (chatId ? !!s.chats.find(c => c.id === chatId)?.incognito : !!s.draftChat.incognito));
  const on = incognito ? false : chatId ? !offSet.has(chatId) : (draft.memory ?? globalOn);
  const set = (value: boolean) => {
    if (incognito) return;
    if (chatId) return setChatOff(chatId, !value);
    watchDraft();
    setDraftChat({ memory: value });
  };
  return [on, set];
}

/** Whether a chat may use memory (for UI badges). */
export const chatMemoryOn = (chat: Chat) => chatAllowed(chat);
