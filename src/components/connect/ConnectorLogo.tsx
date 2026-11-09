// A connector's brand mark on a light tile, or its initial on a tile in its brand color when there is no logo.
import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { logoUrl, tileColor } from '@/mcp/catalog';
import { font, useScheme } from '@/theme';

export function ConnectorLogo({ name, logo, color, size = 40 }: { name: string; logo?: string; color?: string; size?: number }) {
  const light = useScheme() === 'light';
  const [failed, setFailed] = useState(false);
  const uri = logoUrl(logo);
  const radius = size * 0.26;
  if (uri && !failed)
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: light ? '#ffffff' : '#f7f6f1', borderWidth: 1, borderColor: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}
      >
        <Image source={{ uri }} style={{ width: size * 0.56, height: size * 0.56 }} contentFit="contain" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      </View>
    );
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: radius, backgroundColor: tileColor(name, color), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.bold, fontSize: size * 0.46, color: '#ffffff' }}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}
