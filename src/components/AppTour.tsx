// The first-run walkthrough of the phone app, the counterpart of the desktop's APP_TOUR. It starts on the home
// screen once onboarding is done (or when Settings → Take the tour asks for it), and never twice on its own.
import { usePathname } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { appVersion } from '@/components/WhatsNew';
import { updateSettings, useStore } from '@/store';
import { Tour, type TourStep } from '@/ui/tour';

export type DrawerControl = { open: () => void; close: () => void };

export function AppTour({ drawer }: { drawer: DrawerControl }) {
  const pending = useStore(s => s.settings.tour === 'pending' && s.settings.onboarded && s.settings.seenVersion === appVersion);
  const home = usePathname() === '/';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pending || !home || open) return;
    // Started from Settings, the drawer is still open under it; the tour begins on the home screen itself.
    drawer.close();
    const timer = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(timer);
  }, [pending, home, open, drawer]);

  const steps = useMemo<TourStep[]>(() => [
    { title: 'Welcome to Neru', body: 'A one-minute look around, one control at a time. Skip whenever you like; it lives in Settings for later.' },
    { target: 'model', title: 'Pick a model', body: 'Free cloud models on your own keys, or Pocket Lab models that run offline on this phone. When one runs out, Neru moves to the next.' },
    { target: 'prompt', title: 'The message box', body: 'Ask anything. Long-press a message to copy, edit or hear it read aloud; the pencil at the top starts a new chat.' },
    { target: 'attach', title: 'Attach anything', body: 'Take a photo, pick from your gallery, or add PDFs and documents for Neru to read.' },
    { target: 'mic', title: 'Dictation', body: 'Speak instead of typing. The stripes move with your voice; tap again when you’re done.' },
    { target: 'menu', title: 'Your chats', body: 'Tap here or swipe from the left edge. Starred chats sit on top; swipe a chat to star, rename or delete it.', enter: drawer.close },
    { target: 'drawer-tabs', title: 'Chats and Desktop', body: 'Pair with Neru on your computer to follow Code sessions, approve changes and message your Team from anywhere.', enter: drawer.open },
    { target: 'settings', title: 'Settings', body: 'Your name, Pocket Lab, providers and keys, light and dark Themes, notifications and haptics.', enter: drawer.open },
    { title: 'You’re all set', body: 'Say hello whenever you’re ready. Neru learns your name and keeps your keys on this phone.', enter: drawer.close },
  ], [drawer]);

  if (!open) return null;
  return <Tour steps={steps} onClose={() => { drawer.close(); setOpen(false); updateSettings({ tour: 'done' }); }} />;
}
