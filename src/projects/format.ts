// Dates on the Projects and Memory pages, in the interface language.
import { currentLang, t } from '@/i18n';

const locale = () => ({ en: 'en-US', fr: 'fr-FR', es: 'es-ES' })[currentLang()];

/** "Oct 16, 2026". */
export const formatDay = (ms: number) => new Date(ms).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' });

/** "Edited Oct 16, 2026". */
export const editedLabel = (ms: number) => t('Edited {date}', { date: formatDay(ms) });

/** "Oct 16, 2026, 14:05", or "Never". */
export const formatWhen = (ms: number) => (ms ? new Date(ms).toLocaleString(locale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('Never'));
