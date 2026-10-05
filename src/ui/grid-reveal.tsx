// React Native port of Grid Reveal by Rare UI (https://www.rareui.com/components/gridreveal), MIT with the
// Commons Clause and attribution: credited in the README and in Settings → About. Ported for use inside Neru
// only; not to be redistributed on its own.
//
// A loading state for generated images: the frame opens as four cells and keeps splitting its biggest cell in
// two until the picture arrives and fades in. Same tree, pacing and gutters as the original. RN has no canvas
// and no pixel access, so cells stay a shimmering grey instead of taking the image's colours (the original's
// own fallback when it cannot read pixels), and the grid is drawn as SVG rects at ~30 fps.
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

import { font, useScheme } from '@/theme';

const CELLS = 180;
const OPENING_CELLS = 4;
const HOLD = 0.9; // hold short of the end so the run can never finish before the image does
const WAIT_CAP = 0.72; // the grid stops splitting here while waiting, leaving arrival somewhere to go
const LAST_SPLIT = 0.92;
const MORPH = 0.055; // how long one cell takes to separate, in progress units
const PHOTO_MS = 420;
const GUTTER_FROM = 0.35;
const GUTTER_TO = 0.75;

type Cell = { x: number; y: number; w: number; h: number; tone: number; splitAt: number; kids: [Cell, Cell] | null };
type Patch = { x: number; y: number; w: number; h: number; tone: number };

const clamp01 = (n: number) => (n > 0 ? (n < 1 ? n : 1) : 0);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// never reaches its ceiling, so a job that outruns the estimate keeps creeping
const selfPaced = (elapsed: number, duration: number) => HOLD * (1 - Math.exp(-elapsed / (duration > 0 ? duration : 1)));
const hash = (x: number, y: number, z: number) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
const makeCell = (x: number, y: number, w: number, h: number): Cell => ({ x, y, w, h, tone: hash(x + 3.1, y + 1.7, w * 31.7), splitAt: 0, kids: null });

// splitting the biggest cell each time keeps cells square and the count rising one at a time
function buildTree(aspect: number) {
  const root = makeCell(0, 0, 1, 1);
  const leaves: Cell[] = [root];
  const branches: Cell[] = [];
  while (leaves.length < CELLS) {
    let pick = 0;
    let widest = -1;
    for (let i = 0; i < leaves.length; i++) {
      const c = leaves[i];
      const area = c.w * aspect * c.h * (1 + 0.12 * hash(c.x, c.y, 7.3)); // the jitter only breaks ties
      if (area > widest) { widest = area; pick = i; }
    }
    const parent = leaves.splice(pick, 1)[0];
    const wide = parent.w * aspect >= parent.h;
    const half = wide ? parent.w / 2 : parent.h / 2;
    const a = wide ? makeCell(parent.x, parent.y, half, parent.h) : makeCell(parent.x, parent.y, parent.w, half);
    const b = wide ? makeCell(parent.x + half, parent.y, half, parent.h) : makeCell(parent.x, parent.y + half, parent.w, half);
    parent.kids = [a, b];
    branches.push(parent);
    leaves.push(a, b);
  }
  const opening = OPENING_CELLS - 1;
  const rest = Math.max(1, branches.length - opening);
  // the opening splits sit before zero so those cells are already apart on frame one
  branches.forEach((cell, i) => { cell.splitAt = i < opening ? -MORPH : (LAST_SPLIT * (i - opening + 1)) / rest; });
  return root;
}

const greyOf = (tone: number, dark: boolean, clock: number) => Math.round((dark ? 30 : 228) + tone * 13 + Math.sin(clock * 1.5 + tone * 6.28) * 3);

/** The visible cells at one instant: children start on the parent's rect and separate into their own. */
function patches(root: Cell, width: number, height: number, split: number) {
  const out: Patch[] = [];
  const walk = (cell: Cell, p: Patch) => {
    if (!cell.kids || split < cell.splitAt) return void out.push(p);
    const t = easeOut(clamp01((split - cell.splitAt) / MORPH));
    for (const kid of cell.kids) walk(kid, { x: mix(p.x, kid.x * width, t), y: mix(p.y, kid.y * height, t), w: mix(p.w, kid.w * width, t), h: mix(p.h, kid.h * height, t), tone: mix(p.tone, kid.tone, t) });
  };
  walk(root, { x: 0, y: 0, w: width, h: height, tone: root.tone });
  return out;
}

type Props = {
  /** Keep null while generating; setting it resolves the grid into the picture. */
  uri?: string | null;
  alt?: string;
  /** Width divided by height. The frame fills its parent's width. */
  aspect?: number;
  /** Status text in a frosted pill at the bottom left. */
  caption?: string;
  /** Roughly how long the work takes, to pace the grid (ms). */
  estimatedDuration?: number;
  onRevealComplete?: () => void;
};

export function GridReveal({ uri, alt, aspect = 1, caption, estimatedDuration = 20000, onRevealComplete }: Props) {
  const dark = useScheme() === 'dark';
  const reduce = useReducedMotion();
  const root = useMemo(() => buildTree(aspect > 0 ? aspect : 1), [aspect]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState({ split: 0, clock: 0 });
  const [loadedAt, setLoadedAt] = useState(-1);
  const done = useRef(onRevealComplete);
  useEffect(() => { done.current = onRevealComplete; });
  const photo = useSharedValue(0);

  // a new image starts a new run (adjusted while rendering, as the original does)
  const [lastUri, setLastUri] = useState(uri);
  if (uri !== lastUri) { setLastUri(uri); setLoadedAt(-1); }
  useEffect(() => { if (loadedAt < 0) photo.set(0); }, [loadedAt, photo]);
  useEffect(() => { if (loadedAt >= 0) photo.set(withTiming(1, { duration: reduce ? 0 : PHOTO_MS })); }, [loadedAt, reduce, photo]);

  useEffect(() => {
    if (reduce) return; // a still frame, picked below
    let raf = 0;
    let last = 0;
    let painted = 0;
    let elapsed = 0;
    let eased = 0;
    let split = 0;
    let fired = false;
    const tick = (now: number) => {
      if (!last) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;
      const ready = loadedAt >= 0;
      const target = ready ? 1 : selfPaced(elapsed * 1000, estimatedDuration);
      eased += (target - eased) * (1 - Math.exp(-dt * 5.5));
      split += (Math.min(eased, ready ? 1 : WAIT_CAP) - split) * (1 - Math.exp(-dt * 4));
      // ~30 fps keeps the JS thread free; the grid's motion is slow enough not to show it
      if (now - painted > 32) { painted = now; setFrame({ split, clock: elapsed }); }
      if (!fired && ready && eased > 0.995) { fired = true; done.current?.(); }
      if (fired && split > 0.9995) return setFrame({ split: 1, clock: elapsed }); // nothing moves after this
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loadedAt, reduce, estimatedDuration]);

  // Reduce motion holds a still frame: the waiting grid, or the finished picture.
  const shown = reduce ? { split: loadedAt >= 0 ? 1 : WAIT_CAP, clock: 0 } : frame;
  const soft = 1 - smoothstep(GUTTER_FROM, GUTTER_TO, shown.split);
  const gutter = 1.5 * soft;
  const base = greyOf(root.tone, dark, shown.clock);
  const recess = Math.round(base * 0.92);
  const photoStyle = useAnimatedStyle(() => ({ opacity: photo.get() }));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[s.frame, { aspectRatio: aspect, backgroundColor: `rgb(${recess},${recess},${recess})` }]}
      accessible={!!alt}
      accessibilityRole={alt ? 'image' : undefined}
      accessibilityLabel={alt}
      importantForAccessibility={alt ? 'yes' : 'no-hide-descendants'}
    >
      {size.w > 0 ? (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          {patches(root, size.w, size.h, shown.split).map((p, i) => {
            // only interior edges get a gutter, so the outer silhouette stays the frame
            const left = p.x <= 0.5 ? 0 : gutter;
            const top = p.y <= 0.5 ? 0 : gutter;
            const w = p.w - left - (p.x + p.w >= size.w - 0.5 ? 0 : gutter);
            const h = p.h - top - (p.y + p.h >= size.h - 0.5 ? 0 : gutter);
            if (w <= 0 || h <= 0) return null;
            const g = greyOf(p.tone, dark, shown.clock);
            return <Rect key={i} x={p.x + left} y={p.y + top} width={w} height={h} rx={Math.min(w, h) * 0.12 * soft} fill={`rgb(${g},${g},${g})`} />;
          })}
        </Svg>
      ) : null}
      {uri ? (
        <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" onLoad={() => setLoadedAt(Date.now())} accessibilityIgnoresInvertColors />
        </Animated.View>
      ) : null}
      {caption && loadedAt < 0 ? <Caption text={caption} /> : null}
    </View>
  );
}

// The frosted status pill, lit by a slow shimmer.
function Caption({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const glow = useSharedValue(0.6);
  useEffect(() => {
    if (!reduce) glow.set(withRepeat(withSequence(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }), withTiming(0.6, { duration: 1300, easing: Easing.inOut(Easing.quad) })), -1));
  }, [reduce, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  return (
    <View style={s.pill} pointerEvents="none">
      <Animated.Text key={text} style={[s.caption, style]}>{text}</Animated.Text>
    </View>
  );
}

const s = StyleSheet.create({
  frame: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  pill: { position: 'absolute', left: 12, bottom: 12, height: 24, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  caption: { fontFamily: font.medium, fontSize: 11, lineHeight: 24, color: '#fff' },
});

