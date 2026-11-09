// Every translation part. Each file covers one area of the app; see ../index.ts. Run `npm run check:i18n` after
// adding strings.
import type { Part } from '@/i18n';
import chat from '@/i18n/parts/chat';
import desktop from '@/i18n/parts/desktop';
import shell from '@/i18n/parts/shell';
import models from '@/i18n/parts/models';
import settings from '@/i18n/parts/settings';
import connectors from '@/i18n/parts/connectors';
import greetings from '@/i18n/parts/greetings';

const parts: Part[] = [chat, desktop, shell, models, settings, connectors, greetings];
export default parts;
