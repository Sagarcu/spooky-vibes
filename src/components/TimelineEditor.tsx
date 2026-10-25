import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Slider from '@react-native-community/slider';
import { BackHandler, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Appbar, Banner, Chip, Dialog, FAB, Icon, IconButton, List, Portal, ProgressBar, SegmentedButtons, Snackbar, Switch, Text } from 'react-native-paper';
import { ColorWheel } from './ColorWheel';
import { Action, Caption, EmptyState, Field, Panel, Sheet, ui } from './ui';
import type { HueLight, HueLightGroup, TimelineAudioClip, TimelineEvent, TimelineSequence } from '../types/hue';
import { validateTimeline, type SequenceRunner } from '../services/sequences';
import { createAudioPreviewRunner, createSampleClip, deleteUnusedAudio, importAudioClip, type SampleSound } from '../services/timeline-audio';
import { moveTimelineAction, snappedTimelineTime } from '../services/timeline-drag';
import { colors as colorPresets, whites } from '../services/light-presets';
import { palette, radius, spacing } from '../theme';
import { useErrorNotification } from '../useErrorNotification';

const CELL = 52;
const ROW = 60;
const labelWidth = 100;
const format = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const precise = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const describe = (event: TimelineEvent, switchOnly = false) => {
  const transition = event.state.transitionTimeDeciseconds ?? 0;
  const timing = switchOnly ? '' : transition === 0 ? ' · instant' : ` · ${(transition / 10).toFixed(1)}s fade`;
  if (!event.state.on) return `Off${timing}`;
  const level = event.state.brightness === undefined ? 'On' : `${event.state.brightness}%`;
  if (event.state.colorTemperature !== undefined) return `${level} · ${whites.find(([, kelvin]) => kelvin === event.state.colorTemperature)?.[0] ?? `${event.state.colorTemperature} K`}${timing}`;
  if (event.state.hue !== undefined) return `${level} · ${colorPresets.find(([, hue]) => hue === event.state.hue)?.[0] ?? `${Math.round(event.state.hue / 65535 * 360)}° color`}${timing}`;
  return `${level}${timing}`;
};
const empty = (groupId: string): TimelineSequence => ({ id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: '', groupId, durationMs: 20_000, events: [], restoreAfterPlayback: false });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not complete timeline operation.';

type Props = {
  groups: HueLightGroup[];
  lights: HueLight[];
  timelines: TimelineSequence[];
  onSave: (sequence: TimelineSequence) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPreview: (sequence: TimelineSequence) => Promise<void>;
  onStopPreview: () => void;
  previewRunning: boolean;
  previewRestoring: boolean;
  playbackRunning: boolean;
  ambianceSequenceIds: string[];
  onLeavePreview: () => Promise<void>;
  onOpenAmbiance: () => void;
  onCreateGroup: () => void;
  onEditingChange: (active: boolean) => void;
};

type DraggableProps = {
  atMs: number;
  durationMs: number;
  clipDurationMs?: number;
  label: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
  onTap: () => void;
  onDrop: (atMs: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  disabled: boolean;
};

function DraggableItem(props: DraggableProps) {
  const current = useRef(props);
  current.current = props;
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !current.current.disabled && Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { current.current.onDraggingChange(true); },
    onPanResponderMove: (_, gesture) => { const item = current.current; setPreviewAt(snappedTimelineTime(item.atMs, gesture.dx, item.durationMs, CELL)); },
    onPanResponderRelease: (_, gesture) => {
      const item = current.current;
      const atMs = snappedTimelineTime(item.atMs, gesture.dx, item.durationMs, CELL);
      setPreviewAt(null);
      item.onDraggingChange(false);
      if (atMs !== item.atMs) item.onDrop(atMs);
    },
    onPanResponderTerminate: () => { setPreviewAt(null); current.current.onDraggingChange(false); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const position = previewAt ?? props.atMs;
  const clipWidth = props.clipDurationMs === undefined ? {} : { width: Math.max(0, Math.min(props.clipDurationMs, props.durationMs - position)) / 1000 * CELL };
  return <View {...responder.panHandlers} style={[props.style, { left: position / 1000 * CELL, zIndex: previewAt === null ? 1 : 5 }, clipWidth]}>
    <Pressable onPress={props.onTap} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={`${props.label}, starts ${format(previewAt ?? props.atMs)}. Drag to move or tap to edit.`} style={styles.dragTarget}>
      {props.children}
    </Pressable>
    {previewAt !== null && <Text style={styles.dragTime}>{format(previewAt)}</Text>}
  </View>;
}

export function TimelineEditor({ groups, lights, timelines, onSave, onDelete, onPreview, onStopPreview, previewRunning, previewRestoring, playbackRunning, ambianceSequenceIds, onLeavePreview, onOpenAmbiance, onCreateGroup, onEditingChange }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const expanded = windowWidth >= 1150;
  const [draft, setDraft] = useState<TimelineSequence | null>(null);
  const [duration, setDuration] = useState('20');
  const [editing, setEditing] = useState<TimelineEvent | null>(null);
  const [at, setAt] = useState('0');
  const [brightness, setBrightness] = useState(50);
  const [transition, setTransition] = useState(0);
  const [on, setOn] = useState(true);
  const [mode, setMode] = useState<'keep' | 'color' | 'white'>('keep');
  const [colorHue, setColorHue] = useState(6500);
  const [colorSaturation, setColorSaturation] = useState(254);
  const [temperature, setTemperature] = useState(2200);
  const [pickingColor, setPickingColor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draggingItem, setDraggingItem] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [audioLibrary, setAudioLibrary] = useState(false);
  const [chooseLamp, setChooseLamp] = useState(false);
  const [deleting, setDeleting] = useState<TimelineSequence | null>(null);
  const [error, setError] = useErrorNotification();
  const [saved, setSaved] = useState(false);
  const previewRef = useRef<SequenceRunner | null>(null);
  const [editingAudio, setEditingAudio] = useState<{ clip: TimelineAudioClip; track: 'background' | 'effect' } | null>(null);
  const [audioAt, setAudioAt] = useState('0');
  const [audioVolume, setAudioVolume] = useState('100');
  const draftRef = useRef(draft);
  const savedRef = useRef(timelines);
  const mountedRef = useRef(true);
  draftRef.current = draft;
  savedRef.current = timelines;
  const locked = previewRunning || saving || importing;
  const fail = (problem: unknown) => setError(errorText(problem));
  const editorActive = !!draft;
  useEffect(() => {
    onEditingChange(editorActive);
    return () => onEditingChange(false);
  }, [editorActive, onEditingChange]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewRef.current?.cancel();
      if (draftRef.current) deleteUnusedAudio([draftRef.current], savedRef.current);
    };
  }, []);
  const group = groups.find(item => item.id === draft?.groupId);
  const lanes = (group?.lightIds ?? []).map(id => lights.find(light => light.id === id)).filter((light): light is HueLight => !!light);
  const editingLight = lanes.find(light => light.id === editing?.lightId);
  const seconds = Math.min(120, Math.max(1, Math.ceil(Number(duration) || 1)));
  const timelineWidth = seconds * CELL + 56;
  const effectRows = new Map<string, number>();
  const rowEnds: number[] = [];
  for (const clip of [...(draft?.audioEffects ?? [])].sort((a, b) => a.atMs - b.atMs)) {
    let row = rowEnds.findIndex(end => end <= clip.atMs);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = clip.atMs + clip.durationMs;
    effectRows.set(clip.id, row);
  }
  const effectsHeight = Math.max(1, rowEnds.length) * ROW;
  const changeDraft = (next: TimelineSequence | null) => {
    previewRef.current?.cancel();
    previewRef.current = null;
    setPreviewing(null);
    if (draft) deleteUnusedAudio([draft], next ? [...timelines, next] : timelines);
    setDraft(next);
    setError(null);
  };
  const closeDraft = async () => {
    if (saving || importing || previewRestoring) return;
    await onLeavePreview();
    changeDraft(null);
    setEditing(null);
    setEditingAudio(null);
    setAudioLibrary(false);
  };
  useEffect(() => {
    if (!draft) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { void closeDraft(); return true; });
    return () => listener.remove();
  }, [draft, saving, importing, previewRestoring]);
  const editClip = (clip: TimelineAudioClip, track: 'background' | 'effect') => {
    setAudioLibrary(false);
    setError(null);
    setEditingAudio({ clip, track });
    setAudioAt(String(clip.atMs / 1000));
    setAudioVolume(String(Math.round(clip.volume * 100)));
  };
  const previewAudio = (id: string, uri?: string, sound: SampleSound = 'knock') => {
    if (previewRef.current) {
      previewRef.current.cancel(); previewRef.current = null; setPreviewing(null);
      return;
    }
    setError(null);
    const active = createAudioPreviewRunner(uri, sound);
    previewRef.current = active;
    setPreviewing(id);
    void (async () => {
      try { await active.done; }
      catch (problem) { if (previewRef.current === active) fail(problem); }
      finally { if (previewRef.current === active) { previewRef.current = null; setPreviewing(null); } }
    })();
  };
  const addSample = (sound: SampleSound) => {
    const current = draftRef.current;
    if (!current || locked) return;
    if ((current.audioEffects?.length ?? 0) >= 100) { fail(new Error('A sequence can have up to 100 sound effects.')); return; }
    try {
      const clip = createSampleClip(sound);
      setDraft({ ...current, audioEffects: [...(current.audioEffects ?? []), clip] });
      editClip(clip, 'effect');
    } catch (problem) { fail(problem); }
  };
  const importClip = async (track: 'background' | 'effect') => {
    if (!draft || locked) return;
    setImporting(true);
    setError(null);
    try {
      if (track === 'effect' && (draft.audioEffects?.length ?? 0) >= 100) throw new Error('A sequence can have up to 100 sound effects.');
      const clip = await importAudioClip();
      if (!clip) return;
      const current = draftRef.current;
      if (!mountedRef.current || current?.id !== draft.id) {
        deleteUnusedAudio([{ ...draft, audioEffects: [clip] }], savedRef.current);
        return;
      }
      const next = track === 'background' ? { ...current, backgroundAudio: clip } : { ...current, audioEffects: [...(current.audioEffects ?? []), clip] };
      changeDraft(next);
      editClip(clip, track);
    } catch (problem) { fail(problem); }
    finally { setImporting(false); }
  };
  const dismissAudio = () => {
    previewRef.current?.cancel(); previewRef.current = null; setPreviewing(null);
    setEditingAudio(null);
  };
  const applyAudio = () => {
    if (!draft || !editingAudio) return;
    const time = Number(audioAt), volume = Number(audioVolume);
    if (!Number.isFinite(time) || time < 0 || !Number.isInteger(time * 10) || time * 1000 >= draft.durationMs) { fail(new Error(`Start must be from 0 to less than ${format(draft.durationMs)}, in 0.1s increments.`)); return; }
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) { fail(new Error('Volume must be from 0 to 100%.')); return; }
    const clip = { ...editingAudio.clip, atMs: Math.round(time * 1000), volume: volume / 100 };
    setDraft(editingAudio.track === 'background' ? { ...draft, backgroundAudio: clip } : { ...draft, audioEffects: (draft.audioEffects ?? []).map(item => item.id === clip.id ? clip : item) });
    dismissAudio();
  };
  const removeAudio = () => {
    if (!draft || !editingAudio) return;
    changeDraft(editingAudio.track === 'background' ? { ...draft, backgroundAudio: undefined } : { ...draft, audioEffects: (draft.audioEffects ?? []).filter(item => item.id !== editingAudio.clip.id) });
    dismissAudio();
  };
  const dropAction = (eventId: string, atMs: number) => {
    try { if (draftRef.current) setDraft(moveTimelineAction(draftRef.current, eventId, atMs)); }
    catch (problem) { fail(problem); }
  };
  const dropAudio = (clipId: string, atMs: number) => {
    setDraft(current => current ? { ...current,
      backgroundAudio: current.backgroundAudio?.id === clipId ? { ...current.backgroundAudio, atMs } : current.backgroundAudio,
      audioEffects: current.audioEffects?.map(clip => clip.id === clipId ? { ...clip, atMs } : clip),
    } : current);
  };
  const open = (event: TimelineEvent) => {
    setError(null);
    setEditing(event); setAt(String(event.atMs / 1000)); setOn(event.state.on);
    setBrightness(event.state.brightness ?? 50);
    setTransition(event.state.transitionTimeDeciseconds ?? 0);
    setMode(event.state.hue !== undefined ? 'color' : event.state.colorTemperature !== undefined ? 'white' : 'keep');
    setColorHue(event.state.hue ?? 6500); setColorSaturation(event.state.saturation ?? 254);
    setTemperature(event.state.colorTemperature ?? 2200);
  };
  const add = (lightId: string, atMs: number) => {
    setChooseLamp(false);
    open({ id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`, lightId, atMs, state: { on: true, brightness: 50, transitionTimeDeciseconds: 0 } });
  };
  const commit = () => {
    if (!draft || !editing) return;
    const time = Number(at);
    if (!Number.isFinite(time) || time < 0 || !Number.isInteger(time * 10) || time * 1000 >= draft.durationMs) { fail(new Error(`Time must be from 0 to less than ${format(draft.durationMs)}, in 0.1s increments.`)); return; }
    const atMs = Math.round(time * 1000);
    if (on && (!Number.isInteger(brightness) || brightness < 1 || brightness > 100)) { fail(new Error('Brightness must be between 1 and 100%.')); return; }
    if (draft.events.some(item => item.id !== editing.id && item.lightId === editing.lightId && item.atMs === atMs)) { fail(new Error('There is already an action for this lamp at that time.')); return; }
    const switchOnly = editingLight?.kind === 'onoff-plug';
    const state: TimelineEvent['state'] = !on ? { on: false } : switchOnly ? { on: true } : { on: true, brightness };
    if (!switchOnly) state.transitionTimeDeciseconds = transition;
    if (on && mode === 'color' && editingLight?.colorCapable) { state.hue = colorHue; state.saturation = colorSaturation; }
    if (on && mode === 'white' && editingLight?.colorTemperatureCapable) state.colorTemperature = temperature;
    const event: TimelineEvent = { ...editing, atMs, state };
    setDraft({ ...draft, events: [...draft.events.filter(item => item.id !== event.id), event] });
    setEditing(null);
    setError(null);
  };
  const save = async () => {
    if (!draft || locked) return;
    setError(null);
    try {
      const checked = validateTimeline({ ...draft, durationMs: Number(duration) * 1000 }, group?.lightIds ?? [], lights);
      setSaving(true);
      await onSave(checked);
      setDraft(checked); setDuration(String(checked.durationMs / 1000)); setSaved(true);
    } catch (problem) { fail(problem); }
    finally { setSaving(false); }
  };
  const startPreview = async () => {
    if (!draft || locked || playbackRunning) return;
    setError(null);
    try {
      const checked = validateTimeline({ ...draft, name: draft.name.trim() || 'Preview', durationMs: Number(duration) * 1000 }, group?.lightIds ?? [], lights);
      previewRef.current?.cancel(); previewRef.current = null; setPreviewing(null);
      await onPreview(checked);
    } catch (problem) { fail(problem); }
  };
  const select = (sequence: TimelineSequence) => {
    changeDraft({ ...sequence, events: [...sequence.events], audioEffects: [...(sequence.audioEffects ?? [])] });
    setDuration(String(sequence.durationMs / 1000));
  };
  const audioLane = (track: 'background' | 'effect', items: TimelineAudioClip[]) => <View style={[styles.lane, track === 'effect' && { height: effectsHeight }]}>
    {Array.from({ length: seconds }, (_, i) => <View key={i} style={[styles.cell, track === 'effect' && { height: effectsHeight }]} />)}
    {items.filter(clip => clip.atMs < seconds * 1000).map(clip => <DraggableItem key={clip.id} disabled={locked} atMs={clip.atMs} durationMs={draft?.durationMs ?? 1000} clipDurationMs={clip.durationMs} label={`${clip.name}, duration ${precise(clip.durationMs)}`}
      onTap={() => editClip(clip, track)} onDrop={atMs => dropAudio(clip.id, atMs)} onDraggingChange={setDraggingItem}
      style={[styles.audioBar, { top: 6 + (track === 'effect' ? (effectRows.get(clip.id) ?? 0) * ROW : 0) }]}>
      <Text numberOfLines={1} style={styles.audioText}>{clip.name} · {precise(clip.durationMs)}</Text>
    </DraggableItem>)}
  </View>;

  const actionControls = <View style={ui.stack}>
    <Text variant="titleLarge">{editingLight?.name ?? 'Unavailable lamp'}</Text>
    {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    <Field label="Start · seconds (0.1s precision)" keyboardType="decimal-pad" value={at} onChangeText={setAt} />
    <SegmentedButtons value={on ? 'on' : 'off'} onValueChange={value => setOn(value === 'on')} buttons={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
    {editingLight?.kind !== 'onoff-plug' && <>
      <Text variant="titleMedium">Fade · {transition === 0 ? 'Instant' : `${(transition / 10).toFixed(1)}s`}</Text>
      <Slider accessibilityLabel="Action transition duration" minimumValue={0} maximumValue={100} step={1} value={transition} onValueChange={setTransition} minimumTrackTintColor={palette.primary} thumbTintColor={palette.primary} style={styles.slider} />
    </>}
    {on && editingLight?.kind !== 'onoff-plug' && <>
      <Text variant="titleMedium">Brightness · {brightness}%</Text>
      <Slider accessibilityLabel="Action brightness" minimumValue={1} maximumValue={100} step={1} value={brightness} onValueChange={setBrightness} minimumTrackTintColor={palette.primary} thumbTintColor={palette.primary} style={styles.slider} />
      <View style={ui.wrap}>
        <Chip selected={mode === 'keep'} onPress={() => setMode('keep')}>Keep current</Chip>
        {editingLight?.colorCapable && <Chip selected={mode === 'color'} onPress={() => setMode('color')}>RGB color</Chip>}
        {editingLight?.colorTemperatureCapable && <Chip selected={mode === 'white'} onPress={() => setMode('white')}>White preset</Chip>}
      </View>
      {mode === 'color' && editingLight?.colorCapable && <>
        <Text variant="titleMedium">Color presets</Text><View style={ui.wrap}>{colorPresets.map(([name, hue]) => <Chip key={name} selected={colorHue === hue && colorSaturation === 254} onPress={() => { setColorHue(hue); setColorSaturation(254); }}>{name}</Chip>)}</View>
        <ColorWheel hue={colorHue / 65535 * 360} saturation={colorSaturation / 254 * 100} brightness={brightness} maxSize={220}
          onGestureStart={() => setPickingColor(true)} onGestureEnd={() => setPickingColor(false)}
          onChange={(hue, saturation) => { setColorHue(Math.round(hue / 360 * 65535)); setColorSaturation(Math.round(saturation / 100 * 254)); }} />
      </>}
      {mode === 'white' && editingLight?.colorTemperatureCapable && <View style={ui.wrap}>{whites.map(([name, kelvin]) => <Chip key={name} selected={temperature === kelvin} onPress={() => setTemperature(kelvin)}>{name} · {kelvin} K</Chip>)}</View>}
    </>}
    <Action onPress={commit}>Apply action</Action>
    {draft?.events.some(event => event.id === editing?.id) && <Action mode="text" textColor={palette.error} onPress={() => { setDraft(current => current ? { ...current, events: current.events.filter(event => event.id !== editing?.id) } : current); setEditing(null); }}>Remove action</Action>}
  </View>;

  return <View style={ui.flex}>
    <Appbar.Header statusBarHeight={0} style={styles.header}>
      {draft && <Appbar.BackAction accessibilityLabel="Back to sequence library" disabled={saving || importing || previewRestoring} onPress={() => { void closeDraft(); }} />}
      <Appbar.Content title={draft ? 'Edit sequence' : 'Your sequences'} />
      {draft && <Action mode="text" disabled={locked || ambianceSequenceIds.includes(draft.id)} loading={saving} onPress={() => { void save(); }}>Save</Action>}
    </Appbar.Header>
    <Banner visible={!!error} icon="alert-circle-outline" actions={[{ label: 'Dismiss', onPress: () => setError(null) }]}><Text accessibilityRole="alert">{error}</Text></Banner>
    {importing && <ProgressBar indeterminate />}
    {!draft ? <ScrollView contentContainerStyle={styles.library}>
      <Panel tonal><Caption>Candlelight and Halloween storm are reusable modes in Ambiance.</Caption><Action mode="text" onPress={onOpenAmbiance}>Open Ambiance</Action></Panel>
      <Text variant="titleLarge" accessibilityRole="header">Your timelines</Text>
      {!timelines.length && <EmptyState icon="creation-outline" title="No custom sequences" description={groups.length ? undefined : 'Create a group first.'}
        action={groups.length ? 'New sequence' : 'Create a group'} onPress={groups.length ? () => { changeDraft(empty(groups[0]?.id ?? '')); setDuration('20'); } : onCreateGroup} />}
      {timelines.map(item => <Panel key={item.id}>
        <View style={ui.row}><View style={[styles.art, styles.timelineArt]}><Icon source="waveform" size={24} color={palette.primary} /></View><View style={ui.flex}><Text variant="titleMedium">{item.name}</Text><Caption>{format(item.durationMs)} · {groups.find(g => g.id === item.groupId)?.name ?? 'Group missing'}</Caption></View>
          <IconButton icon="delete-outline" accessibilityLabel={`Delete ${item.name}`} disabled={saving || previewRunning || playbackRunning || ambianceSequenceIds.includes(item.id)} onPress={() => setDeleting(item)} />
        </View>
        <Caption>{item.events.length} light actions · {(item.backgroundAudio ? 1 : 0) + (item.audioEffects?.length ?? 0)} audio clips</Caption>
        {ambianceSequenceIds.includes(item.id) && <Caption>Running in Ambiance. Stop it there before saving changes or deleting.</Caption>}
        <View style={ui.wrap}><Chip>{item.restoreAfterPlayback ? 'Restore after playback' : 'Keep final lamp state'}</Chip><Action mode="text" onPress={() => select(item)}>Edit →</Action></View>
      </Panel>)}
      {!!groups.length && <FAB icon="plus" label="New sequence" style={styles.fab} onPress={() => { changeDraft(empty(groups[0]?.id ?? '')); setDuration('20'); }} />}
    </ScrollView> : <View style={styles.workspace}><View style={ui.flex}>
      <ScrollView style={ui.flex} contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
        {ambianceSequenceIds.includes(draft.id) && <Caption>Stop this sequence in Ambiance before saving changes. You can still preview this draft.</Caption>}
        <Field label="Sequence name" value={draft.name} onChangeText={name => setDraft({ ...draft, name })} maxLength={60} editable={!locked} />
        <Text variant="titleMedium">Group</Text>
        {!groups.length && <Caption>Create a group in Groups first.</Caption>}
        {!group && !!draft.groupId && <Text style={styles.error}>This group was deleted. Select another group to continue.</Text>}
        <View style={ui.wrap}>{groups.map(item => <Chip key={item.id} selected={draft.groupId === item.id} disabled={locked} onPress={() => setDraft({ ...draft, groupId: item.id, events: item.id === draft.groupId ? draft.events : [] })}>{item.name}</Chip>)}</View>
        <Field label="Duration · 1–120 seconds" value={duration} onChangeText={value => { setDuration(value); const n = Number(value); if (Number.isInteger(n) && n >= 1 && n <= 120) setDraft({ ...draft, durationMs: n * 1000 }); }}
          keyboardType="number-pad" maxLength={3} editable={!locked} />
        <Text variant="titleLarge" accessibilityRole="header">Timeline</Text>
        {lanes.length > 0 ? <View style={styles.timeline}>
          <View style={styles.labels}><View style={styles.axisLabel}><Caption>Time</Caption></View>{lanes.map(light => <View key={light.id} style={styles.lampLabel}><Text variant="labelMedium">{light.name}</Text></View>)}<View style={styles.lampLabel}><Text variant="labelMedium">Background</Text></View><View style={[styles.lampLabel, { height: effectsHeight }]}><Text variant="labelMedium">Effects</Text></View></View>
          <ScrollView horizontal scrollEnabled={!draggingItem} style={ui.flex} showsHorizontalScrollIndicator>
            <View style={{ width: timelineWidth }}><View style={styles.axis}>{Array.from({ length: seconds }, (_, i) => <View key={i} style={styles.axisCell}><Text variant="labelSmall" style={ui.muted}>{i}s</Text></View>)}</View>
              {lanes.map(light => <View key={light.id} style={styles.lane}>
                {Array.from({ length: seconds }, (_, i) => <Pressable key={i} style={styles.cell} disabled={locked} accessibilityRole="button" accessibilityLabel={`Add ${light.name} action at ${i} seconds`} onPress={() => add(light.id, i * 1000)} />)}
                {draft.events.filter(event => event.lightId === light.id && event.atMs < seconds * 1000).map(event => <DraggableItem key={event.id} disabled={locked} atMs={event.atMs} durationMs={draft.durationMs} label={`${light.name} action`}
                  onTap={() => open(event)} onDrop={atMs => dropAction(event.id, atMs)} onDraggingChange={setDraggingItem}
                  style={[styles.marker, !event.state.on && styles.offMarker]}>
                  <Text numberOfLines={1} style={[styles.markerText, !event.state.on && styles.offText]}>{event.state.on ? event.state.hue !== undefined ? 'COLOR' : event.state.colorTemperature !== undefined ? 'WHITE' : light.kind === 'onoff-plug' ? 'ON' : `${event.state.brightness}%` : 'OFF'}</Text>
                </DraggableItem>)}
              </View>)}
              {audioLane('background', draft.backgroundAudio ? [draft.backgroundAudio] : [])}
              {audioLane('effect', draft.audioEffects ?? [])}
            </View>
          </ScrollView>
        </View> : <Panel><Caption>No available lamps in this group. Reconnect your bridge or choose another group.</Caption></Panel>}
        <View style={ui.wrap}><Action mode="outlined" icon="plus" disabled={locked || !lanes.length} onPress={() => setChooseLamp(true)}>Light action</Action><Action mode="outlined" icon="plus" disabled={locked} onPress={() => setAudioLibrary(true)}>Audio</Action></View>
        <Panel><View style={ui.row}><View style={ui.flex}><Text variant="titleMedium">Restore after Home playback</Text><Caption>{draft.restoreAfterPlayback ? 'On · restore previous lamp settings' : 'Off · keep final lamp state'}</Caption></View><Switch accessibilityLabel="Restore lamps after Home playback" value={draft.restoreAfterPlayback ?? false} disabled={locked} onValueChange={value => setDraft({ ...draft, restoreAfterPlayback: value })} /></View></Panel>
        <Text variant="titleLarge" accessibilityRole="header">Actions</Text>
        {!draft.events.length && <Caption>No actions</Caption>}
        {[...draft.events].sort((a, b) => a.atMs - b.atMs).map(event => <List.Item key={event.id} accessibilityRole="button" accessibilityLabel={`Edit ${lanes.find(light => light.id === event.lightId)?.name ?? 'Unavailable lamp'} action at ${format(event.atMs)}`} title={`${format(event.atMs)} · ${lanes.find(light => light.id === event.lightId)?.name ?? 'Unavailable lamp'}`}
          description={describe(event, lanes.find(light => light.id === event.lightId)?.kind === 'onoff-plug')} descriptionNumberOfLines={4}
          disabled={locked} onPress={() => open(event)} right={props => <List.Icon {...props} icon="pencil-outline" />} />)}
        <Text variant="titleLarge" accessibilityRole="header">Audio clips</Text>
        {[...(draft.backgroundAudio ? [{ clip: draft.backgroundAudio, track: 'background' as const }] : []), ...(draft.audioEffects ?? []).map(clip => ({ clip, track: 'effect' as const }))].map(({ clip, track }) => <List.Item key={clip.id} accessibilityRole="button" accessibilityLabel={`Edit audio ${clip.name} at ${format(clip.atMs)}`} title={clip.name} description={`${track === 'background' ? 'Background' : 'Effect'} · ${format(clip.atMs)} · ${precise(clip.durationMs)}`}
          disabled={locked} onPress={() => editClip(clip, track)} right={props => <List.Icon {...props} icon="pencil-outline" />} />)}
      </ScrollView>
      <View style={styles.previewBar}>
        <Action icon={previewRunning ? 'stop' : 'play-outline'} loading={previewRestoring} disabled={previewRestoring || !previewRunning && (saving || importing || playbackRunning)} onPress={previewRunning ? onStopPreview : () => { void startPreview(); }}>
          {previewRestoring ? 'Restoring lamps...' : previewRunning ? 'Stop preview & restore lamps' : 'Preview lights + audio'}
        </Action>
        {playbackRunning && <Caption>Stop the Home sequence before previewing.</Caption>}
      </View></View>
      {expanded && editing && <ScrollView style={styles.inspector} contentContainerStyle={styles.inspectorContent} scrollEnabled={!pickingColor} keyboardShouldPersistTaps="handled">
        <View style={ui.between}><Text variant="labelLarge">SELECTED ACTION</Text><IconButton icon="close" accessibilityLabel="Close action inspector" onPress={() => setEditing(null)} /></View>{actionControls}
      </ScrollView>}
    </View>}
    <Sheet visible={!!editing && !expanded} title={draft?.events.some(event => event.id === editing?.id) ? 'Edit light action' : 'Add light action'} onDismiss={() => { setEditing(null); setPickingColor(false); }} scrollEnabled={!pickingColor}>{actionControls}</Sheet>
    <Sheet visible={chooseLamp} title="Choose a lamp" onDismiss={() => setChooseLamp(false)}>
      {lanes.map(light => <List.Item key={light.id} accessibilityRole="button" accessibilityLabel={`Add action for ${light.name}`} title={light.name} onPress={() => add(light.id, 0)} right={props => <List.Icon {...props} icon="plus" />} />)}
    </Sheet>
    <Sheet visible={audioLibrary} title="Add audio" onDismiss={() => { if (!importing) { setAudioLibrary(false); previewRef.current?.cancel(); previewRef.current = null; setPreviewing(null); } }}>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Action mode="outlined" disabled={locked} loading={importing} onPress={() => { void importClip('background'); }}>{draft?.backgroundAudio ? 'Replace background' : 'Import background'}</Action>
      <Action mode="outlined" disabled={locked} onPress={() => { void importClip('effect'); }}>Import effect</Action>
      <Text variant="titleLarge">Built-in sounds</Text>
      {(['knock', 'chime'] as const).map(sound => <Panel key={sound}>
        <Text variant="titleMedium">{sound === 'knock' ? 'Creepy knocks' : 'Eerie chime'}</Text>
        <View style={ui.wrap}><Action mode="text" disabled={locked || !!previewing && previewing !== `sample-${sound}`} onPress={() => previewAudio(`sample-${sound}`, undefined, sound)}>{previewing === `sample-${sound}` ? 'Stop sound' : 'Hear sound'}</Action><Action mode="outlined" disabled={locked} onPress={() => addSample(sound)}>Add effect</Action></View>
      </Panel>)}
    </Sheet>
    <Sheet visible={!!editingAudio} title={editingAudio?.track === 'background' ? 'Background audio' : 'Sound effect'} onDismiss={dismissAudio}>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Text variant="titleLarge">{editingAudio?.clip.name}</Text><Caption>{editingAudio ? precise(editingAudio.clip.durationMs) : ''}</Caption>
      {editingAudio && <Action mode="outlined" disabled={!!previewing && previewing !== editingAudio.clip.id} onPress={() => previewAudio(editingAudio.clip.id, editingAudio.clip.uri)}>{previewing === editingAudio.clip.id ? 'Stop clip preview' : 'Preview clip · no lights'}</Action>}
      <Field label="Start · seconds (0.1s precision)" keyboardType="decimal-pad" value={audioAt} onChangeText={setAudioAt} />
      <Field label="Volume · 0–100%" keyboardType="number-pad" value={audioVolume} onChangeText={setAudioVolume} />
      <Action onPress={applyAudio}>Apply clip</Action><Action mode="text" textColor={palette.error} onPress={removeAudio}>Remove clip</Action>
    </Sheet>
    <Portal><Dialog visible={!!deleting} dismissable={!saving} onDismiss={() => setDeleting(null)}>
      <Dialog.Title>Delete sequence?</Dialog.Title><Dialog.Content style={ui.stack}><Text>Delete {deleting?.name} and its unused audio from this device? This cannot be undone.</Text>{error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}</Dialog.Content>
      <Dialog.Actions><Action mode="text" disabled={saving} onPress={() => setDeleting(null)}>Cancel</Action><Action mode="text" textColor={palette.error} disabled={saving} onPress={() => {
        if (!deleting) return;
        setSaving(true);
        void onDelete(deleting.id).then(() => setDeleting(null)).catch(fail).finally(() => setSaving(false));
      }}>Delete</Action></Dialog.Actions>
    </Dialog></Portal>
    <Snackbar visible={saved} onDismiss={() => setSaved(false)} action={{ label: 'Dismiss', onPress: () => setSaved(false) }}>Sequence saved.</Snackbar>
  </View>;
}

const styles = StyleSheet.create({
  header: { backgroundColor: palette.background },
  library: { padding: spacing.xl, gap: spacing.xl, width: '100%', maxWidth: 800, alignSelf: 'center', paddingBottom: spacing.xxl },
  editor: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl, width: '100%', maxWidth: 1000, alignSelf: 'center' },
  workspace: { flex: 1, flexDirection: 'row' },
  previewBar: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, backgroundColor: palette.background, gap: spacing.sm },
  inspector: { width: 340, flexGrow: 0, backgroundColor: palette.raised },
  inspectorContent: { padding: spacing.xl, gap: spacing.lg },
  art: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: palette.high, justifyContent: 'center', alignItems: 'center' },
  warmArt: { backgroundColor: palette.raised },
  timelineArt: { width: 44, height: 44 },
  fab: { alignSelf: 'flex-end', backgroundColor: palette.high },
  timeline: { flexDirection: 'row', borderWidth: 1, borderColor: palette.high, borderRadius: radius.md, overflow: 'hidden' },
  labels: { width: labelWidth, backgroundColor: palette.surface },
  axisLabel: { height: 36, padding: spacing.sm, justifyContent: 'center' },
  lampLabel: { height: ROW, padding: spacing.sm, justifyContent: 'center', borderTopWidth: 1, borderColor: palette.high },
  axis: { height: 36, flexDirection: 'row', backgroundColor: palette.surface },
  axisCell: { width: CELL, justifyContent: 'center', paddingLeft: spacing.xs },
  lane: { height: ROW, flexDirection: 'row', borderTopWidth: 1, borderColor: palette.high },
  cell: { width: CELL, height: ROW, borderRightWidth: 1, borderColor: palette.high },
  marker: { position: 'absolute', top: 6, width: 76, height: 48, borderRadius: radius.sm, backgroundColor: palette.primary, paddingHorizontal: spacing.xs },
  offMarker: { backgroundColor: palette.high, borderWidth: 1, borderColor: palette.outline },
  markerText: { fontSize: 11, color: palette.onPrimary, fontWeight: '700' },
  offText: { color: palette.text },
  dragTarget: { flex: 1, justifyContent: 'center', overflow: 'hidden' },
  dragTime: { position: 'absolute', bottom: '100%', left: 0, color: palette.text, backgroundColor: palette.surface, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  audioBar: { position: 'absolute', height: 48, borderRadius: radius.sm, backgroundColor: palette.audio, paddingHorizontal: spacing.xs, justifyContent: 'center' },
  audioText: { fontSize: 11, color: palette.onAudio, fontWeight: '700' },
  slider: { minHeight: 48 },
  error: { color: palette.error },
});
