import { useLocalSearchParams } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useState } from 'react';
import { Pressable, Text, useWindowDimensions } from 'react-native';

import { ChatView } from '@/components/ChatView';
import { ChatSheet } from '@/components/DrawerContent';
import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { useStore } from '@/store';
import { font, fs, useColors } from '@/theme';

/** The chat's title in the header; a tap opens rename, pin and delete. */
function TitleButton({ title, incognito, onPress }: { title: string; incognito: boolean; onPress: () => void }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  return (
    <Pressable
      onPress={() => (haptic.light(), onPress())}
      accessibilityRole="button"
      accessibilityLabel={t('{title}. Chat options', { title })}
      hitSlop={6}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: width - 200, minHeight: 40, opacity: pressed ? 0.6 : 1 })}
    >
      {incognito ? <Icon name="ghost" size={16} color={c.secondary} /> : null}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{title}</Text>
      <Icon name="chevronDown" size={16} color={c.muted} />
    </Pressable>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useStore(s => s.chats.find(ch => ch.id === id));
  const [options, setOptions] = useState(false);
  return (
    <>
      <Drawer.Screen options={{ headerTitle: () => (chat ? <TitleButton title={chat.title} incognito={!!chat.incognito} onPress={() => setOptions(true)} /> : null) }} />
      <ChatView key={id} chatId={id} />
      <ChatSheet chat={options ? chat ?? null : null} mode="options" onClose={() => setOptions(false)} />
    </>
  );
}
