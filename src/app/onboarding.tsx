// First-run journey. Principles: show value before asking for anything (Krystal Higgins, "Better
// Onboarding"); one decision per screen and plain words (Krug, Hick's law); teach by doing, ask for
// permissions only in context, let people skip (Apple HIG onboarding, Material 3); thumb-zone actions
// at the bottom (Hoober); progress always visible and reversible (Nielsen: visibility, user control).
import { haptic } from '@/haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown, SlideInRight, SlideOutLeft, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton, type IconName } from '@/components/Icon';
import { appVersion } from '@/components/WhatsNew';
import { score } from '@/llm/fallback';
import { chooseModel, getState, presetOf, saveProviderKey, testKey, updateSettings } from '@/store';
import { font, fs, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { TextField } from '@/ui/input';
import { EASE_OUT, SPRING_LAYOUT } from '@/ui/motion';
import { RadioGroup, type RadioOption } from '@/ui/radio';
import { TextReveal } from '@/ui/text-reveal';

type Step = 'welcome' | 'you' | 'tour' | 'path' | 'key' | 'done';
const ORDER: Step[] = ['welcome', 'you', 'tour', 'path', 'key', 'done'];

const genders: RadioOption[] = [
  { value: 'male', title: 'Male', description: 'Models call you he, and use masculine forms in languages that have them.' },
  { value: 'female', title: 'Female', description: 'Models call you she, and use feminine forms in languages that have them.' },
];

const paths: RadioOption[] = [
  { value: 'free', title: 'Free models', description: 'Use a free key from NVIDIA, Google or OpenRouter. Takes about a minute.', icon: 'sparkles', badge: 'Recommended' },
  { value: 'desktop', title: 'My desktop', description: 'Pair with Neru on your computer to follow and approve its work.', icon: 'desktop' },
  { value: 'later', title: 'Just look around', description: 'Set things up later from Settings.', icon: 'compass' },
];

const providers: RadioOption[] = [
  { value: 'nvidia', title: 'NVIDIA NIM', description: 'Big open models, generous daily limit. No card needed.', badge: 'Best start' },
  { value: 'gemini', title: 'Google Gemini', description: 'Fast Flash models with a huge context window.' },
  { value: 'openrouter', title: 'OpenRouter', description: 'One key for many free models.' },
  { value: 'groq', title: 'Groq', description: 'Very fast replies, smaller limits.' },
];

const tour: [IconName, string, string][] = [
  ['sparkles', 'Chat with free models', 'Neru switches to the next free model when one runs out, so you keep going.'],
  ['desktop', 'Stay close to your desktop', 'Follow coding sessions, read diffs and approve changes from anywhere in the house.'],
  ['mic', 'Just say it', 'Tap the mic and talk. The stripes move with your voice.'],
];

function Progress({ index, total }: { index: number; total: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 6, flex: 1 }} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: total, now: index + 1 }}>
      {Array.from({ length: total }, (_, i) => (
        <Segment key={i} filled={i <= index} track={c.surface3} fill={c.mossAction} />
      ))}
    </View>
  );
}

function Segment({ filled, track, fill }: { filled: boolean; track: string; fill: string }) {
  const w = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    w.set(withSpring(filled ? 1 : 0, SPRING_LAYOUT));
  }, [filled, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.get() * 100}%` }));
  return (
    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={[{ height: 4, borderRadius: 2, backgroundColor: fill }, style]} />
    </View>
  );
}

function Mascot({ size }: { size: number }) {
  // A slow breath, the same calm the desktop mascot has.
  const breath = useSharedValue(1);
  useEffect(() => {
    breath.set(withRepeat(withSequence(withTiming(1.04, { duration: 1800, easing: EASE_OUT }), withTiming(1, { duration: 1800, easing: EASE_OUT })), -1));
  }, [breath]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: breath.get() }] }));
  return (
    <Animated.View style={style}>
      <Image source={require('@/assets/images/neru-mascot.png')} style={{ width: size, height: size }} contentFit="contain" accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

export default function Onboarding() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('welcome');
  const [path, setPath] = useState('free');
  const [provider, setProvider] = useState('nvidia');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string>();
  const [name, setName] = useState(getState().settings.name ?? '');
  const [gender, setGender] = useState(getState().settings.gender ?? '');
  const [busy, setBusy] = useState(false);

  const index = ORDER.indexOf(step);
  const go = (next: Step) => {
    haptic.select();
    setError(undefined);
    setStep(next);
  };
  const finish = (then?: '/pair') => {
    updateSettings({ onboarded: true, seenVersion: appVersion, tour: 'pending' });
    router.replace('/');
    if (then) router.push(then);
  };
  const preset = presetOf(provider);

  const saveKey = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const models = await testKey(provider, key);
      await saveProviderKey(provider, key);
      if (models.length) chooseModel(provider, [...models].sort((a, b) => score(b) - score(a))[0]);
      haptic.success();
      setStep('done');
    } catch (err) {
      haptic.error();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onPath = () => {
    if (path === 'free') return go('key');
    if (path === 'desktop') return finish('/pair');
    finish();
  };

  const body = () => {
    switch (step) {
      case 'welcome':
        return (
          <View style={s.center}>
            <Mascot size={128} />
            <TextReveal text="Think it through, anywhere." style={[s.display, { color: c.text }]} />
            <Animated.Text entering={FadeInDown.delay(500).springify()} style={[s.lead, { color: c.secondary }]}>
              Neru brings free AI models and your desktop coding sessions to your phone.
            </Animated.Text>
          </View>
        );
      case 'you':
        return (
          <View style={{ gap: 20 }}>
            <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>What should Neru call you?</Text>
            <Text style={[s.lead, { color: c.secondary, textAlign: 'left' }]}>Every model you chat with will know your name and how to address you. Change it any time in Settings.</Text>
            <TextField label="Your name" value={name} onChangeText={setName} placeholder="First name" autoCapitalize="words" autoComplete="given-name" textContentType="givenName" returnKeyType="done" />
            <RadioGroup options={genders} value={gender} onChange={setGender} />
          </View>
        );
      case 'tour':
        return (
          <View style={{ gap: 28 }}>
            <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>What you can do</Text>
            {tour.map(([icon, title, text], i) => (
              <Animated.View key={title} entering={FadeInDown.delay(120 + i * 110).springify()} style={s.feature}>
                <View style={[s.featureIcon, { backgroundColor: c.surface3 }]}>
                  <Icon name={icon} size={24} color={c.moss} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text }}>{title}</Text>
                  <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 21 }}>{text}</Text>
                </View>
              </Animated.View>
            ))}
          </View>
        );
      case 'path':
        return (
          <View style={{ gap: 20 }}>
            <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>How do you want to start?</Text>
            <RadioGroup options={paths} value={path} onChange={setPath} />
          </View>
        );
      case 'key':
        return (
          <View style={{ gap: 20 }}>
            <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>Pick a free provider</Text>
            <RadioGroup options={providers} value={provider} onChange={p => (setProvider(p), setError(undefined))} />
            <View style={[s.steps, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: fs.sm, color: c.text }}>Get your {preset?.name} key</Text>
              {['Open the key page and sign in.', 'Create a key and copy it.', 'Come back and paste it below.'].map((t, i) => (
                <View key={t} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={[s.stepNum, { color: c.onAction, backgroundColor: c.mossAction }]}>{i + 1}</Text>
                  <Text style={{ flex: 1, fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 22 }}>{t}</Text>
                </View>
              ))}
              {preset?.keyUrl ? <ActionButton title="Open the key page" variant="secondary" icon="link" onPress={() => Linking.openURL(preset.keyUrl!)} /> : null}
            </View>
            <TextField label="API key" value={key} onChangeText={setKey} placeholder="Paste your key" secureTextEntry autoCapitalize="none" autoCorrect={false} error={error} />
            <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted, lineHeight: 18 }}>
              Your key stays on this phone in the system keystore and is only sent to {preset?.name}.
            </Text>
          </View>
        );
      case 'done':
        return (
          <View style={s.center}>
            <Animated.View entering={FadeIn.springify()} style={[s.doneMark, { backgroundColor: c.mossAction }]}>
              <Icon name="check" size={40} color={c.onAction} />
            </Animated.View>
            <TextReveal text={getState().settings.name ? `You're all set, ${getState().settings.name!.split(/\s+/)[0]}.` : "You're all set."} style={[s.display, { color: c.text }]} />
            <Text style={[s.lead, { color: c.secondary }]}>
              You’re chatting with {getState().settings.model || 'your new model'}. Tap its name at the top any time to switch.
            </Text>
          </View>
        );
    }
  };

  const actions = () => {
    switch (step) {
      case 'welcome':
        return (
          <>
            <ActionButton title="Get started" onPress={() => go('you')} />
            <ActionButton title="I already use Neru on my computer" variant="ghost" onPress={() => finish('/pair')} />
          </>
        );
      case 'you':
        return (
          <ActionButton
            title={name.trim() ? `Nice to meet you, ${name.trim().split(/\s+/)[0]}` : 'Continue'}
            disabled={!name.trim() || !gender}
            onPress={() => (updateSettings({ name: name.trim(), gender: gender as 'male' | 'female' }), go('tour'))}
          />
        );
      case 'tour':
        return <ActionButton title="Continue" onPress={() => go('path')} />;
      case 'path':
        return <ActionButton title={path === 'free' ? 'Continue' : path === 'desktop' ? 'Pair my desktop' : 'Start exploring'} onPress={onPath} />;
      case 'key':
        return (
          <>
            <ActionButton title="Connect" onPress={saveKey} loading={busy} disabled={!key.trim()} />
            <ActionButton title="I'll do this later" variant="ghost" onPress={() => finish()} />
          </>
        );
      case 'done':
        return <ActionButton title="Start chatting" onPress={() => finish()} />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        {index > 0 && step !== 'done' ? <IconButton name="chevronLeft" label="Back" color={c.text} onPress={() => go(ORDER[index - 1])} /> : <View style={{ width: 48 }} />}
        <Progress index={index} total={ORDER.length} />
        {step !== 'done' ? <ActionButton title="Skip" variant="ghost" onPress={() => finish()} /> : <View style={{ width: 48 }} />}
      </View>

      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[s.content, { paddingBottom: 24 }]} keyboardShouldPersistTaps="handled">
        <Animated.View key={step} entering={SlideInRight.springify().damping(30).stiffness(260)} exiting={SlideOutLeft.duration(180)} style={{ flex: 1 }}>
          {body()}
        </Animated.View>
      </KeyboardAwareScrollView>

      <View style={[s.actions, { paddingBottom: insets.bottom + 16 }]}>{actions()}</View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, paddingVertical: 32 },
  display: { fontFamily: font.serif, fontSize: 44, lineHeight: 50, textAlign: 'center' },
  title: { fontFamily: font.serif, fontSize: 34, lineHeight: 40 },
  lead: { fontFamily: font.sans, fontSize: fs.md, lineHeight: 26, textAlign: 'center', maxWidth: 340 },
  feature: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  featureIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  steps: { gap: 12, padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  stepNum: { width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, fontFamily: font.semibold, fontSize: fs.xs, overflow: 'hidden' },
  doneMark: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { paddingHorizontal: 24, paddingTop: 12, gap: 8 },
});
