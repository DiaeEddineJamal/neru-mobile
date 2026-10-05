import { router } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';

import { DrawerContent } from '@/components/DrawerContent';
import { IconButton } from '@/components/Icon';
import { ModelButton } from '@/components/ModelButton';
import { ModelSheet } from '@/components/ModelSheet';
import { WhatsNew } from '@/components/WhatsNew';
import { font, useColors } from '@/theme';

export default function DrawerLayout() {
  const c = useColors();
  const { width } = useWindowDimensions();
  return (
    <>
    <Drawer
      drawerContent={props => <DrawerContent close={() => props.navigation.closeDrawer()} />}
      screenOptions={({ navigation }) => ({
        drawerType: 'slide',
        drawerStyle: { width: Math.min(width * 0.85, 360), backgroundColor: c.surface },
        overlayColor: 'rgba(0,0,0,0.35)',
        // Android's back gesture owns the outer ~30dp; a wider zone lets a swipe from just inside it open the drawer.
        swipeEdgeWidth: 110,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: c.bg },
        headerTitleAlign: 'center',
        headerTitleStyle: { fontFamily: font.semibold, color: c.text },
        headerLeft: () => <IconButton name="menu" label="Open chats" color={c.text} onPress={() => navigation.openDrawer()} style={{ marginLeft: 4 }} />,
        headerRight: () => <IconButton name="compose" label="New chat" color={c.text} onPress={() => router.navigate('/')} style={{ marginRight: 4 }} />,
        headerTitle: () => <ModelButton />,
        sceneStyle: { backgroundColor: c.bg },
      })}
    />
    <ModelSheet />
    <WhatsNew />
    </>
  );
}
