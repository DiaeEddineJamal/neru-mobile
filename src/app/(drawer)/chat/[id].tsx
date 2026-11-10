import { useLocalSearchParams } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';

import { ChatView } from '@/components/ChatView';
import { ChatSheet } from '@/components/DrawerContent';
import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { useStore } from '@/store';
import { font, fs, useColors } from '@/theme';
import { useHeaderRightWidth } from '@/ui/header-width';

/** The chat's title in the header; a tap opens rename, pin and delete. */
function TitleButton({ title, incognito, onPress }: { title: string; incognito: boolean; onPress: () => void }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  // Centered, so it gets the same room on both sides of the middle: the right-hand buttons are the wider side.
  const side = Math.max(useHeaderRightWidth(), 56) + 8;
  return (
    <Pressable
      onPress={() => (haptic.light(), onPress())}
      accessibilityRole="button"
      accessibilityLabel={t('{title}. Chat options', { title })}
      hitSlop={6}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: Math.max(80, width - 2 * side), minHeight: 40, opacity: pressed ? 0.6 : 1 })}
    >
      {incognito ? <Icon name="ghost" size={16} color={c.secondary} /> : null}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{title}</Text>
      {/* Never shrinks: a long title is cut short instead, so the arrow always shows. */}
      <View style={{ flexShrink: 0 }}>
        <Icon name="chevronDown" size={16} color={c.muted} />
      </View>
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
