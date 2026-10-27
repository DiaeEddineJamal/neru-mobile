import { File } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { deleteChatRow, deleteMessage, getApiKey, kvGetSync, kvSet, loadChats, saveChat, saveMessage, setApiKey, type Attachment, type Chat, type Message, type ToolStep } from '@/db';
import { clearComposerDraft } from '@/drafts';
import { nextModel, reason, recordSuccess, shouldSwitch } from '@/llm/fallback';
import { listModels, streamChat, type ChatMessage, type ProviderConfig, type ToolCall } from '@/llm/stream';
import { beforeCall, CLOUD_TOOLS_CHARS, coerceArgs, localToolPrompt, localToolsForTask, mayRun, parseArgs, parseLocalCalls, rejectsTools, rememberNoTools, toolMode, toolSpecs, unsupportedTools } from '@/llm/tools';
import { chatTools, runTool } from '@/mcp/store';
import { localModel } from '@/local/catalog';
import { preloadLocal, streamLocal, unloadLocal } from '@/local/runtime';
import { readDocument } from '@/documents';
import { formatForModel, privacyAllows, privacyLabels, privacyOf, providerPresets, type PrivacyRule } from '@/shared/providerCatalog';
import { redact } from '@/shared/redact';
import { setLanguage, t as tx, voiceLocale, type LanguageSetting } from '@/i18n';
import { estimateTokens, recordUsage } from '@/usage';

export type { Attachment, Chat, Message, ToolStep };

export type Settings = {
  providerId: string;
  model: string;
  /** Base URL per provider, for custom, local and Ollama endpoints. */
  baseUrls: Record<string, string>;
  fallback: boolean;
  haptics: boolean;
  theme: 'system' | 'light' | 'dark';
  /** Accent theme from `palettes` in theme.ts, applied in light and dark alike. */
  palette?: string;
  /** First-run walkthrough: 'pending' starts it on the home screen. */
  tour?: 'pending' | 'done';
  voiceLang: string;
  onboarded: boolean;
  /** Last version whose What's New was shown. */
  seenVersion: string;
  /** A release the user chose "Later" for; offered again only once a newer one ships. */
  skippedUpdate?: string;
  /** What models call the user, and which pronouns and grammatical gender they use for them. */
  name?: string;
  gender?: 'male' | 'female';
  /** Occasional, gentle check-in notifications. */
  nudges: boolean;
  /** Which providers chats may use, by what their terms say they do with prompts. */
  privacy: PrivacyRule;
  /** Hide keys, tokens and passwords in messages before they go to a cloud model. */
  redact: boolean;
  /** The interface language; 'system' follows the phone. */
  language?: LanguageSetting;
  /** Let chats use connector tools (MCP). */
  connectors?: boolean;
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

const defaults: Settings = { providerId: 'nvidia', model: '', baseUrls: {}, fallback: true, haptics: true, theme: 'system', voiceLang: 'en-US', onboarded: false, seenVersion: '', nudges: true, privacy: 'any', redact: true };
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
/** Called on every store change, for code outside React (notifications). */
export const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- settings and keys ----

export function updateSettings(patch: Partial<Settings>) {
  set({ settings: { ...state.settings, ...patch } });
  kvSet('settings', JSON.stringify(state.settings));
}

/**
 * Switches the interface language; dictation follows it. Returns true when the layout direction changes
 * (Arabic and Darija are right to left), which Android applies after a restart.
 */
export function changeLanguage(language: LanguageSetting): boolean {
  const flips = setLanguage(language);
  updateSettings({ language, voiceLang: voiceLocale() });
  return flips;
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

export const modelLabel = (s: Settings) => s.providerId === 'on-device' ? (localModel(s.model)?.name ?? tx('On-device model')) : s.model || presetOf(s.providerId)?.name || tx('Choose a model');

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
  if (providerId === 'on-device' && model) preloadLocal(model);
  else void unloadLocal().catch(() => {});
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
    const title = text ? (text.length > 40 ? text.slice(0, 40).trimEnd() + '…' : text) : (attachments[0]?.name ?? tx('New chat'));
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

/** Why the privacy setting keeps a provider out, or null when it may be used. */
export function privacyBlock(providerId: string, rule: PrivacyRule = state.settings.privacy): string | null {
  const privacy = privacyOf(providerId);
  if (privacyAllows(rule, privacy)) return null;
  const name = providerId === 'on-device' ? tx('This model') : (presetOf(providerId)?.name ?? providerId);
  const label = tx(privacyLabels[privacy].label).toLowerCase();
  return rule === 'local'
    ? tx('{name}: {label}. Your privacy setting allows only models on your own devices, so pick another model or change it in Settings.', { name, label })
    : tx('{name}: {label}. Your privacy setting allows only providers that do not train on your data, so pick another model or change it in Settings.', { name, label });
}

/** Hides secrets in what goes to a cloud model; returns the messages and how many were hidden. */
function hideSecrets(messages: ChatMessage[]) {
  let hidden = 0;
  const out = messages.map(m => {
    const r = redact(m.text);
    hidden += r.secrets.length;
    return r.secrets.length ? { ...m, text: r.text } : m;
  });
  return { messages: out, hidden };
}

/** Model requests one reply may make while it uses tools. */
const MAX_TOOL_ROUNDS = 8;

/** Reply error when no model is picked yet; the chat offers the model picker instead of Try again. */
export const NO_MODEL = 'Pick a model first. Add a free key and choose one of its models.';

const SYSTEM =
  'You are Neru, a helpful assistant in the Neru mobile app. Answer clearly and concisely; the reader is on a phone, so prefer short paragraphs and lists. Use Markdown, and fenced code blocks with a language for code.';

async function imagePart(a: Attachment, local = false) {
  // Native inference reads the file directly and downsizes it. Avoid copying every historical photo into JS
  // as base64, which adds disk reads and large temporary strings before a local reply can start.
  if (local) return { mime: a.mime, base64: '', uri: a.uri };
  if (a.base64) return { mime: a.mime, base64: a.base64, uri: a.uri };
  try {
    return { mime: a.mime, base64: await new File(a.uri).base64(), uri: a.uri };
  } catch {
    return null; // the picked file is gone; send the turn without it
  }
}

/** Tells every model, cloud or on-device, who it is talking to. */
export function profilePrompt(s: Settings = state.settings) {
  const name = s.name?.trim();
  if (!name && !s.gender) return '';
  const who = s.gender === 'male' ? 'He is a man: use he/him, and masculine forms in languages with grammatical gender.' : s.gender === 'female' ? 'She is a woman: use she/her, and feminine forms in languages with grammatical gender.' : '';
  return [name ? `The user's name is ${name}. Use it now and then, naturally, not in every reply.` : '', who].filter(Boolean).join(' ');
}

async function history(chat: Chat, local = false): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [{ role: 'system', text: [SYSTEM, profilePrompt()].filter(Boolean).join('\n\n') }];
  for (const m of chat.messages) {
    if (m.role === 'assistant' && (m.error || !m.text)) continue;
    const images = (await Promise.all((m.attachments ?? []).filter(a => a.kind === 'image').map(a => imagePart(a, local)))).filter(x => x !== null);
    const fence = '```';
    const files: string[] = [];
    for (const a of (m.attachments ?? []).filter(a => a.kind === 'file')) {
      try {
        const body = a.text ?? (await readDocument(a.uri, a.name, a.mime)).text;
        files.push(`File ${a.name}:\n${fence}\n${body}\n${fence}`);
      } catch (error) { files.push(`[Could not read ${a.name}: ${error instanceof Error ? error.message : String(error)}]`); }
    }
    out.push({ role: m.role, text: [m.text, ...files].filter(Boolean).join('\n\n') || '(image)', images: images.length ? images : undefined });
  }
  return out;
}

let abort: AbortController | null = null;
let titling: AbortController | null = null;

async function streamReply(chatId: string) {
  stop();
  titling?.abort(); // a phone runs one model at a time: the new reply goes first
  const controller = new AbortController();
  abort = controller;
  const reply: Message = { id: uid(), role: 'assistant', text: '', createdAt: Date.now() };
  updateChat(chatId, c => ({ ...c, updatedAt: Date.now(), messages: [...c.messages, reply] }));
  set({ streamingChat: chatId, notice: state.notice?.chatId === chatId ? null : state.notice });

  // Deltas arrive in tiny pieces; render them in ~30 fps batches instead of one update each.
  let text = '';
  let reasoning = '';
  let steps: ToolStep[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    flushTimer = null;
    updateChat(chatId, c => ({ ...c, messages: c.messages.map(m => (m.id === reply.id ? { ...m, text, reasoning: reasoning.trim() ? reasoning : undefined, tools: steps.length ? steps : undefined } : m)) }));
  };
  // An on-device reply shares the processor with the screen: about 7 redraws a second leave most of it to the model.
  const schedule = () => (flushTimer ??= setTimeout(flush, providerId === 'on-device' ? 150 : 33));

  const chat = chatOf(chatId)!;
  let { providerId, model } = state.settings;
  const messages = await history({ ...chat, messages: chat.messages.filter(m => m.id !== reply.id) }, providerId === 'on-device');
  let error: string | undefined;
  const rule = state.settings.privacy;
  // Tools from the phone's connectors, and the paired desktop's while it is connected.
  const connected = state.settings.connectors === false ? [] : chatTools();
  let toolsRan = false;

  for (let attempt = 0; attempt < 5; attempt++) {
    const config = await configFor(providerId, model);
    if (!config.model) {
      error = NO_MODEL;
      break;
    }
    const blocked = privacyBlock(providerId, rule);
    if (blocked) {
      error = blocked;
      break;
    }
    const local = providerId === 'on-device';
    // Models with a tool API get native definitions; the rest (every phone model, and cloud models whose API refuses
    // tools) read the same tools as a text protocol and write <tool_call> blocks that Neru runs.
    let tools = toolMode(providerId, model) === 'none' ? [] : connected;
    let textTools = toolMode(providerId, model) === 'text';
    if (connected.length && !tools.length) set({ notice: { chatId, text: tx('{model} can’t use connector tools, so it answers without them. Pick a model marked MCP tools to use them.', { model: local ? (localModel(model)?.name ?? model) : model }) } });
    try {
      // The conversation for this reply; tool calls and their results are added to it round by round.
      const working: ChatMessage[] = [...messages];
      const task = ([...messages].reverse().find(m => m.role === 'user')?.text ?? '').slice(0, 800);
      const useTextTools = () => {
        textTools = true;
        // A phone model's small context gets the tools for the app the user named; a cloud model gets them all.
        if (local) tools = localToolsForTask(tools, task);
        working[0] = { ...messages[0], text: `${messages[0].text}\n\n${localToolPrompt(tools, local ? undefined : CLOUD_TOOLS_CHARS)}` };
      };
      if (textTools && tools.length) useTextTools();
      let shown = '';
      for (let round = 0; round < MAX_TOOL_ROUNDS && !controller.signal.aborted; round++) {
        let said = '';
        // Tokens as the provider reports them; some repeat running totals, so keep the largest.
        let used = { input: 0, output: 0 };
        const onUsage = (i: number, o: number) => (used = { input: Math.max(used.input, i), output: Math.max(used.output, o) });
        const onDelta = (d: string) => {
          said += d;
          text = shown + (textTools && tools.length ? beforeCall(said) : said);
          schedule();
        };
        let calls: ToolCall[];
        if (local) {
          await streamLocal(model, working, onDelta, controller.signal, phase => set({ notice: { chatId, text: phase === 'loading' ? tx('Loading the model on your phone…') : tx('Running on this phone · Offline') } }), r => ((reasoning += r), schedule()), tools.length > 0);
          const parsed = parseLocalCalls(said);
          calls = tools.length ? parsed.calls : [];
          text = shown + (tools.length ? parsed.visible : said);
          if (tools.length && !calls.length && parsed.invalid && round < MAX_TOOL_ROUNDS - 1) {
            steps = [...steps, { name: tx('Tool call'), label: tx('Unreadable'), status: 'failed', detail: parsed.invalid }];
            working.push({ role: 'assistant', text: said }, { role: 'user', text: `Original request: ${task}\n\nYour tool call was not valid JSON, so it did not run. Write it again as <tool_call>{"name": "...", "arguments": {...}}</tool_call> with every bracket closed.` });
            shown = text ? `${text}\n\n` : '';
            continue;
          }
        } else {
          const sent = state.settings.redact ? hideSecrets(working) : { messages: working, hidden: 0 };
          if (sent.hidden && round === 0) set({ notice: { chatId, text: sent.hidden === 1 ? tx('Hid 1 secret (keys, tokens or passwords) before sending.') : tx('Hid {n} secrets (keys, tokens or passwords) before sending.', { n: sent.hidden }) } });
          // Built per request: switching to text tools rewrites the system message.
          const ask = (strict = false) => streamChat(config, state.settings.redact ? hideSecrets(working).messages : working, { onDelta, onReasoning: r => ((reasoning += r), schedule()), onUsage }, controller.signal, textTools ? [] : toolSpecs(tools), strict);
          // A request the provider refused outright, before any text: one it may accept with other tool schemas.
          const refused = (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            return !said && !controller.signal.aborted && (rejectsTools(message) || /http 4(00|22)\b/i.test(message));
          };
          try {
            calls = await ask();
          } catch (err) {
            if (!tools.length || textTools || !refused(err)) throw err;
            try {
              // Some hosts reject JSON Schema features in a connector's tools (Gemini: "Request contains an invalid
              // argument"): try the strict subset every provider accepts.
              if (unsupportedTools(err instanceof Error ? err.message : String(err))) throw err;
              calls = await ask(true);
            } catch (again) {
              if (!refused(again)) throw again;
              // The model or its host takes no tool definitions: give it the same tools as text instead, and
              // remember that for its next chats.
              useTextTools();
              calls = await ask();
              if (unsupportedTools(again instanceof Error ? again.message : String(again))) rememberNoTools(providerId, model);
            }
          }
          if (textTools && tools.length) {
            const parsed = parseLocalCalls(said);
            calls = parsed.calls;
            text = shown + parsed.visible;
            if (!calls.length && parsed.invalid && round < MAX_TOOL_ROUNDS - 1) {
              steps = [...steps, { name: tx('Tool call'), label: tx('Unreadable'), status: 'failed', detail: parsed.invalid }];
              working.push({ role: 'assistant', text: said }, { role: 'user', text: `Original request: ${task}\n\nYour tool call was not valid JSON, so it did not run. Write it again as <tool_call>{"name": "...", "arguments": {...}}</tool_call> with every bracket closed.` });
              shown = text ? `${text}\n\n` : '';
              continue;
            }
          }
          void recordSuccess(config);
        }
        recordUsage(providerId, model, used.input || estimateTokens(working.map(m => m.text).join(' ')), used.output || estimateTokens(said));
        if (!calls.length || controller.signal.aborted) break;
        working.push({ role: 'assistant', text: said, toolCalls: textTools ? undefined : calls });
        for (const call of calls) {
          const tool = tools.find(t => t.fn === call.name);
          // Back to the shapes the tool declared: Gemini writes free-form objects and number enums as text.
          let args: Record<string, unknown> = {};
          let argumentError = '';
          try { args = tool ? coerceArgs(parseArgs(call.args), tool.schema) : parseArgs(call.args); }
          catch (err) { argumentError = err instanceof Error ? err.message : String(err); }
          let result: string;
          const index = steps.length;
          steps = [...steps, { name: tool?.title ?? call.name, label: tool?.label ?? tx('Unknown tool'), status: 'running', detail: JSON.stringify(args, null, 2) }];
          schedule();
          const mark = (status: ToolStep['status']) => ((steps = steps.map((s, i) => (i === index ? { ...s, status } : s))), schedule());
          if (!tool) {
            result = `There is no tool named ${call.name}.`;
            mark('failed');
          } else if (argumentError) {
            result = argumentError;
            mark('failed');
          } else if (!(await mayRun(chatId, tool, args, controller.signal))) {
            result = 'The user declined to run this tool. Do not try it again unless they ask.';
            mark('denied');
          } else {
            try {
              result = await runTool(tool, args);
              mark('done');
            } catch (err) {
              result = `The tool failed: ${err instanceof Error ? err.message : String(err)}`;
              mark('failed');
            }
          }
          // The row shows what was sent and the start of what came back.
          steps = steps.map((s, i) => (i === index ? { ...s, detail: `${s.detail ?? ''}\n\n→ ${result.length > 1500 ? `${result.slice(0, 1500)}…` : result}`.trim() } : s));
          schedule();
          toolsRan = true;
          // A phone model reads about 1,000 tokens of a result; more would crowd out the conversation.
          if (textTools) working.push({ role: 'user', text: `Original request: ${task}\n\n<tool_result name="${call.name}">\n${result.slice(0, local ? 3000 : 60000)}\n</tool_result>` });
          else working.push({ role: 'tool', toolCallId: call.id, name: call.name, text: result });
        }
        shown = text ? `${text}\n\n` : '';
      }
      error = undefined;
      break;
    } catch (err) {
      if (controller.signal.aborted) break;
      error = err instanceof Error ? err.message : String(err);
      // Switch only before any text arrived or any tool ran, so a reply is never stitched from two models.
      if (local || text || toolsRan || !state.settings.fallback || !shouldSwitch(error)) break;
      const keys = await Promise.all(state.keyed.filter(p => (presetOf(p)?.freeLimit || p === providerId) && !privacyBlock(p, rule)).map(p => configFor(p, '')));
      const next = await nextModel(config, error, keys);
      if (!next) break;
      set({ notice: { chatId, text: tx('{model} {reason}. Switched to {next}.', { model, reason: tx(reason(error)), next: next.model }) } });
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
  const ended = steps.map(s => (s.status === 'running' ? { ...s, status: 'failed' as const } : s));
  const final: Message = { ...reply, text, reasoning: reasoning.trim() || undefined, model, error: text ? undefined : error, tools: ended.length ? ended : undefined };
  updateChat(chatId, c => ({ ...c, updatedAt: Date.now(), messages: c.messages.map(m => (m.id === reply.id ? final : m)) }));
  saveMessage(chatId, final);
  saveChat(chatOf(chatId)!);
  const done = chatOf(chatId)!;
  // Name the chat after its first real answer (a failed first try or a retry still counts as the first).
  const answered = done.messages.filter(m => m.role === 'assistant' && m.text && !m.error).length;
  const question = done.messages.find(m => m.role === 'user')?.text ?? '';
  if (text && answered === 1) void autoTitle(chatId, providerId, model, question, text);
}

/** Names a new chat from its first exchange with the model that answered, on-device ones included, like
 * Claude does; keeps the first words if this fails. */
async function autoTitle(chatId: string, providerId: string, model: string, question: string, answer: string) {
  // On the phone's own model a second run would hold the processor right after the reply, and drop the kept
  // conversation that makes the next reply fast: the chat keeps its first words as its name instead.
  if (providerId === 'on-device') return;
  let title = '';
  const prompt: ChatMessage[] = [
    { role: 'system', text: 'You name conversations. Reply with a short title of 2 to 6 words that says what this conversation is about, in the language the user wrote in. Title only: no quotes, no emoji, no punctuation at the end.' },
    { role: 'user', text: `User: ${question.slice(0, 1500)}\n\nAssistant: ${answer.slice(0, 1500)}\n\nTitle:` },
  ];
  const timeout = new AbortController();
  titling = timeout;
  const timer = setTimeout(() => timeout.abort(), 15_000);
  try {
    await streamChat(await configFor(providerId, model), prompt, { onDelta: d => (title += d) }, timeout.signal);
  } catch {
    return;
  } finally {
    clearTimeout(timer);
    if (titling === timeout) titling = null;
  }
  if (timeout.signal.aborted) return;
  title = title.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*title\s*:\s*/i, '').replace(/^["'#*\s]+|["'.*\s]+$/g, '').split('\n')[0].slice(0, 60);
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
  clearComposerDraft(id);
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
  state.chats.forEach(c => clearComposerDraft(c.id));
  clearComposerDraft('new');
  state.chats.forEach(c => deleteChatRow(c.id));
  set({ chats: [] });
}

export function renameChat(id: string, title: string) {
  updateChat(id, c => ({ ...c, title }));
  saveChat(chatOf(id)!);
}
