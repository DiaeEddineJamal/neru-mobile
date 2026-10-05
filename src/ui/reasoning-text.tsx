// Port of beui.dev/components/agents/loading-states (reasoning-text, "cascade" variant) with beUI's AgentDisclosure
// reveal for the reasoning body. beUI's component is only the cycling status line; the collapsible body and the
// settled "Reasoning" label are composed from beUI's disclosure + SPRING_SWAP chevron (streaming-response's sources toggle).
// The disclosure's clip-path reveal is an animated height here.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { type EntryExitAnimationFunction, LayoutAnimationConfig, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { font, fs, useColors } from '@/theme';
import { AsciiLineLoader } from '@/ui/loader';
import { EASE_OUT, SPRING_SWAP } from '@/ui/motion';
import { ShimmerChar, useShimmerClock } from '@/ui/thinking-shimmer';

const PHRASES = ['Thinking', 'Reading the context', 'Connecting the details', 'Forming a response'];
const LONGEST = PHRASES.reduce((a, b) => (b.length > a.length ? b : a));
const STAGGER = 25; // ms, CASCADE_STAGGER
const LINE = 20;
const label = { fontFamily: font.medium, fontSize: fs.sm, lineHeight: LINE };

// Each glyph rises from y 100% on SPRING_SWAP; the outgoing phrase leaves to y -100% in 0.14s.
const charIn = (delay: number): EntryExitAnimationFunction => () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: LINE }] },
    animations: { opacity: withDelay(delay, withSpring(1, SPRING_SWAP)), transform: [{ translateY: withDelay(delay, withSpring(0, SPRING_SWAP)) }] },
  };
};
const charOut = (delay: number): EntryExitAnimationFunction => () => {
  'worklet';
  const out = { duration: 140, easing: EASE_OUT };
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withDelay(delay, withTiming(0, out)), transform: [{ translateY: withDelay(delay, withTiming(-LINE, out)) }] },
  };
};

function Phrase({ phrase }: { phrase: string }) {
  const reduce = useReducedMotion();
  const clock = useShimmerClock(2.2);
  const chars = Array.from(`${phrase}…`);
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, flexDirection: 'row' }}>
      {chars.map((ch, i) => (
        <ShimmerChar
          key={i}
          char={ch}
          clock={clock}
          // In cascade each glyph carries its own 200% gradient, so all glyphs pulse in phase.
          u={reduce ? (i + 0.5) / chars.length : 0.5}
          style={label}
          entering={reduce ? undefined : charIn(i * STAGGER)}
          exiting={reduce ? undefined : charOut(i * STAGGER * 0.45)}
        />
      ))}
    </View>
  );
}

export function ReasoningText({ text, streaming }: { text: string; streaming: boolean }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const phrase = PHRASES[index];

  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setIndex(i => (i + 1) % PHRASES.length), 1800);
    return () => clearInterval(id);
  }, [streaming]);

  const turn = useSharedValue(0);
  const shown = useSharedValue(0);
  const height = useSharedValue(0);
  useEffect(() => {
    turn.set(reduce ? (open ? 180 : 0) : withSpring(open ? 180 : 0, SPRING_SWAP));
    shown.set(withTiming(open ? 1 : 0, { duration: reduce ? 0 : open ? 220 : 140, easing: EASE_OUT }));
  }, [open, reduce, turn, shown]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  const body = useAnimatedStyle(() => ({
    height: height.get() * shown.get(),
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * -4 }],
  }));

  return (
    <View>
      <Pressable
        onPress={() => setOpen(o => !o)}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel={streaming ? phrase : 'Reasoning'}
        accessibilityState={{ expanded: open }}
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}
      >
        {streaming ? (
          <>
            <AsciiLineLoader size={14} speed={0.8} />
            <View style={{ overflow: 'hidden' }}>
              <Text style={[label, { opacity: 0 }]}>{LONGEST}…</Text>
              <LayoutAnimationConfig skipEntering>
                <Phrase key={phrase} phrase={phrase} />
              </LayoutAnimationConfig>
            </View>
          </>
        ) : (
          <Text style={[label, { color: c.muted }]}>Reasoning</Text>
        )}
        <Animated.View style={chevron}>
          <Icon name="chevronDown" size={14} color={c.muted} />
        </Animated.View>
      </Pressable>

      <Animated.View aria-hidden={!open} style={[{ overflow: 'hidden', pointerEvents: open ? 'auto' : 'none' }, body]}>
        <View onLayout={e => height.set(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: 8 }}>
          <Text selectable style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: LINE, color: c.secondary }}>{text}</Text>
        </View>
      </Animated.View>
    </View>
  );
}
