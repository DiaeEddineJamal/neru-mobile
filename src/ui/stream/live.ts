// The text of the reply that is streaming right now, kept outside the app store.
//
// Writing every delta into the store's `chats` woke every useStore subscriber (the drawer's chat list, ChatView,
// the notification watcher, the theme hooks...) several times a second. Deltas land here instead, and only the
// streaming message row subscribes. The store gets the text when the reply ends (and on tool steps).
// A frame loop paces what the row shows (see reveal.ts), so text flows instead of arriving in bursts.
import { useSyncExternalStore } from 'react';

import { createReveal, type Reveal } from '@/ui/stream/reveal';
import { perf } from '@/ui/stream/perf';

export type LiveView = { messageId: string; text: string; reasoning: string };

type Live = {
  messageId: string;
  text: string;
  reasoning: string;
  reveal: Reveal;
  view: LiveView;
  /** Shortest time between two screen updates: the processor is shared with an on-device model. */
  minFrameMs: number;
  last: number;
  raf: number | null;
  finished: boolean;
};

let live: Live | null = null;
const listeners = new Set<() => void>();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const raf: (cb: (t: number) => void) => number = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(() => cb(now()), 16) as unknown as number;
const cancelRaf: (id: number) => void = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : id => clearTimeout(id);

/** Cuts at `n` characters without splitting a surrogate pair (an emoji). */
function cut(text: string, n: number) {
  if (n >= text.length) return text;
  const code = text.charCodeAt(n - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? n + 1 : n);
}

function frame(t: number) {
  const l = live;
  if (!l) return;
  l.raf = null;
  const dt = t - l.last;
  if (dt < l.minFrameMs - 2) return void (l.raf = raf(frame));
  l.last = t;
  const n = l.reveal.tick(Math.min(dt, 100));
  const text = cut(l.text, n);
  if (text !== l.view.text || l.reasoning !== l.view.reasoning) {
    l.view = { messageId: l.messageId, text, reasoning: l.reasoning };
    if (__DEV__ && perf.on) perf.notifications++;
    listeners.forEach(fn => fn());
  }
  // Caught up: sleep until the next push wakes the loop.
  if (text.length < l.text.length) l.raf = raf(frame);
  else if (l.finished) liveEnd(); // drained after the reply ended
}

function wake() {
  if (live && live.raf === null) {
    live.last = Math.max(live.last, now() - live.minFrameMs);
    live.raf = raf(frame);
  }
}

/** A reply starts streaming into `messageId`. `local`: an on-device model shares the processor, so update at ~30 fps. */
export function liveStart(messageId: string, local: boolean) {
  liveEnd();
  live = { messageId, text: '', reasoning: '', reveal: createReveal(), view: { messageId, text: '', reasoning: '' }, minFrameMs: local ? 33 : 16, last: now(), raf: null, finished: false };
  if (__DEV__ && perf.on) perf.start();
  listeners.forEach(fn => fn());
}

/** The reply's full text so far. Cheap: no React work happens until the next frame. */
export function livePush(messageId: string, text: string, reasoning: string) {
  const l = live;
  if (!l || l.messageId !== messageId) return;
  if (text !== l.text) {
    l.text = text;
    l.reveal.push(text.length, now());
  }
  l.reasoning = reasoning;
  wake();
}

/**
 * The reply ended (finished, stopped or failed) and the store holds its text. The row keeps showing the paced text
 * for the few frames it needs to catch up, then reads the store.
 */
export function liveFinish(messageId: string) {
  const l = live;
  if (!l || l.messageId !== messageId) return;
  l.finished = true;
  l.reveal.finish();
  if (l.view.text === l.text) liveEnd();
  else wake();
}

/** Drops the live reply at once. */
export function liveEnd() {
  if (!live) return;
  if (live.raf !== null) cancelRaf(live.raf);
  live = null;
  if (__DEV__ && perf.on) perf.report();
  listeners.forEach(fn => fn());
}

const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

/** What the streaming row shows for `messageId`, or null when that message is not streaming. */
export function useLiveReply(messageId: string, active: boolean): LiveView | null {
  return useSyncExternalStore(active ? subscribe : noSubscribe, () => (active && live?.messageId === messageId ? live.view : null));
}
const noSubscribe = () => () => {};
