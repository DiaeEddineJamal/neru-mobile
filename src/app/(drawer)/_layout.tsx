import { router } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';

import { AppTour, type DrawerControl } from '@/components/AppTour';
import { DrawerContent } from '@/components/DrawerContent';
import { IconButton } from '@/components/Icon';
import { ModelButton } from '@/components/ModelButton';
import { ModelSheet } from '@/components/ModelSheet';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { WhatsNew } from '@/components/WhatsNew';
import { font, useColors } from '@/theme';
import { TourTarget } from '@/ui/tour';

export default function DrawerLayout() {
  const c = useColors();
  const { width } = useWindowDimensions();
  // The drawer navigator's own controls, for the walkthrough's steps inside the drawer.
  const nav = useRef<{ openDrawer: () => void; closeDrawer: () => void } | null>(null);
  const [drawer] = useState<DrawerControl>(() => ({ open: () => nav.current?.openDrawer(), close: () => nav.current?.closeDrawer() }));
  return (
    <>
    <Drawer
      drawerContent={props => { nav.current = props.navigation; return <DrawerContent close={() => props.navigation.closeDrawer()} />; }}
      screenOptions={({ navigation }) => ({
        drawerType: 'slide',
        // A swipe open closes the keyboard too, like the menu button.
        keyboardDismissMode: 'on-drag',
        drawerStyle: { width: Math.min(width * 0.85, 360), backgroundColor: c.surface },
        overlayColor: 'rgba(0,0,0,0.35)',
        // Android's back gesture owns the outer ~30dp; a wider zone lets a swipe from just inside it open the drawer.
        swipeEdgeWidth: 110,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: c.bg },
        headerTitleAlign: 'center',
        headerTitleStyle: { fontFamily: font.semibold, color: c.text },
        headerLeft: () => <TourTarget name="menu" style={{ marginLeft: 4 }}><IconButton name="menu" label="Open chats" color={c.text} onPress={() => (Keyboard.dismiss(), navigation.openDrawer())} /></TourTarget>,
        headerRight: () => <TourTarget name="compose" style={{ marginRight: 4 }}><IconButton name="compose" label="New chat" color={c.text} onPress={() => (Keyboard.dismiss(), router.navigate('/'))} /></TourTarget>,
        headerTitle: () => <TourTarget name="model"><ModelButton /></TourTarget>,
        sceneStyle: { backgroundColor: c.bg },
      })}
    />
    <ModelSheet />
    <WhatsNew />
    <UpdatePrompt />
    <AppTour drawer={drawer} />
    </>
  );
}
