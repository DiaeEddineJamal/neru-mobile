// The desktop's thinking orbs (thinking-orbs, MIT): the package's own geometry engine, painted with SVG
// instead of a canvas. Same states, presets and ink as the desktop, so a phone and a PC think alike.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { MODE_FRAMES, resolvePreset, type OrbFrame, type OrbState } from 'thinking-orbs/engine';

import { useScheme } from '@/theme';

export type { OrbState };

const ink = (white: number, a: number | undefined, dark: boolean) => {
  const g = Math.round((dark ? 1 - Math.min(1, Math.max(0, white)) : Math.min(1, Math.max(0, white))) * 255);
  return { color: `rgb(${g},${g},${g})`, opacity: a ?? 1 };
};

function Orb({ state, size, speed }: { state: OrbState; size: 20 | 32 | 64; speed: number }) {
  const dark = useScheme() === 'dark';
  const reduce = useReducedMotion();
  const { mode, speed: base, opts } = useMemo(() => resolvePreset(state, size), [state, size]);
  // The desktop's clock: wall time in seconds times the preset's speed.
  const [frame, setFrame] = useState<OrbFrame>(() => MODE_FRAMES[mode](size, (performance.now() / 1000) * base * speed, opts));
  useEffect(() => {
    if (reduce) return; // reduced motion: one still frame, as on the desktop
    let raf = 0;
    let last = 0;
    const step = () => {
      const now = performance.now();
      // ~30 fps reads as smooth at 20pt and leaves the JS thread free for streaming text.
      if (now - last > 32) { last = now; setFrame(MODE_FRAMES[mode](size, (now / 1000) * base * speed, opts)); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mode, size, base, speed, opts, reduce]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {frame.lines.map((l, i) => { const p = ink(l.white, l.a, dark); return <Line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={p.color} strokeOpacity={p.opacity} strokeWidth={l.w} />; })}
      {frame.dots.map((d, i) => { const p = ink(d.white, d.a, dark); return <Circle key={i} cx={d.x} cy={d.y} r={d.r} fill={p.color} fillOpacity={p.opacity} />; })}
    </Svg>
  );
}

/** A thinking orb; changing `state` cross-fades to the next animation, like the desktop's status line. */
export function ThinkingOrb({ state = 'working', size = 20, speed = 0.9 }: { state?: OrbState; size?: 20 | 32 | 64; speed?: number }) {
  return (
    <View style={{ width: size, height: size }} aria-hidden>
      <Animated.View key={state} entering={FadeIn.duration(400)} exiting={FadeOut.duration(300)} style={{ position: 'absolute', inset: 0 }}>
        <Orb state={state} size={size} speed={speed} />
      </Animated.View>
    </View>
  );
}
