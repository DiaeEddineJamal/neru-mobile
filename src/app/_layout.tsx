import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { startApprovalNotifications } from '@/notify';
import { restorePairing, wakeRemote } from '@/remote/store';
import { getState } from '@/store';
import { font, useColors, useScheme } from '@/theme';
import { ToastProvider } from '@/ui/toast';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useScheme();
  const c = useColors();
  const [loaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, InstrumentSerif_400Regular, JetBrainsMono_400Regular });

  useEffect(() => {
    void restorePairing();
    const stopNotify = startApprovalNotifications();
    // Phones drop sockets in the background; reconnect as soon as Neru is back on screen.
    const sub = AppState.addEventListener('change', s => s === 'active' && wakeRemote());
    return () => (stopNotify(), sub.remove());
  }, []);

  useEffect(() => {
    if (!loaded) return;
    SplashScreen.hideAsync();
    const { settings, keyed } = getState();
    if (!settings.onboarded && keyed.length === 0) router.replace('/onboarding');
  }, [loaded]);
  if (!loaded) return null;

  const base = scheme === 'light' ? DefaultTheme : DarkTheme;
  const theme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.border, primary: c.moss } };
  const modal = { presentation: 'modal' as const, headerShown: true, headerShadowVisible: false, headerTitleStyle: { fontFamily: font.semibold, color: c.text }, headerTintColor: c.text };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardProvider>
      <ThemeProvider value={theme}>
        <ToastProvider>
          <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
            <Stack.Screen name="(drawer)" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="settings" options={{ ...modal, title: 'Settings' }} />
            <Stack.Screen name="providers" options={{ ...modal, title: 'Providers and keys' }} />
            <Stack.Screen name="models" options={{ ...modal, title: 'Pocket Lab' }} />
            <Stack.Screen name="magic-touch" options={{ ...modal, title: 'Magic Touch' }} />
            <Stack.Screen name="pair" options={{ ...modal, title: 'Pair a desktop' }} />
            <Stack.Screen name="team-new" options={{ ...modal, title: 'New team task' }} />
            <Stack.Screen name="diff/[session]/[event]" options={{ ...modal, title: 'Changes' }} />
            <Stack.Screen name="changelog" options={{ ...modal, title: "What's new" }} />
          </Stack>
        </ToastProvider>
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
