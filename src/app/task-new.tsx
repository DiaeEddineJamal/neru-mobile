import { clearComposerDraft, mergeAttachments, useComposerDraft } from '@/drafts';
// Gives the paired desktop a Code task from the phone: say or type it, add a photo (a whiteboard, a bug on another
// screen), pick the project, and run it now or queue it for tonight, after free plans reset their daily quota.
import { haptic } from '@/haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { cameraChat, pickPhotos, recoverPhoto, takePhoto, toPhoneImages } from '@/attach';
import { Icon, type IconName } from '@/components/Icon';
import { t as tx } from '@/i18n';
import { listProjects, newSession, queueTask, useRemote } from '@/remote/store';
import { nextQuotaReset, type ProjectForPhone } from '@/shared/remoteProtocol';
import type { AgentMode } from '@/shared/types';
import type { Attachment } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';
import { ActionButton } from '@/ui/button-base';
import { MessageAttachments } from '@/ui/message-attachments';
import { SelectSheet } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { useVoice } from '@/voice';

const MODES: { value: AgentMode; label: string; description: string }[] = [
  { value: 'manual', label: 'Ask me first', description: 'Every change and command waits for your approval' },
  { value: 'accept_edits', label: 'Edit files', description: 'Edits files on its own; commands still ask' },
  { value: 'auto', label: 'Auto', description: 'Routine work runs on its own; risky steps still ask' },
];
const WHEN = ['now', 'tonight', 'hour'] as const;
type When = (typeof WHEN)[number];

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function NewDesktopTask() {
  const c = useColors();
  const modes = MODES.map(m => ({ ...m, label: tx(m.label), description: tx(m.description) }));
  const toast = useToast();
  const connected = useRemote(s => s.status === 'connected');
  const [projects, setProjects] = useState<ProjectForPhone[] | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [mode, setMode] = useState<AgentMode>('manual');
  const [when, setWhen] = useState<When>('now');
  const { text, setText, attachments: photos, setAttachments: setPhotos } = useComposerDraft('task');
  const [sheet, setSheet] = useState<'project' | 'mode' | null>(null);
  const [busy, setBusy] = useState(false);
  const voice = useVoice(setText, text);
  const listening = voice.state !== 'idle';
  const reset = useMemo(() => nextQuotaReset(), []);
  const [hourAt] = useState(() => Date.now() + 3600_000);

  useEffect(() => {
    if (!connected) return;
    listProjects()
      .then(list => setProjects(list))
      .catch(err => (setProjects([]), toast.show({ title: tx('Could not list your projects'), description: String(err?.message ?? err) })));
  }, [connected, toast]);
  useEffect(() => {
    if (cameraChat() === 'task') void recoverPhoto().then(p => p.length && setPhotos(x => mergeAttachments(x, p)));
  }, [setPhotos]);

  const where = project ?? projects?.[0]?.path ?? '';
  const add = async (pick: () => Promise<Attachment[]>) => {
    const picked = await pick();
    if (picked.length) setPhotos(p => mergeAttachments(p, picked));
  };

  const start = async () => {
    const prompt = text.trim();
    if ((!prompt && !photos.length) || !where || busy) return;
    if (listening) voice.cancel();
    setBusy(true);
    try {
      const images = await toPhoneImages(photos);
      const body = prompt || 'Look at this photo and do what it shows.';
      const at = when === 'tonight' ? reset : Date.now() + 3600_000;
      if (when === 'now') {
        const id = await newSession({ projectPath: where, text: body, images, mode });
        clearComposerDraft('task');
        haptic.success();
        router.dismissTo(`/desktop/${id}`);
      } else {
        await queueTask({ projectPath: where, text: body, images, at, mode });
        clearComposerDraft('task');
        haptic.success();
        toast.show({ title: tx('Queued on your desktop'), description: tx('Starts at {time}. Keep Neru open there.', { time: time(at) }) });
        router.dismissTo('/tasks');
      }
    } catch (err) {
      toast.show({ title: tx('Your desktop did not take the task'), description: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  };

  if (!connected)
    return (
      <View style={[s.center, { backgroundColor: c.bg }]}>
        <Icon name="desktop" size={28} color={c.sage} />
        <Text style={{ fontFamily: font.sans, fontSize: fs.base, color: c.secondary, textAlign: 'center', lineHeight: 22 }}>{tx('Your desktop is offline. Open Neru on your computer to give it a task.')}</Text>
      </View>
    );

  const whenLabel: Record<When, [string, string]> = {
    now: [tx('Now'), tx('Starts right away')],
    tonight: [tx('Tonight'), tx('{time}, after free daily quotas reset', { time: time(reset) })],
    hour: [tx('In an hour'), time(hourAt)],
  };

  return (
    <>
      <KeyboardAwareScrollView bottomOffset={96} style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.section, { color: c.muted }]}>{tx('WHAT TO DO')}</Text>
        <View style={[s.prompt, { backgroundColor: c.prompt, borderColor: listening ? c.mossAction : c.border }]}>
          <TextInput
            value={text}
            onChangeText={t => (listening && voice.edit(t), setText(t))}
            placeholder={listening ? tx('Listening…') : tx('Fix the login bug in this screenshot')}
            placeholderTextColor={c.muted}
            multiline
            accessibilityLabel={tx('Task')}
            style={{ flex: 1, minHeight: 96, fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.text, textAlignVertical: 'top' }}
          />
          {photos.length ? <MessageAttachments items={photos} onOpenImage={() => {}} /> : null}
          <View style={s.tools}>
            {([['mic', listening ? tx('Stop dictation') : tx('Dictate'), voice.toggle], ['camera', tx('Take a photo'), () => add(() => takePhoto('task'))], ['photo', tx('Add a photo'), () => add(() => pickPhotos('task'))]] as [IconName, string, () => void][]).map(([icon, label, onPress]) => (
              <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={[s.tool, { backgroundColor: icon === 'mic' && listening ? c.mossAction : c.surface3 }]}>
                <Icon name={icon} size={18} color={icon === 'mic' && listening ? c.onAction : c.text} />
              </Pressable>
            ))}
            {photos.length ? (
              <Pressable onPress={() => setPhotos([])} accessibilityRole="button" hitSlop={6} style={{ marginLeft: 'auto' }}>
                <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{tx('Remove photos')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <Text style={[s.section, { color: c.muted }]}>{tx('WHERE AND HOW')}</Text>
        <Pressable onPress={() => setSheet('project')} accessibilityRole="button" style={[s.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.label, { color: c.muted }]}>{tx('Project')}</Text>
            <Text numberOfLines={1} style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{projects === null ? tx('Loading…') : projects.find(p => p.path === where)?.name ?? tx('No projects yet')}</Text>
          </View>
          <Icon name="chevronDown" size={18} color={c.muted} />
        </Pressable>
        <Pressable onPress={() => setSheet('mode')} accessibilityRole="button" style={[s.row, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.label, { color: c.muted }]}>{tx('What Neru may do')}</Text>
            <Text numberOfLines={1} style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{modes.find(m => m.value === mode)?.label}</Text>
          </View>
          <Icon name="chevronDown" size={18} color={c.muted} />
        </Pressable>

        <Text style={[s.section, { color: c.muted }]}>{tx('WHEN')}</Text>
        <View style={{ gap: 8 }} accessibilityRole="radiogroup">
          {WHEN.map(w => (
            <Pressable key={w} onPress={() => (haptic.select(), setWhen(w))} accessibilityRole="radio" accessibilityState={{ checked: when === w }} style={[s.row, { backgroundColor: c.surface2, borderColor: when === w ? c.mossAction : c.border }]}>
              <Icon name={w === 'now' ? 'send' : w === 'tonight' ? 'moon' : 'clock'} size={18} color={when === w ? c.moss : c.muted} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: font.medium, fontSize: fs.base, color: c.text }}>{whenLabel[w][0]}</Text>
                <Text style={{ fontFamily: font.sans, fontSize: fs.xs, color: c.muted }}>{whenLabel[w][1]}</Text>
              </View>
              {when === w ? <Icon name="check" size={18} color={c.moss} /> : null}
            </Pressable>
          ))}
        </View>
        {when !== 'now' && mode === 'manual' ? (
          <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.muted, lineHeight: 20 }}>{tx('While you sleep, Ask me first stops at the first change. Your phone can approve it from the notification, or pick Edit files.')}</Text>
        ) : null}
        <ActionButton title={when === 'now' ? tx('Start on desktop') : tx('Queue task')} icon={when === 'now' ? 'send' : 'clock'} loading={busy} disabled={(!text.trim() && !photos.length) || !where} onPress={start} />
      </KeyboardAwareScrollView>

      <SelectSheet
        open={sheet === 'project'}
        onClose={() => setSheet(null)}
        title={tx('Project')}
        value={where}
        onChange={v => (setProject(v), setSheet(null))}
        options={(projects ?? []).map(p => ({ value: p.path, label: p.name, description: p.path }))}
      />
      <SelectSheet open={sheet === 'mode'} onClose={() => setSheet(null)} title={tx('What Neru may do')} value={mode} onChange={v => (setMode(v as AgentMode), setSheet(null))} options={modes} />
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  section: { fontFamily: font.medium, fontSize: fs.xs, marginTop: 12 },
  label: { fontFamily: font.medium, fontSize: fs.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP + 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  prompt: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tool: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
