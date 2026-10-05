// Claude-style attachments above a sent user bubble, built from beUI parts: image thumbnails press like
// beUI's image-viewer thumbnail (whileTap 0.98 on SPRING_PRESS, rounded-2xl, bg-muted while loading), and
// documents use the card shared with the composer (DocCard below).
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { font, useColors } from '@/theme';
import { Button } from '@/ui/button';

export type MessageAttachment = { id: string; kind: 'image' | 'file'; name: string; uri: string };

/** "report.final.pdf" -> "PDF"; falls back to the mime subtype, then "FILE". */
export function typeLabel(name: string, mime?: string) {
  const ext = /\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? mime?.split('/')[1]?.split(/[.+;-]/)[0];
  return (ext || 'file').toUpperCase();
}

/** ~150x64 document card: file icon tile, one-line name, uppercase type label. */
export function DocCard({ name, mime }: { name: string; mime?: string }) {
  const c = useColors();
  return (
    <View style={[s.doc, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <View style={[s.docIcon, { backgroundColor: c.surface3 }]}>
        <Icon name="doc" size={18} color={c.secondary} />
      </View>
      <View style={s.docText}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={[s.docName, { color: c.text }]}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[s.docType, { color: c.muted }]}>
          {typeLabel(name, mime)}
        </Text>
      </View>
    </View>
  );
}

export function MessageAttachments({ items, onOpenImage }: { items: MessageAttachment[]; onOpenImage: (id: string) => void }) {
  const c = useColors();
  const images = items.filter(a => a.kind === 'image');
  const files = items.filter(a => a.kind === 'file');
  // A lone image shows at its own aspect (clamped so very tall shots don't fill the screen).
  const [aspect, setAspect] = useState(4 / 3);
  const single = images.length === 1;
  if (!items.length) return null;
  return (
    <View style={s.wrap}>
      {images.length ? (
        <View style={s.grid}>
          {images.map(a => (
            <Button key={a.id} label={`Open ${a.name}`} onPress={() => onOpenImage(a.id)} pressScale={0.98} hitSlop={0}>
              <Image
                source={{ uri: a.uri }}
                contentFit="cover"
                accessibilityIgnoresInvertColors
                onLoad={single ? e => e.source.height && setAspect(Math.max(0.6, Math.min(2, e.source.width / e.source.height))) : undefined}
                style={[single ? { width: 200, aspectRatio: aspect } : s.square, s.image, { backgroundColor: c.surface3 }]}
              />
            </Button>
          ))}
        </View>
      ) : null}
      {files.map(a => (
        <View key={a.id} accessible accessibilityLabel={`Attached file ${a.name}`}>
          <DocCard name={a.name} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'flex-end', gap: 6, marginHorizontal: 16, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, maxWidth: 3 * 96 + 2 * 6 },
  square: { width: 96, height: 96 },
  image: { borderRadius: 16 },
  doc: { width: 150, height: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  docIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  docText: { flex: 1, minWidth: 0, gap: 2 },
  docName: { fontFamily: font.medium, fontSize: 13 },
  docType: { fontFamily: font.medium, fontSize: 10, letterSpacing: 0.5 },
});
