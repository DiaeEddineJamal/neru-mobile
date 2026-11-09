// Every artifact in every chat, derived from the assistant messages (nothing extra is stored), plus pins kept in kv.
// An artifact is identified per chat by its id; each message that writes that id again is a new version.
import { useMemo, useSyncExternalStore } from 'react';

import { splitArtifacts, mayHaveArtifacts, type Artifact } from '@/artifacts/parse';
import { kvGetSync, kvSet } from '@/db';
import { getState, useStore, type Chat, type Message } from '@/store';

export type ArtifactVersion = { messageId: string; createdAt: number; artifact: Artifact };
export type ArtifactEntry = {
  /** `chatId~artifactId`: stable across versions, used for pins and list keys. */
  key: string;
  chatId: string;
  chatTitle: string;
  incognito: boolean;
  /** Oldest first; the last one is the current version. */
  versions: ArtifactVersion[];
  latest: Artifact;
  updatedAt: number;
};

const SEP = '~';

/** Route key for the viewer: chat, artifact and (optionally) the message that holds the version to show. */
export function artifactKey(chatId: string | null, artifactId: string, messageId?: string): string {
  return [chatId ?? '', artifactId, messageId ?? ''].join(SEP);
}

export function parseArtifactKey(key: string): { chatId: string; artifactId: string; messageId: string } {
  const [chatId = '', artifactId = '', messageId = ''] = decodeSafe(key).split(SEP);
  return { chatId, artifactId, messageId };
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Parsing is cached per message text, so a store change re-parses only the message that changed.
const cache = new Map<string, { text: string; artifacts: Artifact[] }>();

export function artifactsOf(m: Message): Artifact[] {
  if (m.role !== 'assistant' || !m.text || !mayHaveArtifacts(m.text)) return [];
  const hit = cache.get(m.id);
  if (hit && hit.text === m.text) return hit.artifacts;
  const artifacts = splitArtifacts(m.text).flatMap(s => (s.type === 'artifact' ? [s.artifact] : []));
  cache.set(m.id, { text: m.text, artifacts });
  return artifacts;
}

function entriesOf(chat: Chat): ArtifactEntry[] {
  const byId = new Map<string, ArtifactEntry>();
  for (const m of chat.messages) {
    for (const a of artifactsOf(m)) {
      const key = chat.id + SEP + a.id;
      let e = byId.get(key);
      if (!e) {
        e = { key, chatId: chat.id, chatTitle: chat.title, incognito: !!chat.incognito, versions: [], latest: a, updatedAt: m.createdAt };
        byId.set(key, e);
      }
      e.versions.push({ messageId: m.id, createdAt: m.createdAt, artifact: a });
      e.latest = a;
      e.updatedAt = Math.max(e.updatedAt, m.createdAt);
    }
  }
  return [...byId.values()];
}

export function buildIndex(chats: Chat[]): ArtifactEntry[] {
  return chats.flatMap(entriesOf).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** All artifacts, newest first. Incognito chats are left out of the list. */
export function useArtifactIndex(): ArtifactEntry[] {
  const chats = useStore(s => s.chats);
  return useMemo(() => buildIndex(chats.filter(c => !c.incognito)), [chats]);
}

/** One artifact with all its versions, found from a route key (null when the chat or artifact is gone). */
export function findArtifact(chats: Chat[], key: string): { entry: ArtifactEntry; version: ArtifactVersion } | null {
  const { chatId, artifactId, messageId } = parseArtifactKey(key);
  const chat = chats.find(c => c.id === chatId) ?? (messageId ? chats.find(c => c.messages.some(m => m.id === messageId)) : undefined);
  if (!chat) return null;
  const entry = entriesOf(chat).find(e => e.latest.id === artifactId);
  if (!entry) return null;
  const version = entry.versions.find(v => v.messageId === messageId) ?? entry.versions[entry.versions.length - 1];
  return { entry, version };
}

/** Whether a message is the reply streaming right now; use as a store selector. */
export function isStreaming(s: ReturnType<typeof getState>, chatId: string | null, messageId: string): boolean {
  if (!s.streamingChat || (chatId && chatId !== s.streamingChat)) return false;
  const chat = s.chats.find(c => c.id === s.streamingChat);
  return !!chat && chat.messages[chat.messages.length - 1]?.id === messageId;
}

// ---- Pins ----

const PINS_KEY = 'artifactPins';
let pins: string[] = readPins();
const pinListeners = new Set<() => void>();

function readPins(): string[] {
  try {
    const v = JSON.parse(kvGetSync(PINS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function usePins(): string[] {
  return useSyncExternalStore(l => (pinListeners.add(l), () => void pinListeners.delete(l)), () => pins);
}

export function togglePin(key: string) {
  pins = pins.includes(key) ? pins.filter(k => k !== key) : [key, ...pins];
  pinListeners.forEach(l => l());
  void kvSet(PINS_KEY, JSON.stringify(pins));
}
