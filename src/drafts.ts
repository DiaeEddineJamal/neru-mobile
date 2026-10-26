import { useCallback, useSyncExternalStore } from 'react';

import { kvGetSync, kvSet, type Attachment } from '@/db';

type Draft = { text: string; attachments: Attachment[] };
const writes = new Map<string, Promise<void>>();
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const key = (target: string) => `composer.draft.${target}`;

function read(target: string): Draft {
  if (!drafts.has(target)) {
    let draft: Draft = { text: '', attachments: [] };
    try {
      const saved = JSON.parse(kvGetSync(key(target)) ?? 'null');
      if (typeof saved?.text === 'string' && Array.isArray(saved.attachments)) draft = saved;
    } catch { /* An interrupted old draft must not prevent opening a chat. */ }
    drafts.set(target, draft);
  }
  return drafts.get(target)!;
}

function write(target: string, draft: Draft) {
  drafts.set(target, draft);
  // Keep image bytes out of SQLite; the picker copies its file into the app cache.
  const saved = JSON.stringify({ ...draft, attachments: draft.attachments.map(({ base64: _bytes, ...a }) => a) });
  const pending = (writes.get(target) ?? Promise.resolve()).catch(() => {}).then(() => kvSet(key(target), saved));
  writes.set(target, pending);
  void pending.catch(() => {});
  listeners.forEach(listener => listener());
}

export function mergeAttachments(current: Attachment[], next: Attachment[]) {
  const seen = new Set(current.map(a => a.id));
  return [...current, ...next.filter(a => !seen.has(a.id))];
}

export const flushComposerDraft = (target: string) => writes.get(target) ?? Promise.resolve();
export const clearComposerDraft = (target: string) => write(target, { text: '', attachments: [] });

export function appendDraftPhotos(target: string, photos: Attachment[]) {
  if (photos.length) write(target, { ...read(target), attachments: mergeAttachments(read(target).attachments, photos) });
  return flushComposerDraft(target);
}

/** Drafts survive activity recreation while Android's camera or photo picker is open. */
export function useComposerDraft(target: string) {
  const draft = useSyncExternalStore(subscribe, () => read(target), () => read(target));
  const setText = useCallback((value: string | ((current: string) => string)) => {
    const current = read(target);
    write(target, { ...current, text: typeof value === 'function' ? value(current.text) : value });
  }, [target]);
  const setAttachments = useCallback((value: Attachment[] | ((current: Attachment[]) => Attachment[])) => {
    const current = read(target);
    write(target, { ...current, attachments: typeof value === 'function' ? value(current.attachments) : value });
  }, [target]);
  return { text: draft.text, attachments: draft.attachments, setText, setAttachments };
}
