// Starts a Team task on the paired desktop, like its New task dialog: pick agents (and models), a project,
// what they may do, then the first message. The task then opens here and in the drawer's Team list.
import { haptic } from '@/haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { createTeamTask, listAgentModels, listTeamAgents, useRemote } from '@/remote/store';
import type { AgentModel, TeamAgent } from '@/shared/types';
import { font, fs, TAP, useColors } from '@/theme';
import { AgentLogo } from '@/ui/agent-logo';
import { ActionButton } from '@/ui/button-base';
import { SelectSheet } from '@/ui/select';
import { Bone, Skeleton } from '@/ui/skeleton';
import { useToast } from '@/ui/toast';

// Same as the desktop's TeamView.
const NERU_AGENT: TeamAgent = { kind: 'neru', name: 'Neru', path: 'built in', version: null, signedIn: true, login: '', install: '', resumes: true };
const ACCESS = [
  { value: 'plan', label: 'Read-only', description: 'Reads and plans; changes nothing' },
  { value: 'accept_edits', label: 'Edit files', description: 'Edits files in the project; risky commands stay blocked by the agent' },
  { value: 'auto', label: 'Auto', description: "The agent's own reviewer approves each action" },
  { value: 'bypass', label: 'Full access', description: 'Runs anything without asking. Use in a worktree or sandbox' },
];
const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

export default function NewTeamTask() {
  const c = useColors();
  const toast = useToast();
  const connected = useRemote(s => s.status === 'connected');
  const sessions = useRemote(s => s.sessions);
  const teams = useRemote(s => s.teams);
  const [agents, setAgents] = useState<TeamAgent[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [models, setModels] = useState<Record<string, string>>({});
  const [modelLists, setModelLists] = useState<Record<string, AgentModel[]>>({});
  const [sheet, setSheet] = useState<'project' | 'access' | { model: string } | null>(null);
  const [mode, setMode] = useState('accept_edits');
  const [everyone, setEveryone] = useState(false);
  const [text, setText] = useState('');
  const [starting, setStarting] = useState(false);

  // Folders the desktop already works in, most recent first.
  const projects = useMemo(() => {
    const rows = [...sessions, ...teams].filter(r => r.projectPath).sort((a, b) => b.updatedAt - a.updatedAt);
    return [...new Set(rows.map(r => r.projectPath))].slice(0, 12);
  }, [sessions, teams]);
  const [project, setProject] = useState<string | null>(null);
  const where = project ?? projects[0] ?? '';

  // A CLI's models, read once, when it is first picked.
  const asked = useRef(new Set<string>());
  const loadModels = useCallback((kinds: string[]) => {
    for (const kind of kinds) {
      if (kind === 'neru' || asked.current.has(kind)) continue;
      asked.current.add(kind);
      listAgentModels(kind).then(list => setModelLists(m => ({ ...m, [kind]: list }))).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    listTeamAgents()
      .then(list => {
        const ready = [...list.filter(a => a.path), NERU_AGENT];
        setAgents(ready);
        const first = ready.filter(a => a.signedIn).slice(0, 2).map(a => a.kind);
        loadModels(first);
        setPicked(current => (current.length ? current : first));
      })
      .catch(err => { setAgents([NERU_AGENT]); toast.show({ title: 'Could not list the desktop agents', description: String(err?.message ?? err) }); });
  }, [connected, toast, loadModels]);

  const toggle = (kind: string) => {
    haptic.select();
    if (!picked.includes(kind)) loadModels([kind]);
    setPicked(current => (current.includes(kind) ? current.filter(k => k !== kind) : [...current, kind]));
  };

  const start = async () => {
    const prompt = text.trim();
    if (!prompt || !picked.length || starting) return;
    setStarting(true);
    try {
      const title = prompt.split('\n')[0].slice(0, 60);
      const task = await createTeamTask({ title, projectPath: where, members: picked.map(kind => ({ kind, model: models[kind] ?? '', mode })), text: prompt, to: everyone ? ['all'] : [] });
      haptic.success();
      router.dismissTo(`/team/${task.id}`);
    } catch (err) {
      toast.show({ title: 'The desktop did not start the task', description: String(err instanceof Error ? err.message : err) });
    } finally { setStarting(false); }
  };

  const modelSheet = sheet && typeof sheet === 'object' ? sheet.model : null;
  const row = (label: string, value: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} android_ripple={{ color: c.surface3 }} style={[s.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.label, { color: c.muted }]}>{label}</Text>
        <Text numberOfLines={1} style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{value}</Text>
      </View>
      <Icon name="chevronDown" size={18} color={c.muted} />
    </Pressable>
  );

  if (!connected)
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <Icon name="desktop" size={28} color={c.sage} />
        <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, textAlign: 'center', lineHeight: 22 }}>Your desktop is offline. Open Neru on your computer to start a team task.</Text>
      </View>
    );

  return (
    <>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, lineHeight: 22 }}>The agents share one thread and work in the project you choose on your computer.</Text>

        <Text style={[s.section, { color: c.muted }]}>AGENTS</Text>
        {!agents ? (
          <Skeleton label="Loading the desktop agents" style={{ gap: 10 }}>
            <Bone height={64} radius={16} />
            <Bone height={64} radius={16} />
          </Skeleton>
        ) : (
          agents.map(a => {
            const on = picked.includes(a.kind);
            const list = modelLists[a.kind] ?? [];
            const model = models[a.kind] ?? '';
            return (
              <View key={a.kind} style={[s.agent, { backgroundColor: c.surface2, borderColor: on ? c.mossAction : c.border }]}>
                <Pressable onPress={() => toggle(a.kind)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={a.name} style={s.agentHead}>
                  <AgentLogo kind={a.kind} initial={a.name} size={32} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{a.name}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary }}>
                      {a.kind === 'neru' ? 'Your Neru model' : a.signedIn ? `Signed in${a.version ? ` · ${a.version.replace(/\s*\(.*\)$/, '')}` : ''}` : 'Not signed in'}
                    </Text>
                  </View>
                  <View style={[s.check, { borderColor: on ? c.mossAction : c.muted, backgroundColor: on ? c.mossAction : 'transparent' }]}>{on ? <Icon name="check" size={14} color={c.onAction} /> : null}</View>
                </Pressable>
                {on && list.length ? (
                  <Pressable onPress={() => setSheet({ model: a.kind })} accessibilityRole="button" accessibilityLabel={`${a.name} model`} style={[s.model, { borderTopColor: c.border }]}>
                    <Text style={[s.label, { color: c.muted }]}>MODEL</Text>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: fs.sm, color: c.text, textAlign: 'right' }}>{model || 'Agent default'}</Text>
                    <Icon name="chevronDown" size={16} color={c.muted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
        {agents && agents.length <= 1 ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.muted, lineHeight: 20 }}>No agent CLIs found on the desktop. Install Claude Code, Codex, OpenCode, Gemini CLI or Cursor Agent there.</Text> : null}

        <Text style={[s.section, { color: c.muted }]}>WHERE AND HOW</Text>
        {row('Project', where ? baseName(where) : 'No project (planning only)', () => setSheet('project'))}
        {row('What they may do', ACCESS.find(a => a.value === mode)?.label ?? mode, () => setSheet('access'))}
        <View style={s.chips}>
          {[['Auto', false], ['Everyone', true]].map(([label, value]) => (
            <Pressable key={String(label)} hitSlop={6} onPress={() => setEveryone(value as boolean)} accessibilityRole="radio" accessibilityState={{ checked: everyone === value }} style={[s.chip, { borderColor: everyone === value ? c.mossAction : c.border, backgroundColor: everyone === value ? c.mossDeep : 'transparent' }]}>
              <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.text }}>{label as string}</Text>
            </Pressable>
          ))}
          <Text style={{ flex: 1, fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{everyone ? 'Every agent answers in parallel' : 'The first agent answers, or whoever you @mention'}</Text>
        </View>

        <Text style={[s.section, { color: c.muted }]}>FIRST MESSAGE</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Add rate limiting to the API"
          placeholderTextColor={c.muted}
          multiline
          accessibilityLabel="First message"
          style={[s.prompt, { backgroundColor: c.prompt, borderColor: c.border, color: c.text }]}
        />
        <ActionButton title="Start task" icon="team" loading={starting} disabled={!text.trim() || !picked.length || !agents} onPress={start} />
      </ScrollView>

      <SelectSheet
        open={sheet === 'project'}
        onClose={() => setSheet(null)}
        title="Project"
        value={where}
        onChange={v => (setProject(v), setSheet(null))}
        options={[...projects.map(p => ({ value: p, label: baseName(p), description: p })), { value: '', label: 'No project', description: 'Planning only, no folder' }]}
      />
      <SelectSheet open={sheet === 'access'} onClose={() => setSheet(null)} title="What they may do" value={mode} onChange={v => (setMode(v), setSheet(null))} options={ACCESS} />
      <SelectSheet
        open={!!modelSheet}
        onClose={() => setSheet(null)}
        title="Model"
        value={modelSheet ? (models[modelSheet] ?? '') : ''}
        onChange={v => (modelSheet && setModels(m => ({ ...m, [modelSheet]: v })), setSheet(null))}
        options={[{ value: '', label: 'Agent default' }, ...(modelSheet ? modelLists[modelSheet] ?? [] : []).map(m => ({ value: m.id, label: m.label === m.id ? m.id : m.label, description: m.label === m.id ? undefined : m.id }))]}
      />
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  section: { fontFamily: font.medium, fontSize: fs.xs, marginTop: 12 },
  label: { fontFamily: font.medium, fontSize: fs.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP + 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  agent: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  agentHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP + 16, paddingHorizontal: 16, paddingVertical: 10 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  model: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 999, borderWidth: 1 },
  prompt: { minHeight: 120, maxHeight: 260, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, textAlignVertical: 'top' },
});
