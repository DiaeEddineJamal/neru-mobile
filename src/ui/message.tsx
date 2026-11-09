// Port of beui.dev/components/agents/message (assistant row) + agents/streaming-response (completion actions).
// beUI's streaming-response has no caret: while streaming it only hides the actions, which fade up once the reply settles.
// Not ported: thumbs feedback and the sources disclosure (no data for them yet), hover colours.
import { memo, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { type EntryExitAnimationFunction, FadeIn, FadeOut, LayoutAnimationConfig, useReducedMotion, withTiming } from 'react-native-reanimated';

import { ArtifactCard } from '@/artifacts/ArtifactCard';
import { splitArtifacts, type Artifact } from '@/artifacts/parse';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { useColors } from '@/theme';
import { Button, SwapIcon } from '@/ui/button';
import { EASE_OUT } from '@/ui/motion';
import { t as tx } from '@/i18n';

const actionsIn: EntryExitAnimationFunction = () => {
  'worklet';
  const t = { duration: 220, easing: EASE_OUT };
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 4 }] },
    animations: { opacity: withTiming(1, t), transform: [{ translateY: withTiming(0, t) }] },
  };
};

type Props = { text: string; streaming: boolean; chatId?: string | null; messageId?: string; onCopy: () => void; onRetry?: () => void };

/** An artifact card that re-renders only when its artifact changed: a closed one stays put while the reply streams on. */
const ArtifactSlot = memo(
  function ArtifactSlot({ artifact, chatId, messageId }: { artifact: Artifact; chatId: string | null; messageId: string }) {
    return <ArtifactCard artifact={artifact} chatId={chatId} messageId={messageId} />;
  },
  (a, b) =>
    a.chatId === b.chatId && a.messageId === b.messageId && a.artifact.id === b.artifact.id && a.artifact.title === b.artifact.title && a.artifact.kind === b.artifact.kind
    && a.artifact.language === b.artifact.language && a.artifact.open === b.artifact.open && a.artifact.content === b.artifact.content,
);

export function AssistantMessage({ text, streaming, chatId = null, messageId = '', onCopy, onRetry }: Props) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    onCopy();
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View accessibilityLabel={tx('assistant message')} accessibilityState={{ busy: streaming }} style={{ width: '100%' }}>
      {/* Artifacts (<artifact> blocks) become cards; the text around them is Markdown. Keys stay put as the reply grows,
          so each Markdown keeps its incremental parser. */}
      <View style={{ gap: 10 }}>
        {splitArtifacts(text).map((seg, i) =>
          seg.type === 'artifact' ? <ArtifactSlot key={`a${i}`} artifact={seg.artifact} chatId={chatId} messageId={messageId} /> : seg.text.trim() ? <Markdown key={`t${i}`} text={seg.text} /> : null,
        )}
      </View>
      <LayoutAnimationConfig skipEntering>
        {!streaming && text ? (
          <Animated.View
            entering={reduce ? FadeIn.duration(120) : actionsIn}
            exiting={FadeOut.duration(reduce ? 120 : 220)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 12 }} // beUI gap-0.5; widened so the 48dp hit areas don't overlap
          >
            <Button label={copied ? tx('Copied') : tx('Copy response')} onPress={copy} pressScale={0.9} hitSlop={10} style={{ width: 28, height: 28, borderRadius: 6 }}>
              <SwapIcon swapKey={copied ? 'check' : 'copy'} size={16}>
                <Icon name={copied ? 'check' : 'copy'} size={16} color={c.muted} />
              </SwapIcon>
            </Button>
            {onRetry ? (
              <Button label={tx('Retry response')} onPress={onRetry} pressScale={0.9} hitSlop={10} style={{ width: 28, height: 28, borderRadius: 6 }}>
                <Icon name="retry" size={16} color={c.muted} />
              </Button>
            ) : null}
          </Animated.View>
        ) : null}
      </LayoutAnimationConfig>
    </View>
  );
}
