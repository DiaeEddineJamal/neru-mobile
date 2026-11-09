// The launcher icon and the system splash follow the accent theme (Android). The icon switch waits until Neru leaves
// the screen: some launchers close an app whose launcher entry changes while it is open, and the icon is only seen
// from the home screen anyway. The splash is set as soon as the theme changes (it shows on the next cold start).
import { requireOptionalNativeModule } from 'expo';
import { AppState } from 'react-native';

import { getState, subscribe } from '@/store';
import { palettes } from '@/theme';

const native = requireOptionalNativeModule<{ setIcon(theme: string, themes: string[]): boolean; setSplash?(theme: string): boolean }>('NeruAppIcon');

const current = () => getState().settings.palette ?? 'moss';

/** Keeps the icon and splash in step with the theme; returns a stop function. */
export function followThemeIcon() {
  if (!native) return () => {};
  let splash = '';
  const syncSplash = () => {
    const theme = current();
    if (theme === splash) return;
    // Remembered only once it took (no activity yet, or Android < 12, returns false; the next store change retries).
    try { if (native.setSplash?.(theme)) splash = theme; } catch {}
  };
  syncSplash();
  const stopStore = subscribe(syncSplash);
  const sub = AppState.addEventListener('change', state => {
    if (state !== 'background') return;
    try { native.setIcon(current(), palettes.map(p => p.id)); } catch {}
  });
  return () => (stopStore(), sub.remove());
}
