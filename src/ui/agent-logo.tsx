// The desktop's AgentMark: an agent CLI's logo on a light rounded tile (Team.css .agent-mark), Neru's mascot for
// its own agent, and the agent's initial on a tint for CLIs without a known logo.
import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import * as logos from '@/ui/agent-logos/logos';
import { font, useColors, useScheme } from '@/theme';

const LOGOS: Record<string, string> = { claude: logos.claude, 'claude-desktop': logos.claude, codex: logos.codex, opencode: logos.opencode, gemini: logos.gemini, cursor: logos.cursor, copilot: logos.githubcopilot, vscode: logos.vscode, qwen: logos.qwen, amp: logos.amp, goose: logos.goose, kiro: logos.kiro };

/** `initial` and `tint` draw the fallback for an agent with no logo (or `kind` 'all'). */
export function AgentLogo({ kind, size, initial, tint }: { kind: string; size: number; initial?: string; tint?: string }) {
  const c = useColors();
  const light = useScheme() === 'light';
  const radius = size * 0.26;
  if (kind === 'neru')
    return <Image source={require('@/assets/images/neru-mascot.png')} style={{ width: size, height: size }} contentFit="contain" accessibilityIgnoresInvertColors />;
  const logo = LOGOS[kind];
  if (!logo) {
    const ink = tint ?? c.secondary;
    return (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: `${ink}26`, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: font.semibold, fontSize: size * 0.46, color: ink }}>{(initial ?? kind).charAt(0).toUpperCase()}</Text>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: light ? '#ffffff' : '#f7f6f1', borderWidth: 1, borderColor: light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
      <SvgXml xml={logo} width={size * 0.62} height={size * 0.62} color="#191a18" />
    </View>
  );
}
