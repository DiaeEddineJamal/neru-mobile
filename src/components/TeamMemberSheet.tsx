// A Team member's model and reasoning effort, changed from the phone like the desktop's member panel
// (TeamView's ModelField): "Agent default" or one of the models the agent's CLI lists, then the efforts that
// model supports. Every pick goes to the desktop right away; the next turn runs with it.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { listAgentModels, updateTeamMember } from '@/remote/store';
import type { AgentModel, TeamMember } from '@/shared/types';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';
import { RowsSkeleton } from '@/ui/skeleton';
import { useToast } from '@/ui/toast';

const EFFORT_LABEL: Record<string, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const effortLabel = (e: string) => EFFORT_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

export function TeamMemberSheet({ taskId, member, name, onClose }: { taskId: string; member: TeamMember | null; name: string; onClose: () => void }) {
  const c = useColors();
  const toast = useToast();
  const kind = member?.kind;
  const [loaded, setLoaded] = useState<{ kind: string; list: AgentModel[] } | null>(null);
  const models = loaded && loaded.kind === kind ? loaded.list : null;
  // A pick shows at once; the desktop's member event confirms it a moment later.
  const [picked, setPicked] = useState<{ handle: string; model?: string; effort?: string } | null>(null);
  const mine = picked && picked.handle === member?.handle ? picked : null;
  const model = mine?.model ?? member?.model ?? '';
  const effort = mine?.effort ?? member?.effort ?? '';

  useEffect(() => {
    if (!kind) return;
    listAgentModels(kind).then(list => setLoaded({ kind, list }), () => setLoaded({ kind, list: [] }));
  }, [kind]);

  const chosen = models?.find(m => m.id === model);
  // On the agent default, every effort any model offers (as the desktop does).
  const efforts = chosen ? chosen.efforts : [...new Set((models ?? []).flatMap(m => m.efforts))];
  const apply = async (change: { model?: string; effort?: string }) => {
    if (!member) return;
    setPicked({ ...(mine ?? {}), handle: member.handle, ...change });
    try { await updateTeamMember(taskId, member.handle, change); }
    catch (err) { toast.show({ title: 'Could not change the member', description: String((err as Error)?.message ?? err) }); }
  };
  const pickModel = (id: string) => {
    const next = models?.find(m => m.id === id);
    // An effort the new model does not offer goes back to its default.
    void apply(next && effort && !next.efforts.includes(effort) ? { model: id, effort: '' } : { model: id });
  };

  const option = (key: string, label: string, detail: string | null, selected: boolean, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} android_ripple={{ color: c.surface3 }} style={s.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: selected ? font.semibold : font.sans, fontSize: fs.base, color: c.text }}>{label}</Text>
        {detail ? <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: fs.xs, color: c.muted }}>{detail}</Text> : null}
      </View>
      {selected ? <Icon name="check" size={20} color={c.moss} /> : null}
    </Pressable>
  );

  return (
    <BottomSheet open={!!member} onClose={onClose} title={member ? `@${member.handle} · ${name}` : undefined}>
      <View style={{ gap: 8, paddingBottom: 8 }}>
        <Text style={[s.heading, { color: c.muted }]}>MODEL</Text>
        {models === null ? <RowsSkeleton /> : (
          <View style={[s.group, { backgroundColor: c.surface2, borderColor: c.border }]}>
            {option('default', 'Agent default', kind === 'codex' ? 'A model this Codex and your sign-in support' : null, !model, () => pickModel(''))}
            {models.map(m => option(m.id, m.label, m.label !== m.id ? m.id : null, model === m.id, () => pickModel(m.id)))}
            {model && !chosen ? option(model, model, 'Set on the desktop', true, () => {}) : null}
          </View>
        )}
        {models !== null && !models.length ? <Text style={[s.note, { color: c.muted }]}>This agent keeps no model list. It uses its own default, or the model set on your desktop.</Text> : null}
        {efforts.length ? <>
          <Text style={[s.heading, { color: c.muted, marginTop: 12 }]}>REASONING EFFORT</Text>
          <View style={[s.group, { backgroundColor: c.surface2, borderColor: c.border }]}>
            {option('default', chosen?.defaultEffort ? `Default (${effortLabel(chosen.defaultEffort)})` : 'Default', null, !effort, () => void apply({ effort: '' }))}
            {efforts.map(e => option(e, effortLabel(e), null, effort === e, () => void apply({ effort: e })))}
          </View>
        </> : null}
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  heading: { fontFamily: font.medium, fontSize: fs.xs, letterSpacing: 0.6, paddingHorizontal: 4 },
  group: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP, paddingHorizontal: 16, paddingVertical: 6 },
  note: { fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, paddingHorizontal: 4 },
});
