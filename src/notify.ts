// Tells you when a desktop session starts waiting on your approval while Neru is in the background.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { getRemote, subscribeRemote } from '@/remote/store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

// ponytail: local notifications only, so they fire while Android keeps the app's connection alive
// in the background (minutes, not hours). Push through a relay would cover a killed app.
export function startApprovalNotifications() {
  let waiting = new Set(getRemote().sessions.filter(s => s.waiting).map(s => s.id));
  let asked = false;

  const unsubscribe = subscribeRemote(() => {
    const now = getRemote().sessions.filter(s => s.waiting);
    const fresh = now.filter(s => !waiting.has(s.id));
    waiting = new Set(now.map(s => s.id));
    if (!fresh.length || AppState.currentState === 'active') return;
    void (async () => {
      if (!asked) {
        asked = true;
        const { granted } = await Notifications.requestPermissionsAsync();
        if (!granted) return;
      }
      for (const s of fresh)
        await Notifications.scheduleNotificationAsync({
          content: { title: 'Neru needs your approval', body: `${s.title} · ${s.project}`, data: { sessionId: s.id } },
          trigger: null,
        });
    })();
  });

  const tap = Notifications.addNotificationResponseReceivedListener(r => {
    const id = r.notification.request.content.data?.sessionId;
    if (typeof id === 'string') router.push(`/desktop/${id}`);
  });

  return () => (unsubscribe(), tap.remove());
}
