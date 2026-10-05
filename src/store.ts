import { File } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { deleteChatRow, deleteMessage, getApiKey, kvGetSync, kvSet, loadChats, saveChat, saveMessage, setApiKey, type Attachment, type Chat, type Message } from '@/db';
import { nextModel, reason, recordSuccess, shouldSwitch } from '@/llm/fallback';
import { listModels, streamChat, type ChatMessage, type ProviderConfig } from '@/llm/stream';
import { localModel } from '@/local/catalog';
import { streamLocal } from '@/local/runtime';
import { formatForModel, providerPresets } from '@/shared/providerCatalog';

export type { Attachment, Chat, Message };

export type Settings = {
  providerId: string;
  model: string;
  /** Base URL per provider, for custom, local and Ollama endpoints. */
  baseUrls: Record<string, string>;
  fallback: boolean;
  haptics: boolean;
  theme: 'system' | 'light' | 'dark';
  voiceLang: string;
  onboarded: boolean;
  /** Last version whose What's New was shown. */
  seenVersion: string;
};

type State = {
  chats: Chat[];
  settings: Settings;
  /** Providers with a saved key (or keyless local endpoints the user set up). */
  keyed: string[];
  streamingChat: string | null;
  /** Last fallback switch, shown above the composer. */
  notice: { chatId: string; text: string } | null;
  modelSheet: boolean;
};

const defaults: Settings = { providerId: 'nvidia', model: '', baseUrls: {}, fallback: true, haptics: true, theme: 'system', voiceLang: 'en-US', onboarded: false, seenVersion: '' };
const saved = kvGetSync('settings');

let state: State = {
  chats: loadChats(),
  settings: { ...defaults, ...(saved ? JSON.parse(saved) : {}) },
  keyed: JSON.parse(kvGetSync('keyed') ?? '[]'),
  streamingChat: null,
  notice: null,
  modelSheet: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(
    l => (listeners.add(l), () => listeners.delete(l)),
    () => pick(state),
  );
}

export const getState = () => state;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- settings and keys ----

export function updateSettings(patch: Partial<Settings>) {
  set({ settings: { ...state.settings, ...patch } });
  kvSet('settings', JSON.stringify(state.settings));
}

export const presetOf = (providerId: string) => providerPresets.find(p => p.id === providerId);
const KEYLESS = new Set(['local', 'ollama']);

export async function saveProviderKey(providerId: string, key: string, baseUrl?: string) {
  await setApiKey(providerId, key.trim());
  const keyed = key.trim() || KEYLESS.has(providerId) ? [...new Set([...state.keyed, providerId])] : state.keyed.filter(p => p !== providerId);
  set({ keyed });
  kvSet('keyed', JSON.stringify(keyed));
  if (baseUrl !== undefined) updateSettings({ baseUrls: { ...state.settings.baseUrls, [providerId]: baseUrl.trim() } });
}

export async function configFor(providerId: string, model: string): Promise<ProviderConfig> {
  const preset = presetOf(providerId);
  const baseUrl = state.settings.baseUrls[providerId] || preset?.baseUrl || '';
  return { providerId, baseUrl, model, apiKey: (await getApiKey(providerId)) ?? '', format: formatForModel(providerId, model, preset?.format ?? 'openai-chat', baseUrl) };
}

export const modelLabel = (s: Settings) => s.providerId === 'on-device' ? (localModel(s.model)?.name ?? 'On-device model') : s.model || presetOf(s.providerId)?.name || 'Choose a model';

/** Chat models each saved key can call, fetched on demand for the model picker. */
const modelLists = new Map<string, string[]>();
export async function modelsFor(providerId: string, refresh = false): Promise<string[]> {
  if (!refresh && modelLists.has(providerId)) return modelLists.get(providerId)!;
  const models = (await listModels(await configFor(providerId, ''))).sort();
  modelLists.set(providerId, models);
  return models;
}

/** Checks a key by listing its models; throws the provider's error for a bad key. */
export async function testKey(providerId: string, key: string, baseUrl?: string) {
  const preset = presetOf(providerId);
  const url = baseUrl?.trim() || state.settings.baseUrls[providerId] || preset?.baseUrl || '';
  return listModels({ providerId, baseUrl: url, apiKey: key.trim(), model: '', format: preset?.format ?? 'openai-chat' });
}

export const setModelSheet = (open: boolean) => set({ modelSheet: open });

export function chooseModel(providerId: string, model: string) {
  updateSettings({ providerId, model });
}

// ---- chats ----

function updateChat(id: string, fn: (c: Chat) => Chat) {
  set({ chats: state.chats.map(c => (c.id === id ? fn(c) : c)) });
}
const chatOf = (id: string) => state.chats.find(c => c.id === id);

/** Sends a message; creates the chat when `chatId` is null. Returns the chat id. */
export function send(chatId: string | null, text: string, attachments: Attachment[] = []): string {
  let id = chatId;
  if (!id) {
    id = uid();
    const title = text ? (text.length > 40 ? text.slice(0, 40).trimEnd() + '…' : text) : (attachments[0]?.name ?? 'New chat');
    const chat: Chat = { id, title, starred: false, updatedAt: Date.now(), messages: [] };
    set({ chats: [chat, ...state.chats] });
    saveChat(chat);
  }
  const msg: Message = { id: uid(), role: 'user', text, attachments: attachments.length ? attachments : undefined, createdAt: Date.now() };
  updateChat(id, c => ({ ...c, messages: [...c.messages, msg] }));
  saveMessage(id, msg);
  void streamReply(id);
  return id;
}

/** Drops the last reply and asks again. */
export function retry(chatId: string) {
  const last = chatOf(chatId)?.messages.at(-1);
  if (last?.role === 'assistant') {
    deleteMessage(last.id);
    updateChat(chatId, c => ({ ...c, messages: c.messages.slice(0, -1) }));
  }
  void streamReply(chatId);
}

/** Reply error when no model is picked yet; the chat offers the model picker instead of Try again. */
export const NO_MODEL = 'Pick a model first. Add a free key and choose one of its models.';

const SYSTEM =
  'You are Neru, a helpful assistant in the Neru mobile app. Answer clearly and concisely; the reader is on a phone, so prefer short paragraphs and lists. Use Markdown, and fenced code blocks with a language for code.';

async function imagePart(a: Attachment) {
  if (a.base64) return { mime: a.mime, base64: a.base64 };
  try {
    return { mime: a.mime, base64: await new File(a.uri).base64() };
  } catch {
    return null; // the picked file is gone; send the turn without it
  }
}

async function history(chat: Chat): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [{ role: 'system', text: SYSTEM }];
  for (const m of chat.messages) {
    if (m.role === 'assistant' && (m.error || !m.text)) continue;
    const images = (await Promise.all((m.attachments ?? []).filter(a => a.kind === 'image').map(imagePart))).filter(x => x !== null);
    const fence = '```';
    const files = (m.attachments ?? []).filter(a => a.kind === 'file').map(a => (a.text ? `File ${a.name}:\n${fence}\n${a.text}\n${fence}` : `[Attached file: ${a.name}]`));
    out.push({ role: m.role, text: [m.text, ...files].filter(Boolean).join('\n\n') || '(image)', images: images.length ? images : undefined });
  }
  return out;
}

let abort: AbortController | null = null;

async function streamReply(chatId: string) {
  stop();
  const controller = new AbortController();
  abort = controller;
  const reply: Message = { id: uid(), role: 'assistant', text: '', createdAt: Date.now() };
  updateChat(chatId, c => ({ ...c, updatedAt: Date.now(), messages: [...c.messages, reply] }));
  set({ streamingChat: chatId, notice: state.notice?.chatId === chatId ? null : state.notice });

  // Deltas arrive in tiny pieces; render them in ~30 fps batches instead of one update each.
  let text = '';
  let reasoning = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    flushTimer = null;
    updateChat(chatId, c => ({ ...c, messages: c.messages.map(m => (m.id === reply.id ? { ...m, text, reasoning: reasoning || undefined } : m)) }));
  };
  const schedule = () => (flushTimer ??= setTimeout(flush, 33));

  const chat = chatOf(chatId)!;
  const messages = await history({ ...chat, messages: chat.messages.filter(m => m.id !== reply.id) });
  let { providerId, model } = state.settings;
  let error: string | undefined;

  for (let attempt = 0; attempt < 5; attempt++) {
    const config = await configFor(providerId, model);
    if (!config.model) {
      error = NO_MODEL;
      break;
    }
    try {
      if (providerId === 'on-device') {
        await streamLocal(model, messages, d => ((text += d), schedule()), controller.signal, phase => set({ notice: { chatId, text: phase === 'loading' ? 'Loading the model on your phone…' : 'Running on this phone · Offline' } }), r => ((reasoning += r), schedule()));
      } else {
        await streamChat(config, messages, { onDelta: d => ((text += d), schedule()), onReasoning: r => ((reasoning += r), schedule()) }, controller.signal);
        void recordSuccess(config);
      }
      error = undefined;
      break;
    } catch (err) {
      if (controller.signal.aborted) break;
      error = err instanceof Error ? err.message : String(err);
      // Switch only before any text arrived, so a reply is never stitched from two models.
      if (providerId === 'on-device' || text || !state.settings.fallback || !shouldSwitch(error)) break;
      const keys = await Promise.all(state.keyed.filter(p => presetOf(p)?.freeLimit || p === providerId).map(p => configFor(p, '')));
      const next = await nextModel(config, error, keys);
      if (!next) break;
      set({ notice: { chatId, text: `${model} ${reason(error)}. Switched to ${next.model}.` } });
      ({ providerId, model } = next);
      updateSettings({ providerId, model });
    }
  }

  if (flushTimer) clearTimeout(flushTimer);
  if (abort === controller) {
    abort = null;
    set({ streamingChat: null });
  }
  if (!chatOf(chatId)) return; // deleted while answering
  const final: Message = { ...reply, text, reasoning: reasoning || undefined, model, error: text ? undefined : error };
  updateChat(chatId, c => ({ ...c, updatedAt: Date.now(), messages: c.messages.map(m => (m.id === reply.id ? final : m)) }));
  saveMessage(chatId, final);
  saveChat(chatOf(chatId)!);
  const done = chatOf(chatId)!;
  if (text && done.messages.length === 2) void autoTitle(chatId, providerId, model, done.messages[0].text, text);
}

/** Names a new chat from its first exchange, like Claude does; keeps the first words if this fails. */
async function autoTitle(chatId: string, providerId: string, model: string, question: string, answer: string) {
  let title = '';
  try {
    const config = await configFor(providerId, model);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15_000);
    await streamChat(
      config,
      [
        { role: 'system', text: 'Write a title of 2 to 6 words for this conversation. Reply with the title only: no quotes, no punctuation at the end.' },
        { role: 'user', text: `User: ${question.slice(0, 1500)}\n\nAssistant: ${answer.slice(0, 1500)}` },
      ],
      { onDelta: d => (title += d) },
      timeout.signal,
    );
    clearTimeout(timer);
  } catch {
    return;
  }
  title = title.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^["'#*\s]+|["'.*\s]+$/g, '').split('\n')[0].slice(0, 60);
  if (title && chatOf(chatId)) renameChat(chatId, title);
}

export function stop() {
  abort?.abort();
  abort = null;
  if (state.streamingChat) set({ streamingChat: null });
}

export function toggleStar(id: string) {
  updateChat(id, c => ({ ...c, starred: !c.starred }));
  saveChat(chatOf(id)!);
}

export function deleteChat(id: string) {
  if (state.streamingChat === id) stop();
  set({ chats: state.chats.filter(c => c.id !== id) });
  deleteChatRow(id);
}

export function restoreChat(chat: Chat) {
  set({ chats: [chat, ...state.chats].sort((a, b) => b.updatedAt - a.updatedAt) });
  saveChat(chat);
  chat.messages.forEach(m => saveMessage(chat.id, m));
}

/** Replaces a sent message with new text and asks again from there, dropping the later turns. */
export function editMessage(chatId: string, messageId: string, text: string) {
  const chat = chatOf(chatId);
  const index = chat?.messages.findIndex(m => m.id === messageId) ?? -1;
  if (!chat || index < 0) return;
  stop();
  const dropped = chat.messages.slice(index);
  dropped.forEach(m => deleteMessage(m.id));
  const msg: Message = { ...chat.messages[index], id: uid(), text, createdAt: Date.now() };
  updateChat(chatId, c => ({ ...c, messages: [...c.messages.slice(0, index), msg] }));
  saveMessage(chatId, msg);
  void streamReply(chatId);
}

export function deleteAllChats() {
  stop();
  state.chats.forEach(c => deleteChatRow(c.id));
  set({ chats: [] });
}

export function renameChat(id: string, title: string) {
  updateChat(id, c => ({ ...c, title }));
  saveChat(chatOf(id)!);
}
