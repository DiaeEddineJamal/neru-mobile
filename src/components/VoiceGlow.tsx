'use dom';

// The real voice-glow (libraries.dev/voice) in a DOM component, with the desktop's tuning
// (app/src/lib/voiceTheme.ts). `type="default"` wraps the composer exactly like the desktop;
// `type="mobile"` is the full-screen bottom glow used on the welcome screens.
// The phone's speech recognizer reports volume ~10 times a second over an async bridge. The beam
// samples a getter every frame; the getter must keep one identity (a new function per render makes
// the beam restart its loop, which is what made it flicker) and eases toward the latest reading.
import { useEffect, useMemo, useState } from 'react';
import { VoiceBeam } from 'voice-glow';

import { neruVoiceGlow } from '@/shared/lib/voiceTheme';

type Props = { level: number; processing: boolean; light: boolean; type?: 'default' | 'mobile'; dom?: import('expo/dom').DOMProps };

function createSampler() {
  let current = 0;
  let target = 0;
  let last = 0;
  const sample = () => {
    const now = performance.now();
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    return (current += (target - current) * (1 - Math.exp(-dt / 0.065)));
  };
  return { sample, set: (v: number) => (target = v) };
}

export default function VoiceGlow({ level, processing, light, type = 'default' }: Props) {
  const [sampler] = useState(createSampler);
  const tuning = useMemo(() => neruVoiceGlow(light), [light]);
  const background = type === 'mobile' ? light ? '#f5f4ef' : '#151515' : light ? '#ffffff' : '#20201F';
  useEffect(() => {
    sampler.set(level);
  }, [level, sampler]);

  return (
    <>
      <style>{`html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:${background}!important}`}</style>
      <VoiceBeam
        type={type}
        level={sampler.sample}
        processing={processing}
        active
        theme={light ? 'light' : 'dark'}
        {...tuning}
        strength={1}
        distortion={0}
        borderRadius={16}
        style={{ position: 'fixed', inset: 0, background, isolation: 'isolate', transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
      >
        <div style={{ width: '100%', height: '100%' }} />
      </VoiceBeam>
    </>
  );
}
