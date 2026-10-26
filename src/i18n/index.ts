// Neru in English, French, Arabic and Moroccan Darija. Strings are written in English in the code and wrapped in
// t(); each translation maps the English text to its own. A missing translation shows the English, so nothing is
// ever blank. Placeholders are {name}: t('Hid {n} secrets', { n: 2 }). Arabic and Darija lay the app out
// right to left, which Android applies on the next launch.
import { I18nManager } from 'react-native';

import { kvGetSync } from '@/db';
import parts from '@/i18n/parts';

export type Lang = 'en' | 'fr' | 'ar' | 'ary';
export type LanguageSetting = 'system' | Lang;
/** One part of the translations: English text to French, Arabic and Darija. */
export type Part = { fr: Record<string, string>; ar: Record<string, string>; ary: Record<string, string> };

export const languages: { value: LanguageSetting; label: string; description?: string }[] = [
  { value: 'system', label: 'System', description: 'Follows your phone' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'ar', label: 'العربية' },
  { value: 'ary', label: 'الدارجة المغربية', description: 'Darija' },
];

const dicts: Record<Exclude<Lang, 'en'>, Record<string, string>> = { fr: {}, ar: {}, ary: {} };
for (const part of parts) for (const lang of ['fr', 'ar', 'ary'] as const) Object.assign(dicts[lang], part[lang]);

/** The phone's own language, among the ones Neru speaks. Moroccan Arabic phones get Darija. */
export function deviceLang(): Lang {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  if (locale.startsWith('fr')) return 'fr';
  if (locale.startsWith('ar-ma') || locale.startsWith('ary')) return 'ary';
  if (locale.startsWith('ar')) return 'ar';
  return 'en';
}

const resolve = (setting: LanguageSetting | undefined): Lang => (!setting || setting === 'system' ? deviceLang() : setting);
let lang: Lang = resolve(JSON.parse(kvGetSync('settings') ?? '{}').language);

export const currentLang = () => lang;
export const isRTL = (l: Lang = lang) => l === 'ar' || l === 'ary';

/** Switches the language. Returns true when the layout direction changes, which needs a restart to apply. */
export function setLanguage(setting: LanguageSetting | undefined): boolean {
  lang = resolve(setting);
  return syncDirection();
}

/** Asks Android for the layout direction of the current language; true when it differs from the running one. */
export function syncDirection(): boolean {
  const rtl = isRTL();
  I18nManager.allowRTL(rtl);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}

/** `text` in the current language, with {placeholders} filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = lang === 'en' ? text : (dicts[lang][text] ?? text);
  return vars ? out.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole)) : out;
}

/** The speech recognizer locale that matches a language. */
export const voiceLocale = (l: Lang = lang) => ({ en: 'en-US', fr: 'fr-FR', ar: 'ar-SA', ary: 'ar-MA' })[l];
