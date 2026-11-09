import { useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '@/store';

// Same token names and values as app/src/index.css, so desktop and mobile read as one product.
// Dark mode is a neutral near-black with a secondary dark-gray card, as in Claude's apps; the accent theme colors
// only accents (switches, sliders, selection, highlighted cards), never the background.
const dark = {
  bg: '#151515',
  surface: '#151515',
  prompt: '#222221',
  surface2: '#1f1f1e',
  surface3: '#2a2a29',
  text: '#f5f4ef',
  secondary: '#b0afa8',
  muted: '#8d8c86',
  border: '#2f2f2d',
  moss: '#64806a',
  mossAction: '#486b51',
  sage: '#8ea291',
  mossDeep: '#344a39',
  danger: '#bd7770',
  bubble: '#2a2a29',
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

// Open-licensed (OFL) stand-ins for the look in the reference: a bold geometric sans for the interface (DM Sans)
// and a bookish serif for page titles and greetings (Source Serif 4).
export const font = {
  sans: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
  serif: 'SourceSerif4_600SemiBold',
  /** Centered page titles ("Settings", "Connectors"). */
  title: 'SourceSerif4_700Bold',
  mono: 'JetBrainsMono_400Regular',
};

// Desktop --fs-* scale, nudged up for phone reading distance. Text still follows the OS font scale.
export const fs = { xs: 12, sm: 14, base: 16, md: 17, lg: 20, xl: 24, display: 34 };

/** Room between the screen's bottom edge and the last control (composer, drawer footer), as in Claude:
 * clear of the gesture bar instead of sitting on it. */
export const BOTTOM_GAP = 12;
export function useBottomPad() {
  return useSafeAreaInsets().bottom + BOTTOM_GAP;
}

// 48dp minimum touch target (Material 3; Apple HIG asks for 44pt).
export const TAP = 48;

type Tint = Pick<Colors, 'bg' | 'surface' | 'prompt' | 'surface2' | 'surface3' | 'border' | 'moss' | 'mossAction' | 'sage' | 'mossDeep' | 'bubble' | 'bubbleText'>;
type Palette = { id: string; name: string; note: string; dark: Partial<Tint>; light: Partial<Tint> };

/**
 * Accent themes from the soft-autumn palette that sits around moss green: each swaps the accent; in light mode
 * the neutrals also take a faint matching cast, while dark mode keeps one neutral near-black for every theme. Text, links, code and danger stay shared so every theme reads
 * the same. Action fills keep at least 4.5:1 against `onAction`.
 */
export const palettes: Palette[] = [
  { id: 'moss', name: 'Moss', note: 'The original. Forest floor after rain', dark: {}, light: {} },
  {
    id: 'glacier', name: 'Glacier', note: 'Muted aqua and cool stone',
    dark: { moss: '#6f9aa5', mossAction: '#3f6f7a', sage: '#9cbcc4', mossDeep: '#22393f' },
    light: { bg: '#f2f5f4', surface: '#f8faf9', surface3: '#e6ecec', border: '#d6dfdf', moss: '#3f6f7a', mossAction: '#3f6f7a', sage: '#5e8a93', mossDeep: '#dcebee', bubble: '#d9e9ec', bubbleText: '#13262b' },
  },
  {
    id: 'heather', name: 'Heather', note: 'Lilac blush on a hillside',
    dark: { moss: '#b48aa6', mossAction: '#85566f', sage: '#d1b3c7', mossDeep: '#3d2a37' },
    light: { bg: '#f7f2f4', surface: '#fbf8f9', surface3: '#efe6ea', border: '#e3d6dc', moss: '#85566f', mossAction: '#85566f', sage: '#a7768f', mossDeep: '#f1e1ea', bubble: '#efdde7', bubbleText: '#2a1622' },
  },
  {
    id: 'terracotta', name: 'Terracotta', note: 'Sunbaked clay and warm cream',
    dark: { moss: '#c98a72', mossAction: '#9a5440', sage: '#dcae9b', mossDeep: '#42291f' },
    light: { bg: '#f7f2ed', surface: '#fbf8f4', surface3: '#efe6de', border: '#e2d6cb', moss: '#9a5440', mossAction: '#9a5440', sage: '#b5705a', mossDeep: '#f2e0d6', bubble: '#f0ddd2', bubbleText: '#2b170f' },
  },
  {
    id: 'saffron', name: 'Saffron', note: 'Mustard fields at golden hour',
    dark: { moss: '#d1ad62', mossAction: '#80651f', sage: '#e0c88f', mossDeep: '#3d3317' },
    light: { bg: '#f7f4ea', surface: '#fbf9f2', surface3: '#eee9da', border: '#e0d9c4', moss: '#80651f', mossAction: '#80651f', sage: '#a78a3f', mossDeep: '#f1e7c9', bubble: '#efe5c6', bubbleText: '#2a2210' },
  },
  {
    id: 'tidepool', name: 'Tidepool', note: 'Sea glass and pine',
    dark: { moss: '#5fa595', mossAction: '#2f6f66', sage: '#8fc2b5', mossDeep: '#1d3b36' },
    light: { bg: '#f1f5f3', surface: '#f8faf9', surface3: '#e4ece9', border: '#d3dfdb', moss: '#2f6f66', mossAction: '#2f6f66', sage: '#4f8a80', mossDeep: '#d8ebe6', bubble: '#d6e9e3', bubbleText: '#10241f' },
  },
  {
    id: 'twilight', name: 'Twilight', note: 'Periwinkle over a navy sky',
    dark: { moss: '#8e9ec0', mossAction: '#4a5d86', sage: '#b4c0da', mossDeep: '#262e44' },
    light: { bg: '#f3f4f7', surface: '#f9f9fb', surface3: '#e7e9ef', border: '#d8dbe4', moss: '#3e5470', mossAction: '#3e5470', sage: '#5f7196', mossDeep: '#dfe4f0', bubble: '#dde3f0', bubbleText: '#141b2b' },
  },
];

/** A theme's colors in one mode, for previews as well as the app itself. */
const built = new Map<string, Colors>();
export function paletteColors(id: string | undefined, scheme: 'light' | 'dark'): Colors {
  const p = palettes.find(x => x.id === id) ?? palettes[0];
  const key = `${p.id}/${scheme}`;
  // One object per theme and mode, so screens that depend on the colors don't redo work every render.
  if (!built.has(key)) built.set(key, scheme === 'light' ? { ...light, ...p.light } : { ...dark, ...p.dark });
  return built.get(key)!;
}

/** 'light' or 'dark' after applying the Appearance setting over the system scheme. */
export function useScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const pref = useStore(s => s.settings.theme);
  return pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
}

export function useColors(): Colors {
  const scheme = useScheme();
  const palette = useStore(s => s.settings.palette);
  return paletteColors(palette, scheme);
}
