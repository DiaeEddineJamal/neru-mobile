// The launcher icon follows the accent theme (Android). The switch waits until Neru leaves the screen: some launchers
// close an app whose launcher entry changes while it is open, and the icon is only seen from the home screen anyway.
import { requireOptionalNativeModule } from 'expo';
import { AppState } from 'react-native';

import { getState } from '@/store';
import { palettes } from '@/theme';

const native = requireOptionalNativeModule<{ setIcon(theme: string, themes: string[]): boolean }>('NeruAppIcon');

/** Keeps the icon in step with the theme; returns a stop function. */
export function followThemeIcon() {
  if (!native) return () => {};
  const sub = AppState.addEventListener('change', state => {
    if (state !== 'background') return;
    try { native.setIcon(getState().settings.palette ?? 'moss', palettes.map(p => p.id)); } catch {}
  });
  return () => sub.remove();
}
