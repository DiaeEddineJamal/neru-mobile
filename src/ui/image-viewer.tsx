// Port of beui.dev/components/motion/image-viewer (registry: morphing-lightbox).
// Same black/90 scrim on a 0.18s EASE_OUT fade (0.1s reduced), white/10 round controls, counter + close
// header, previous / caption / next footer, the bottom-right black/60 zoom toggle, 2x zoom on SPRING_LAYOUT,
// a 0.28s EASE_DRAWER page slide and the 50px swipe threshold.
// Not faithful: beUI's shared-element thumbnail morph (layoutId) is approximated by a scale 0.9 -> 1 plus fade
// from centre on SPRING_LAYOUT, since nothing can share layout across a Modal. Touch additions beUI's pointer
// version lacks: pinch zoom (1-4x, scales about the centre), double-tap zoom at the tap point, swipe down to
// dismiss. Not ported: keyboard arrows and the focus trap (the Modal owns focus).
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon, type IconName } from '@/components/Icon';
import { font, fs } from '@/theme';
import { Button } from '@/ui/button';
import { EASE_DRAWER, EASE_OUT, SPRING_LAYOUT } from '@/ui/motion';

export type ImageViewerImage = { uri: string; name?: string };
type Props = { images: ImageViewerImage[]; index: number | null; onClose: () => void };

const SLIDE = { duration: 280, easing: EASE_DRAWER };
const FADE = { duration: 180, easing: EASE_OUT };
const FADE_REDUCED = { duration: 100, easing: EASE_OUT };
const SWIPE = 50;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const ZOOM = 2;
const MAX_ZOOM = 4;
// Header and footer rows: a 40dp control plus beUI's pb-3 / pt-3.
const BAR = 52;

/** Full-screen viewer for chat images. `index` null keeps it closed; it plays its exit before unmounting. */
export function ImageViewer({ images, index, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const open = index !== null && images.length > 0;
  const [mounted, setMounted] = useState(open);
  const [page, setPage] = useState(index ?? 0);
  const [zoomed, setZoomed] = useState(false);
  const [seen, setSeen] = useState(index);
  if (index !== seen) {
    setSeen(index);
    if (index !== null) {
      setPage(index);
      setZoomed(false);
    }
  }
  if (open && !mounted) setMounted(true);

  const progress = useSharedValue(0);
  const pageX = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  // 0 undecided, 1 paging, 2 dismissing, 3 panning a zoomed image.
  const mode = useSharedValue(0);
  const last = images.length - 1;
  const frameH = H - insets.top - insets.bottom - 2 * BAR - 24;

  useEffect(() => {
    if (!mounted) return;
    if (open) {
      pageX.set(-Math.min(index, last) * W);
      dragY.set(0);
      scale.set(1);
      tx.set(0);
      ty.set(0);
      progress.set(reduce ? withTiming(1, FADE_REDUCED) : withSpring(1, SPRING_LAYOUT));
    } else {
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(setMounted, false);
      };
      progress.set(reduce ? withTiming(0, FADE_REDUCED, done) : withTiming(0, FADE, done));
    }
  }, [open, mounted, index, last, W, reduce, progress, pageX, dragY, scale, tx, ty]);

  const resetZoom = () => {
    'worklet';
    scale.set(reduce ? 1 : withSpring(1, SPRING_LAYOUT));
    tx.set(reduce ? 0 : withSpring(0, SPRING_LAYOUT));
    ty.set(reduce ? 0 : withSpring(0, SPRING_LAYOUT));
    scheduleOnRN(setZoomed, false);
  };

  const go = (next: number) => {
    'worklet';
    const to = Math.max(0, Math.min(last, next));
    pageX.set(reduce ? -to * W : withTiming(-to * W, SLIDE));
    scheduleOnRN(setPage, to);
  };

  const zoomTo = (to: number, fx = W / 2, fy = frameH / 2) => {
    'worklet';
    // Keep the tapped point under the finger, clamped so the image edge never leaves the frame.
    const bx = (W * (to - 1)) / 2;
    const by = (frameH * (to - 1)) / 2;
    const nx = Math.max(-bx, Math.min(bx, (W / 2 - fx) * (to - 1)));
    const ny = Math.max(-by, Math.min(by, (frameH / 2 - fy) * (to - 1)));
    scale.set(reduce ? to : withSpring(to, SPRING_LAYOUT));
    tx.set(reduce ? nx : withSpring(nx, SPRING_LAYOUT));
    ty.set(reduce ? ny : withSpring(ny, SPRING_LAYOUT));
    scheduleOnRN(setZoomed, to > 1.01);
  };

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      mode.set(scale.get() > 1.01 ? 3 : 0);
      startX.set(tx.get());
      startY.set(ty.get());
    })
    .onUpdate((e) => {
      if (mode.get() === 0 && Math.hypot(e.translationX, e.translationY) > 8)
        mode.set(Math.abs(e.translationX) > Math.abs(e.translationY) ? 1 : e.translationY > 0 ? 2 : 1);
      if (mode.get() === 1) {
        // Rubber-band past the first and last image.
        const edge = (page === 0 && e.translationX > 0) || (page === last && e.translationX < 0);
        dragX.set(edge ? e.translationX * 0.25 : e.translationX);
      } else if (mode.get() === 2) dragY.set(Math.max(0, e.translationY));
      else if (mode.get() === 3) {
        const bx = (W * (scale.get() - 1)) / 2;
        const by = (frameH * (scale.get() - 1)) / 2;
        tx.set(Math.max(-bx, Math.min(bx, startX.get() + e.translationX)));
        ty.set(Math.max(-by, Math.min(by, startY.get() + e.translationY)));
      }
    })
    .onEnd((e) => {
      if (mode.get() === 1) {
        const dir = e.translationX < -SWIPE || e.velocityX < -600 ? 1 : e.translationX > SWIPE || e.velocityX > 600 ? -1 : 0;
        pageX.set(pageX.get() + dragX.get());
        dragX.set(0);
        go(page + dir);
      } else if (mode.get() === 2) {
        if (dragY.get() > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) scheduleOnRN(onClose);
        else dragY.set(withSpring(0, SPRING_LAYOUT));
      }
      mode.set(0);
    });

  const pinch = Gesture.Pinch()
    .onStart(() => startScale.set(scale.get()))
    .onUpdate((e) => scale.set(Math.max(0.8, Math.min(MAX_ZOOM, startScale.get() * e.scale))))
    .onEnd(() => {
      if (scale.get() < 1) resetZoom();
      else zoomTo(scale.get(), W / 2 - tx.get() / (scale.get() - 1 || 1), frameH / 2 - ty.get() / (scale.get() - 1 || 1));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.get() > 1.01) resetZoom();
      else zoomTo(ZOOM, e.x, e.y);
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() * (1 - Math.min(dragY.get() / (H / 2), 0.6)) }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: progress.get() * (dragY.get() > 0 ? 0.4 : 1) }));
  const frameStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const pull = 1 - Math.min(dragY.get() / H, 0.25);
    return {
      opacity: Math.min(1, p * 1.5),
      transform: [{ translateY: dragY.get() }, { scale: (reduce ? 1 : 0.9 + 0.1 * p) * pull }],
    };
  });
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pageX.get() + dragX.get() }] }));

  if (!mounted || !images.length) return null;
  const current = images[Math.min(page, last)];

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={s.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, s.scrim, scrimStyle]} />
        <View accessibilityViewIsModal accessibilityLabel="Image viewer" style={[s.fill, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <Animated.View style={[s.bar, s.header, chromeStyle]}>
            <Text accessibilityLiveRegion="polite" style={s.counter}>
              {page + 1} / {images.length}
            </Text>
            <Control icon="close" label="Close viewer" onPress={onClose} />
          </Animated.View>

          <GestureDetector gesture={gesture}>
            <Animated.View style={[s.frame, frameStyle]}>
              <Animated.View style={[s.track, { width: W * images.length }, trackStyle]}>
                {images.map((img, i) => (
                  <Page key={`${i}-${img.uri}`} uri={img.uri} name={img.name} width={W} active={i === page} scale={scale} tx={tx} ty={ty} />
                ))}
              </Animated.View>
              <Control
                icon={zoomed ? 'minus' : 'plus'}
                label={zoomed ? 'Zoom out' : 'Zoom in'}
                onPress={() => (zoomed ? resetZoom() : zoomTo(ZOOM))}
                style={s.zoom}
              />
            </Animated.View>
          </GestureDetector>

          <Animated.View style={[s.bar, s.footer, chromeStyle]}>
            {images.length > 1 ? <Control icon="chevronLeft" label="Previous image" disabled={page <= 0} onPress={() => (resetZoom(), go(page - 1))} /> : <View />}
            <Text numberOfLines={1} accessibilityLiveRegion="polite" style={s.caption}>
              {current?.name ?? ''}
            </Text>
            {images.length > 1 ? <Control icon="chevronRight" label="Next image" disabled={page >= last} onPress={() => (resetZoom(), go(page + 1))} /> : <View />}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function Page({ uri, name, width, active, scale, tx, ty }: { uri: string; name?: string; width: number; active: boolean; scale: SharedValue<number>; tx: SharedValue<number>; ty: SharedValue<number> }) {
  const [failed, setFailed] = useState(false);
  const zoom = useAnimatedStyle(() => (active ? { transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }] } : { transform: [] }));
  return (
    <View style={[s.page, { width }]}>
      <Animated.View style={[s.fill, zoom]}>
        <Image source={{ uri }} style={s.fill} contentFit="contain" accessibilityLabel={name ?? 'Image'} accessibilityIgnoresInvertColors onError={() => setFailed(true)} />
      </Animated.View>
      {failed ? (
        <Text accessibilityRole="alert" style={[StyleSheet.absoluteFill, s.failed]}>
          Unable to load this image.
        </Text>
      ) : null}
    </View>
  );
}

/** beUI controlClass: size-10 round, white/10 fill, white icon, disabled at 30%. 4dp slop makes it 48dp. */
function Control({ icon, label, onPress, disabled, style }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; style?: object }) {
  return (
    <Button label={label} onPress={onPress} disabled={disabled} hitSlop={4} style={[s.control, style, disabled && s.dim]}>
      <Icon name={icon} size={18} color="#fff" />
    </Button>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.9)' },
  bar: { height: BAR, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12 },
  header: { paddingBottom: 12 },
  footer: { paddingTop: 12 },
  counter: { color: '#fff', fontFamily: font.sans, fontSize: fs.xs, fontVariant: ['tabular-nums'] },
  caption: { flex: 1, minWidth: 0, textAlign: 'center', color: '#fff', fontFamily: font.sans, fontSize: fs.sm },
  frame: { flex: 1, overflow: 'hidden' },
  track: { flex: 1, flexDirection: 'row' },
  page: { height: '100%', paddingHorizontal: 12, overflow: 'hidden' },
  failed: { textAlign: 'center', textAlignVertical: 'center', padding: 16, margin: 12, backgroundColor: '#171717', color: '#fff', fontFamily: font.sans, fontSize: fs.sm },
  control: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)' },
  dim: { opacity: 0.3 },
  zoom: { position: 'absolute', right: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.6)' },
});
