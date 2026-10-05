import { useColorScheme } from 'react-native';

import { useStore } from '@/store';

// Same token names and values as app/src/index.css, so desktop and mobile read as one product.
const dark = {
  bg: '#151515',
  surface: '#151515',
  prompt: '#20201F',
  surface2: '#1b1d19',
  surface3: '#242622',
  text: '#f2f0e9',
  secondary: '#b3b3aa',
  muted: '#8c9088',
  border: '#30322d',
  moss: '#64806a',
  mossAction: '#486b51',
  sage: '#8ea291',
  mossDeep: '#344a39',
  danger: '#bd7770',
  bubble: '#30302e',
  bubbleText: '#f0eee6',
  codeChip: '#e5866f',
  codeChipBg: 'rgba(229,134,111,0.13)',
  link: '#8cb4f5',
  onAction: '#f5f4ef',
};

export type Colors = typeof dark;

const light: Colors = {
  bg: '#f5f4ef',
  surface: '#faf9f5',
  prompt: '#ffffff',
  surface2: '#ffffff',
  surface3: '#eeeee9',
  text: '#191a18',
  secondary: '#676a64',
  muted: '#5e665d',
  border: '#dddcd5',
  moss: '#54745b',
  mossAction: '#54745b',
  sage: '#64806a',
  mossDeep: '#dfe9df',
  danger: '#a25750',
  bubble: '#dfe9d9',
  bubbleText: '#16231a',
  codeChip: '#b4432f',
  codeChipBg: 'rgba(180,67,47,0.09)',
  link: '#2a62c4',
  onAction: '#f5f4ef',
};

export const font = {
  sans: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  serif: 'InstrumentSerif_400Regular',
  mono: 'JetBrainsMono_400Regular',
};

// Desktop --fs-* scale, nudged up for phone reading distance. Text still follows the OS font scale.
export const fs = { xs: 12, sm: 14, base: 16, md: 17, lg: 20, xl: 24, display: 34 };

// 48dp minimum touch target (Material 3; Apple HIG asks for 44pt).
export const TAP = 48;

/** 'light' or 'dark' after applying the Appearance setting over the system scheme. */
export function useScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const pref = useStore(s => s.settings.theme);
  return pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
}

export function useColors(): Colors {
  return useScheme() === 'light' ? light : dark;
}
