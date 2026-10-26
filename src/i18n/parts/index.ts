// Every translation part. Each file covers one area of the app; see ../index.ts.
import type { Part } from '@/i18n';
import appShell from '@/i18n/parts/app-shell';
import screens from '@/i18n/parts/screens';
import mobileUx from '@/i18n/parts/mobile-ux';
import ui from '@/i18n/parts/ui';

const parts: Part[] = [screens, appShell, ui, mobileUx];
export default parts;
