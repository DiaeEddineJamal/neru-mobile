// Neru in English, French and Spanish. Strings are written in English in the code and wrapped in t(); each
// translation maps the English text to its own. A missing translation shows the English, so nothing is ever blank.
// Placeholders are {name}: t('Hid {n} secrets', { n: 2 }). `npm run check:i18n` lists strings still missing a
// translation.
import { I18nManager } from 'react-native';

import { kvGetSync } from '@/db';
import parts from '@/i18n/parts';

export type Lang = 'en' | 'fr' | 'es';
export type LanguageSetting = 'system' | Lang;
/** One part of the translations: English text to French and Spanish. */
export type Part = { fr: Record<string, string>; es: Record<string, string> };

export const languages: { value: LanguageSetting; label: string; description?: string }[] = [
  { value: 'system', label: 'System', description: 'Follows your phone' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
];

const dicts: Record<Exclude<Lang, 'en'>, Record<string, string>> = { fr: {}, es: {} };
for (const part of parts) for (const l of ['fr', 'es'] as const) Object.assign(dicts[l], part[l]);

/** The phone's own language, among the ones Neru speaks; anything else gets English. */
export function deviceLang(): Lang {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  if (locale.startsWith('fr')) return 'fr';
  if (locale.startsWith('es')) return 'es';
  return 'en';
}

const known = (setting: unknown): setting is Lang => setting === 'en' || setting === 'fr' || setting === 'es';
// Settings saved by older builds may name a language Neru no longer has; those follow the phone.
const resolve = (setting: LanguageSetting | undefined): Lang => (known(setting) ? setting : deviceLang());
let lang: Lang = resolve(JSON.parse(kvGetSync('settings') ?? '{}').language);

export const currentLang = () => lang;

/** Switches the language. Returns true when the layout direction changes, which needs a restart to apply. */
export function setLanguage(setting: LanguageSetting | undefined): boolean {
  lang = resolve(setting);
  return syncDirection();
}

/**
 * Every language Neru speaks is left to right. Builds that had Arabic could leave Android forced right to left;
 * this turns that off (true: a restart applies it) and is a no-op afterwards.
 */
export function syncDirection(): boolean {
  if (!I18nManager.isRTL) return false;
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
  return true;
}

/** `text` in the current language, with {placeholders} filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = lang === 'en' ? text : (dicts[lang][text] ?? text);
  return vars ? out.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole)) : out;
}

/** The speech recognizer locale that matches a language. */
export const voiceLocale = (l: Lang = lang) => ({ en: 'en-US', fr: 'fr-FR', es: 'es-ES' })[l];
