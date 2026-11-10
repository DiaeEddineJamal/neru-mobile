import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, useFonts } from '@expo-google-fonts/dm-sans';
import { SourceSerif4_600SemiBold, SourceSerif4_700Bold } from '@expo-google-fonts/source-serif-4';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { followThemeIcon } from '@/app-icon';
import { FigureHost } from '@/artifacts/FigureHost';
import { IconButton } from '@/components/Icon';
import { startMcp } from '@/mcp/store';
import { startNotifications } from '@/notify';
import { restorePairing, wakeRemote } from '@/remote/store';
import { syncDirection, t } from '@/i18n';
import { getState, useStore } from '@/store';
import { font, useColors, useScheme } from '@/theme';
import { DialogHost } from '@/ui/confirm';
import { ToastProvider } from '@/ui/toast';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useScheme();
  const c = useColors();
  const language = useStore(s => s.settings.language ?? 'system');
  const [loaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, SourceSerif4_600SemiBold, SourceSerif4_700Bold, JetBrainsMono_400Regular });

  useEffect(() => {
    syncDirection();
    void restorePairing();
    const stopNotify = startNotifications();
    const stopMcp = startMcp();
    const stopIcon = followThemeIcon();
    // Phones drop sockets in the background; reconnect as soon as Neru is back on screen.
    const sub = AppState.addEventListener('change', s => s === 'active' && wakeRemote());
    return () => (stopNotify(), stopMcp(), stopIcon(), sub.remove());
  }, []);

  // The window behind every screen: shows during page transitions and keyboard resizes, so it must never be white
  // in dark mode.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg);
  }, [c.bg]);

  useEffect(() => {
    if (!loaded) return;
    SplashScreen.hideAsync();
    const { settings, keyed } = getState();
    if (!settings.onboarded && keyed.length === 0) router.replace('/onboarding');
  }, [loaded]);
  if (!loaded) return null;

  const base = scheme === 'light' ? DefaultTheme : DarkTheme;
  const theme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.border, primary: c.moss } };
  // Full-screen pages, as in Claude's app: they slide in from the right over everything (the open sidebar included),
  // with a back arrow and a centered bold serif title.
  // Not 'slide_from_right': on Android that pushes the screen underneath fully off to the left (rns_slide_out_to_left,
  // -100%), so the open sidebar visibly slid away under every page and slid back on return. 'ios_from_right' brings
  // the page in over a short, eased slide while the screen underneath only drifts back a little.
  const modal = {
    presentation: 'card' as const,
    animation: 'ios_from_right' as const,
    headerShown: true,
    headerShadowVisible: false,
    headerTitleAlign: 'center' as const,
    headerStyle: { backgroundColor: c.bg },
    headerTitleStyle: { fontFamily: font.title, fontSize: 24, color: c.text },
    headerTintColor: c.text,
    headerBackButtonDisplayMode: 'minimal' as const,
    headerLeft: () => <IconButton name="back" label={t('Back')} color={c.text} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ marginLeft: -8 }} />,
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardProvider>
      <ThemeProvider value={theme}>
        <ToastProvider>
          <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
          <Stack key={language} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
            <Stack.Screen name="(drawer)" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="settings" options={{ ...modal, title: t('Settings') }} />
            <Stack.Screen name="providers" options={{ ...modal, title: t('Providers and keys') }} />
            <Stack.Screen name="models" options={{ ...modal, title: 'Pocket Lab' }} />
            <Stack.Screen name="magic-touch" options={{ ...modal, title: t('Magic Touch') }} />
            <Stack.Screen name="pair" options={{ ...modal, title: t('Pair a desktop') }} />
            <Stack.Screen name="team-new" options={{ ...modal, title: t('New team task') }} />
            <Stack.Screen name="task-new" options={{ ...modal, title: t('New desktop task') }} />
            <Stack.Screen name="tasks" options={{ ...modal, title: t('Desktop tasks') }} />
            <Stack.Screen name="digest" options={{ ...modal, title: t('While you were away') }} />
            <Stack.Screen name="connectors" options={{ ...modal, title: t('Connectors') }} />
            <Stack.Screen name="mcp-auth" options={{ headerShown: false, animation: 'none' }} />
            <Stack.Screen name="diff/[session]/[event]" options={{ ...modal, title: t('Changes') }} />
            <Stack.Screen name="changelog" options={{ ...modal, title: t("What's new") }} />
            <Stack.Screen name="profile" options={{ ...modal, title: t('Profile') }} />
            <Stack.Screen name="memory" options={{ ...modal, title: t('Memory') }} />
            <Stack.Screen name="usage" options={{ ...modal, title: t('Usage') }} />
            <Stack.Screen name="notifications" options={{ ...modal, title: t('Notifications') }} />
            <Stack.Screen name="artifacts" options={{ ...modal, title: t('Artifacts') }} />
            <Stack.Screen name="artifact/[id]" options={{ ...modal, title: t('Artifact') }} />
            <Stack.Screen name="projects" options={{ ...modal, title: t('Projects') }} />
            <Stack.Screen name="project/[id]" options={{ ...modal, title: t('Project') }} />
            <Stack.Screen name="connectors-browse" options={{ ...modal, title: t('Browse connectors') }} />
            <Stack.Screen name="skills" options={{ ...modal, title: t('Skills') }} />
          </Stack>
          <DialogHost />
          <FigureHost />
        </ToastProvider>
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
