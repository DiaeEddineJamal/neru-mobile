// Local storage: chats and settings in SQLite; API keys stay in the OS keystore (expo-secure-store).
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync } from 'expo-sqlite';

const db = openDatabaseSync('neru.db');
db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, starred INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, role TEXT NOT NULL, text TEXT NOT NULL,
    reasoning TEXT, attachments TEXT, model TEXT, error TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, created_at);
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  PRAGMA foreign_keys = ON;
`);

export type Attachment = { id: string; kind: 'image' | 'file'; name: string; uri: string; mime: string; base64?: string; /** A text file's contents, sent inline. */ text?: string };
export type Message = { id: string; role: 'user' | 'assistant'; text: string; reasoning?: string; attachments?: Attachment[]; model?: string; error?: string; createdAt: number };
export type Chat = { id: string; title: string; starred: boolean; updatedAt: number; messages: Message[] };

type ChatRow = { id: string; title: string; starred: number; updated_at: number };
type MessageRow = { id: string; chat_id: string; role: 'user' | 'assistant'; text: string; reasoning: string | null; attachments: string | null; model: string | null; error: string | null; created_at: number };

export function loadChats(): Chat[] {
  const chats = db.getAllSync<ChatRow>('SELECT * FROM chats ORDER BY updated_at DESC');
  const rows = db.getAllSync<MessageRow>('SELECT * FROM messages ORDER BY created_at');
  const byChat = new Map<string, Message[]>();
  for (const r of rows) {
    const list = byChat.get(r.chat_id) ?? [];
    list.push({
      id: r.id,
      role: r.role,
      text: r.text,
      reasoning: r.reasoning ?? undefined,
      // Image bytes are not stored; the file uri is re-read when the chat is sent again.
      attachments: r.attachments ? JSON.parse(r.attachments) : undefined,
      model: r.model ?? undefined,
      error: r.error ?? undefined,
      createdAt: r.created_at,
    });
    byChat.set(r.chat_id, list);
  }
  return chats.map(c => ({ id: c.id, title: c.title, starred: !!c.starred, updatedAt: c.updated_at, messages: byChat.get(c.id) ?? [] }));
}

export function saveChat(c: Chat) {
  db.runSync('INSERT INTO chats (id, title, starred, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, starred = excluded.starred, updated_at = excluded.updated_at', [c.id, c.title, c.starred ? 1 : 0, c.updatedAt]);
}

export function saveMessage(chatId: string, m: Message) {
  const attachments = m.attachments?.length ? JSON.stringify(m.attachments.map(({ base64: _b, ...a }) => a)) : null;
  db.runSync(
    'INSERT INTO messages (id, chat_id, role, text, reasoning, attachments, model, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text, reasoning = excluded.reasoning, model = excluded.model, error = excluded.error',
    [m.id, chatId, m.role, m.text, m.reasoning ?? null, attachments, m.model ?? null, m.error ?? null, m.createdAt],
  );
}

export function deleteMessage(id: string) {
  db.runSync('DELETE FROM messages WHERE id = ?', [id]);
}

export function deleteChatRow(id: string) {
  db.runSync('DELETE FROM chats WHERE id = ?', [id]);
}

export async function kvGet(key: string) {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]))?.value ?? null;
}

export function kvGetSync(key: string) {
  return db.getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])?.value ?? null;
}

export async function kvSet(key: string, value: string) {
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

// SecureStore keys allow only [A-Za-z0-9._-].
const keyName = (providerId: string) => `apikey.${providerId.replace(/[^\w.-]/g, '_')}`;
export const getApiKey = (providerId: string) => SecureStore.getItemAsync(keyName(providerId));
export const setApiKey = (providerId: string, key: string) => (key ? SecureStore.setItemAsync(keyName(providerId), key) : SecureStore.deleteItemAsync(keyName(providerId)));
