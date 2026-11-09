// The user's round profile photo (Settings → Profile), or their initials on the accent when there is none.
import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { font, useColors } from '@/theme';

/** Initials for the placeholder: first letters of the first two words. */
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

export function Avatar({ uri, name, size }: { uri?: string; name: string; size: number }) {
  const c = useColors();
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface3 }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.sage, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.title, fontSize: size * 0.4, color: c.bg }}>{initials(name) || 'N'}</Text>
    </View>
  );
}
