// The width of the chat header's right-hand buttons (model badge, new chat), measured on layout. A centered title has
// the same room on each side of the screen's middle, so it can be at most the screen width minus twice this, or it
// slides under the buttons.
import { useSyncExternalStore } from 'react';

let width = 0;
const listeners = new Set<() => void>();

export function setHeaderRightWidth(w: number) {
  const next = Math.ceil(w);
  if (next === width) return;
  width = next;
  listeners.forEach(l => l());
}

/** The measured width, or a close estimate before the first layout. */
export const useHeaderRightWidth = () => useSyncExternalStore(l => (listeners.add(l), () => void listeners.delete(l)), () => width || 116);
