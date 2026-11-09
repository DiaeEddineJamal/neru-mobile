// Projects: named workspaces with a goal, custom instructions and their own memory. Chats join one through
// chat.projectId. Kept in a `projects` table of the app's database and mirrored in memory for the UI.
import { openDatabaseSync } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import type { Chat } from '@/db';

export type Project = {
  id: string;
  name: string;
  /** "What are you trying to achieve?" */
  description: string;
  /** Custom instructions for every chat in the project. */
  instructions?: string;
  /** Project memory, synthesized from its chats and editable. */
  memory?: string;
  /** When the project memory was last written (by synthesis or by hand). */
  memoryUpdatedAt?: number;
  pinned?: boolean;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
};

const db = openDatabaseSync('neru.db');
db.execSync('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)');

const order = (a: Project, b: Project) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt;

let all: Project[] = (() => {
  try {
    return db.getAllSync<{ data: string }>('SELECT data FROM projects').map(r => JSON.parse(r.data) as Project).sort(order);
  } catch {
    return [];
  }
})();
let active = all.filter(p => !p.archived);
let archived = all.filter(p => p.archived);
const listeners = new Set<() => void>();

function commit(next: Project[]) {
  all = next.sort(order);
  active = all.filter(p => !p.archived);
  archived = all.filter(p => p.archived);
  listeners.forEach(l => l());
}

function persist(p: Project) {
  db.runSync('INSERT INTO projects (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', [p.id, JSON.stringify(p), p.updatedAt]);
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Projects, pinned first then most recently edited, live. Archived ones only with `{ archived: true }`. */
export function useProjects(o?: { archived?: boolean }): Project[] {
  return useSyncExternalStore(subscribe, () => (o?.archived ? archived : active));
}

/** One project, live; undefined once deleted. */
export function useProject(id: string | undefined): Project | undefined {
  return useSyncExternalStore(subscribe, () => getProject(id));
}

export function getProject(id: string | undefined): Project | undefined {
  return id ? all.find(p => p.id === id) : undefined;
}

export const allProjects = () => all;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function createProject(name: string, description = ''): Project {
  const now = Date.now();
  const p: Project = { id: newId(), name: name.trim(), description: description.trim(), createdAt: now, updatedAt: now };
  persist(p);
  commit([p, ...all]);
  return p;
}

/** Changes a project. `touch: false` keeps its "Edited" date (pinning, background memory updates). */
export function updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>, touch = true) {
  const old = getProject(id);
  if (!old) return;
  const p: Project = { ...old, ...patch, updatedAt: touch ? Date.now() : old.updatedAt };
  persist(p);
  commit(all.map(x => (x.id === id ? p : x)));
}

/** Deletes a project. Its chats stay, outside any project, once the caller moves them out. */
export function deleteProject(id: string) {
  db.runSync('DELETE FROM projects WHERE id = ?', [id]);
  commit(all.filter(p => p.id !== id));
}

export const setProjectPinned = (id: string, pinned: boolean) => updateProject(id, { pinned }, false);
export const setProjectArchived = (id: string, archived: boolean) => updateProject(id, { archived, pinned: archived ? false : getProject(id)?.pinned }, false);

/**
 * Text added to the system prompt for a chat inside a project: its name, goal and instructions. The project's
 * memory is added by memoryPrompt in src/memory.ts, which knows whether memory is on for the chat.
 */
export function projectPrompt(chat: Chat): string {
  const p = getProject(chat.projectId);
  if (!p) return '';
  const lines = [`This conversation is part of the user's project "${p.name}".`];
  if (p.description.trim()) lines.push(`What the project is about: ${p.description.trim()}`);
  if (p.instructions?.trim()) lines.push(`The user's instructions for every conversation in this project (follow them unless the current message asks otherwise):\n${p.instructions.trim()}`);
  return lines.join('\n');
}
