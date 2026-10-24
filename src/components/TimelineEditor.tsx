import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Slider from '@react-native-community/slider';
import { Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { ColorWheel } from './ColorWheel';
import type { HueLight, HueLightGroup, TimelineAudioClip, TimelineEvent, TimelineSequence } from '../types/hue';
import { validateTimeline, type SequenceRunner } from '../services/sequences';
import { createAudioPreviewRunner, createSampleClip, deleteUnusedAudio, importAudioClip, type SampleSound } from '../services/timeline-audio';
import { moveTimelineAction, snappedTimelineTime } from '../services/timeline-drag';
import { colors as colorPresets, whites } from '../services/light-presets';

const CELL = 48;
const ROW = 60;
const labelWidth = 104;
const colors = { panel: '#211b2e', dark: '#17121f', text: '#f8f2ff', muted: '#b9adc8', orange: '#ff7b22', purple: '#a96bff' };
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
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not save timeline.';

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
};

function DraggableItem(props: DraggableProps) {
  const current = useRef(props);
  current.current = props;
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { current.current.onDraggingChange(true); },
    onPanResponderMove: (_, gesture) => {
      const item = current.current;
      setPreviewAt(snappedTimelineTime(item.atMs, gesture.dx, item.durationMs, CELL));
    },
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
    <Pressable onPress={props.onTap} accessibilityRole="button" accessibilityLabel={`${props.label}, starts ${format(previewAt ?? props.atMs)}. Drag to move or tap to edit.`} style={styles.dragTarget}>
      {props.children}
    </Pressable>
    {previewAt !== null && <Text style={styles.dragTime}>{format(previewAt)}</Text>}
  </View>;
}

export function TimelineEditor({ groups, lights, timelines, onSave, onDelete, onPreview, onStopPreview, previewRunning, previewRestoring }: Props) {
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
  const previewRef = useRef<SequenceRunner | null>(null);
  const [editingAudio, setEditingAudio] = useState<{ clip: TimelineAudioClip; track: 'background' | 'effect' } | null>(null);
  const [audioAt, setAudioAt] = useState('0');
  const [audioVolume, setAudioVolume] = useState('100');
  const draftRef = useRef(draft);
  const savedRef = useRef(timelines);
  const mountedRef = useRef(true);
  draftRef.current = draft;
  savedRef.current = timelines;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; previewRef.current?.cancel(); if (draftRef.current) deleteUnusedAudio([draftRef.current], savedRef.current); };
  }, []);
  const group = groups.find(item => item.id === draft?.groupId);
  const lanes = (group?.lightIds ?? []).map(id => lights.find(light => light.id === id)).filter((light): light is HueLight => !!light);
  const editingLight = lanes.find(light => light.id === editing?.lightId);
  const seconds = Math.min(120, Math.max(1, Math.ceil(Number(duration) || 1)));
  const width = seconds * CELL + 56;
  const effectRows = new Map<string, number>();
  const rowEnds: number[] = [];
  for (const clip of [...(draft?.audioEffects ?? [])].sort((a, b) => a.atMs - b.atMs)) {
    let row = rowEnds.findIndex(end => end <= clip.atMs);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = clip.atMs + clip.durationMs;
    effectRows.set(clip.id, row);
  }
  const effectsHeight = Math.max(1, rowEnds.length) * ROW;

  const changeDraft = (next: TimelineSequence) => {
    if (draft) deleteUnusedAudio([draft], [...timelines, next]);
    setDraft(next);
  };
  const editClip = (clip: TimelineAudioClip, track: 'background' | 'effect') => {
    setEditingAudio({ clip, track }); setAudioAt(String(clip.atMs / 1000)); setAudioVolume(String(Math.round(clip.volume * 100)));
  };
  const previewAudio = (id: string, uri?: string, sound: SampleSound = 'knock') => {
    if (previewRef.current) {
      previewRef.current.cancel(); previewRef.current = null; setPreviewing(null);
      return;
    }
    const active = createAudioPreviewRunner(uri, sound);
    previewRef.current = active;
    setPreviewing(id);
    void (async () => {
      try { await active.done; }
      catch (error) { if (previewRef.current === active) Alert.alert('Audio preview', errorText(error)); }
      finally { if (previewRef.current === active) { previewRef.current = null; setPreviewing(null); } }
    })();
  };
  const addSample = (sound: SampleSound) => {
    const current = draftRef.current;
    if (!current || importing || saving) return;
    if ((current.audioEffects?.length ?? 0) >= 100) { Alert.alert('Audio', 'A sequence can have up to 100 sound effects.'); return; }
    try {
      const clip = createSampleClip(sound);
      setDraft({ ...current, audioEffects: [...(current.audioEffects ?? []), clip] });
      editClip(clip, 'effect');
    } catch (error) { Alert.alert('Audio', errorText(error)); }
  };
  const importClip = async (track: 'background' | 'effect') => {
    if (!draft || importing || previewRunning) return;
    setImporting(true);
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
    } catch (error) { Alert.alert('Audio', errorText(error)); }
    finally { setImporting(false); }
  };
  const applyAudio = () => {
    if (!draft || !editingAudio) return;
    const time = Number(audioAt), volume = Number(audioVolume);
    if (!Number.isFinite(time) || time < 0 || !Number.isInteger(time * 10) || time * 1000 >= draft.durationMs) { Alert.alert('Audio', `Start must be from 0 to less than ${format(draft.durationMs)}, in 0.1s increments.`); return; }
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) { Alert.alert('Audio', 'Volume must be from 0 to 100%.'); return; }
    const clip = { ...editingAudio.clip, atMs: Math.round(time * 1000), volume: volume / 100 };
    setDraft(editingAudio.track === 'background' ? { ...draft, backgroundAudio: clip } : { ...draft, audioEffects: (draft.audioEffects ?? []).map(item => item.id === clip.id ? clip : item) });
    setEditingAudio(null);
  };
  const removeAudio = () => {
    if (!draft || !editingAudio) return;
    changeDraft(editingAudio.track === 'background' ? { ...draft, backgroundAudio: undefined } : { ...draft, audioEffects: (draft.audioEffects ?? []).filter(item => item.id !== editingAudio.clip.id) });
    setEditingAudio(null);
  };
  const dropAction = (eventId: string, atMs: number) => {
    try {
      if (draftRef.current) setDraft(moveTimelineAction(draftRef.current, eventId, atMs));
    } catch (error) { Alert.alert('Timeline', errorText(error)); }
  };
  const dropAudio = (clipId: string, atMs: number) => {
    setDraft(current => current ? {
      ...current,
      backgroundAudio: current.backgroundAudio?.id === clipId ? { ...current.backgroundAudio, atMs } : current.backgroundAudio,
      audioEffects: current.audioEffects?.map(clip => clip.id === clipId ? { ...clip, atMs } : clip),
    } : current);
  };

  const open = (event: TimelineEvent) => {
    setEditing(event); setAt(String(event.atMs / 1000)); setOn(event.state.on);
    setBrightness(event.state.brightness ?? 50);
    setTransition(event.state.transitionTimeDeciseconds ?? 0);
    setMode(event.state.hue !== undefined ? 'color' : event.state.colorTemperature !== undefined ? 'white' : 'keep');
    setColorHue(event.state.hue ?? 6500); setColorSaturation(event.state.saturation ?? 254);
    setTemperature(event.state.colorTemperature ?? 2200);
  };
  const add = (lightId: string, atMs: number) => open({ id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`, lightId, atMs, state: { on: true, brightness: 50, transitionTimeDeciseconds: 0 } });
  const commit = () => {
    if (!draft || !editing) return;
    const time = Number(at);
    const level = brightness;
    if (!Number.isFinite(time) || time < 0 || !Number.isInteger(time * 10) || time * 1000 >= draft.durationMs) { Alert.alert('Timeline', `Time must be from 0 to less than ${format(draft.durationMs)}, in 0.1s increments.`); return; }
    const atMs = Math.round(time * 1000);
    if (on && (!Number.isInteger(level) || level < 1 || level > 100)) { Alert.alert('Timeline', 'Brightness must be between 1 and 100%.'); return; }
    if (draft.events.some(item => item.id !== editing.id && item.lightId === editing.lightId && item.atMs === atMs)) { Alert.alert('Timeline', 'There is already an action for this lamp at that time.'); return; }
    const switchOnly = editingLight?.kind === 'onoff-plug';
    const state: TimelineEvent['state'] = !on ? { on: false } : switchOnly ? { on: true } : { on: true, brightness: level };
    if (!switchOnly) state.transitionTimeDeciseconds = transition;
    if (on && mode === 'color' && editingLight?.colorCapable) { state.hue = colorHue; state.saturation = colorSaturation; }
    if (on && mode === 'white' && editingLight?.colorTemperatureCapable) state.colorTemperature = temperature;
    const event: TimelineEvent = { ...editing, atMs, state };
    setDraft({ ...draft, events: [...draft.events.filter(item => item.id !== event.id), event] });
    setEditing(null);
  };
  const save = async () => {
    if (!draft || saving || previewRunning) return;
    try {
      const value = Number(duration);
      const checked = validateTimeline({ ...draft, durationMs: value * 1000 }, group?.lightIds ?? [], lights);
      setSaving(true);
      await onSave(checked);
      setDraft(checked); setDuration(String(checked.durationMs / 1000));
      Alert.alert('Saved', 'Timeline is ready to run from Home.');
    } catch (error) { Alert.alert('Timeline', errorText(error)); }
    finally { setSaving(false); }
  };
  const startPreview = async () => {
    if (!draft || saving || importing || previewRunning) return;
    try {
      const checked = validateTimeline({ ...draft, name: draft.name.trim() || 'Preview', durationMs: Number(duration) * 1000 }, group?.lightIds ?? [], lights);
      previewRef.current?.cancel(); previewRef.current = null; setPreviewing(null);
      await onPreview(checked);
    } catch (error) { Alert.alert('Preview', errorText(error)); }
  };
  const select = (sequence: TimelineSequence) => { changeDraft({ ...sequence, events: [...sequence.events], audioEffects: [...(sequence.audioEffects ?? [])] }); setDuration(String(sequence.durationMs / 1000)); };

  const audioLane = (track: 'background' | 'effect', items: TimelineAudioClip[]) => <View style={[styles.lane, track === 'effect' && { height: effectsHeight }]}>
    {Array.from({ length: seconds }, (_, i) => <View key={i} style={[styles.cell, track === 'effect' && { height: effectsHeight }]} />)}
    {items.filter(clip => clip.atMs < seconds * 1000).map(clip => {
      return <DraggableItem key={clip.id} atMs={clip.atMs} durationMs={draft?.durationMs ?? 1000} clipDurationMs={clip.durationMs} label={`${clip.name}, duration ${precise(clip.durationMs)}`} onTap={() => editClip(clip, track)} onDrop={atMs => dropAudio(clip.id, atMs)} onDraggingChange={setDraggingItem} style={[styles.audioBar, track === 'effect' && styles.effectBar, { top: 8 + (track === 'effect' ? (effectRows.get(clip.id) ?? 0) * ROW : 0) }]}><Text numberOfLines={1} style={styles.audioText}>{clip.name} · {precise(clip.durationMs)}</Text></DraggableItem>;
    })}
  </View>;

  return <View style={styles.container}>
    <Text style={styles.title}>Sequence Creator</Text>
    <Text style={styles.muted}>Pick a group, tap lamp rows to add actions, and add audio below. Swipe empty space to scroll; drag an action or audio clip to move it in 0.1s steps. Tap to edit. Playback runs once.</Text>
    <View pointerEvents={previewRunning ? 'none' : 'auto'} style={[styles.editorControls, previewRunning && styles.disabled]}>
      <View style={styles.row}><Pressable style={styles.button} onPress={() => { changeDraft(empty(groups[0]?.id ?? '')); setDuration('20'); }}><Text style={styles.buttonText}>New sequence</Text></Pressable></View>
      {timelines.map(item => <View key={item.id} style={styles.listRow}><Pressable style={styles.listSelect} onPress={() => select(item)}><Text style={styles.text}>{item.name}</Text><Text style={styles.muted}>{format(item.durationMs)} · {item.events.length} actions · {item.restoreAfterPlayback ? 'restore after Home playback' : 'keep final lamp state'} · {groups.find(g => g.id === item.groupId)?.name ?? 'Group missing'}</Text></Pressable><Pressable disabled={saving} onPress={() => Alert.alert('Delete sequence?', `Delete ${item.name}?`, [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void (async () => { try { await onDelete(item.id); if (draft?.id === item.id) setDraft(null); } catch (error) { Alert.alert('Timeline', errorText(error)); } })(); } }])}><Text style={styles.delete}>Delete</Text></Pressable></View>)}
    </View>
    {draft && <>
      <Pressable style={[styles.button, (saving || importing || previewRestoring) && styles.disabled]} disabled={previewRestoring || (!previewRunning && (saving || importing))} onPress={previewRunning ? onStopPreview : () => { void startPreview(); }}><Text style={styles.buttonText}>{previewRestoring ? 'Restoring lamps…' : previewRunning ? 'Stop preview & restore lamps' : 'Preview sequence (lights + audio)'}</Text></Pressable>
      <Text style={styles.muted}>Preview plays this draft without saving it and always restores the affected lamps, even when the Home restore switch is off.</Text>
      <View pointerEvents={previewRunning ? 'none' : 'auto'} style={[styles.editorControls, previewRunning && styles.disabled]}>
      <Text style={styles.label}>Name</Text><TextInput style={styles.input} placeholder="e.g. Midnight lights" placeholderTextColor={colors.muted} maxLength={60} value={draft.name} onChangeText={name => setDraft({ ...draft, name })} />
      <Text style={styles.label}>Group</Text>
      {groups.length === 0 && <Text style={styles.muted}>Create a group in Group Overview first.</Text>}
      <View style={styles.row}>{groups.map(item => <Pressable key={item.id} style={[styles.choice, draft.groupId === item.id && styles.chosen]} onPress={() => setDraft({ ...draft, groupId: item.id, events: item.id === draft.groupId ? draft.events : [] })}><Text style={styles.text}>{item.name}</Text></Pressable>)}</View>
      {!group && draft.groupId && <Text style={styles.delete}>This group was deleted. Select another group to continue.</Text>}
      <Text style={styles.label}>Duration (1–120 seconds)</Text><TextInput style={styles.input} value={duration} onChangeText={value => { setDuration(value); const n = Number(value); if (Number.isInteger(n) && n >= 1 && n <= 120) setDraft(current => current ? { ...current, durationMs: n * 1000 } : current); }} keyboardType="number-pad" maxLength={3} />
      <View style={styles.toggle}><Text style={styles.text}>Restore lamps after Home playback</Text><Switch accessibilityLabel="Restore lamps after Home playback" value={draft.restoreAfterPlayback ?? false} onValueChange={value => setDraft({ ...draft, restoreAfterPlayback: value })} trackColor={{ true: colors.orange }} /></View>
      <Text style={styles.muted}>Off: Home leaves the final lamp state. On: Home restores the lamps on finish or Stop. Preview always restores them either way.</Text>
      <Text style={styles.label}>Audio</Text>
      <View style={styles.row}><Pressable style={[styles.choice, importing && styles.disabled]} disabled={importing} onPress={() => { void importClip('background'); }}><Text style={styles.text}>{draft.backgroundAudio ? 'Replace background' : 'Add background'}</Text></Pressable><Pressable style={[styles.choice, importing && styles.disabled]} disabled={importing} onPress={() => { void importClip('effect'); }}><Text style={styles.text}>Add effect</Text></Pressable></View>
      <Text style={styles.label}>Built-in sounds</Text>
      <View style={styles.row}><Pressable style={[styles.choice, !!previewing && previewing !== 'sample-knock' && styles.disabled]} disabled={!!previewing && previewing !== 'sample-knock'} onPress={() => previewAudio('sample-knock', undefined, 'knock')}><Text style={styles.text}>{previewing === 'sample-knock' ? 'Stop knock' : 'Hear creepy knocks'}</Text></Pressable><Pressable style={[styles.choice, (importing || saving) && styles.disabled]} disabled={importing || saving} onPress={() => addSample('knock')}><Text style={styles.text}>Add knocks to effects</Text></Pressable></View>
      <View style={styles.row}><Pressable style={[styles.choice, !!previewing && previewing !== 'sample-chime' && styles.disabled]} disabled={!!previewing && previewing !== 'sample-chime'} onPress={() => previewAudio('sample-chime', undefined, 'chime')}><Text style={styles.text}>{previewing === 'sample-chime' ? 'Stop chime' : 'Hear eerie chime'}</Text></Pressable><Pressable style={[styles.choice, (importing || saving) && styles.disabled]} disabled={importing || saving} onPress={() => addSample('chime')}><Text style={styles.text}>Add chime to effects</Text></Pressable></View>
      <Text style={styles.muted}>These sounds are generated inside the app. Preview them to check device audio without importing a file or running the lights.</Text>
      <Text style={styles.muted}>Background plays once; effects can overlap. Bars show file length, clipped at the sequence end. Drag to change start time, or tap to edit time or volume.</Text>
      {lanes.length > 0 && <>
        <Text style={styles.muted}>On = power on and brightness. RGB lamps can select colors; tunable white lamps can choose Candle, Warm and other whites. Off = power off. Each dimmable action can change instantly or fade.</Text>
        <View style={styles.timeline}>
          <View style={styles.labels}><View style={styles.axisLabel}><Text style={styles.muted}>Time</Text></View>{lanes.map(light => <View key={light.id} style={styles.lampLabel}><Text numberOfLines={2} style={styles.text}>{light.name}</Text></View>)}<View style={styles.lampLabel}><Text style={styles.text}>Background</Text></View><View style={[styles.lampLabel, { height: effectsHeight }]}><Text style={styles.text}>Effects</Text></View></View>
          <ScrollView horizontal scrollEnabled={!draggingItem} style={styles.scroller} showsHorizontalScrollIndicator><View style={{ width }}>
            <View style={styles.axis}>{Array.from({ length: seconds }, (_, i) => <View key={i} style={styles.axisCell}><Text style={styles.muted}>{i}s</Text></View>)}</View>
            {lanes.map(light => <View key={light.id} style={styles.lane}>
              {Array.from({ length: seconds }, (_, i) => <Pressable key={i} style={styles.cell} onPress={() => add(light.id, i * 1000)} />)}
              {draft.events.filter(event => event.lightId === light.id && event.atMs < seconds * 1000).map(event => <DraggableItem key={event.id} atMs={event.atMs} durationMs={draft.durationMs} label={`${light.name} action`} onTap={() => open(event)} onDrop={atMs => dropAction(event.id, atMs)} onDraggingChange={setDraggingItem} style={[styles.marker, styles.dragMarker, !event.state.on && styles.offMarker]}><Text numberOfLines={1} style={styles.markerText}>{event.state.on ? event.state.hue !== undefined ? 'COLOR' : event.state.colorTemperature !== undefined ? 'WHITE' : light.kind === 'onoff-plug' ? 'ON' : `${event.state.brightness}%` : 'OFF'}</Text></DraggableItem>)}
            </View>)}
            {audioLane('background', draft.backgroundAudio ? [draft.backgroundAudio] : [])}
            {audioLane('effect', draft.audioEffects ?? [])}
          </View></ScrollView>
        </View>
        <Text style={styles.muted}>Swipe empty timeline space to see later seconds. Drag colored items to move them; tap to edit or remove.</Text>
        {draft.events.length > 0 && <><Text style={styles.label}>Actions (tap to edit)</Text>{[...draft.events].sort((a, b) => a.atMs - b.atMs).map(event => <Pressable key={event.id} style={styles.listRow} onPress={() => open(event)}><Text style={styles.text}>{format(event.atMs)} · {lanes.find(light => light.id === event.lightId)?.name ?? 'Unavailable lamp'} · {describe(event, lanes.find(light => light.id === event.lightId)?.kind === 'onoff-plug')}</Text></Pressable>)}</>}
      </>}
      {!!(draft.backgroundAudio || draft.audioEffects?.length) && <><Text style={styles.label}>Audio clips (tap to edit)</Text>{[...(draft.backgroundAudio ? [{ clip: draft.backgroundAudio, track: 'background' as const }] : []), ...(draft.audioEffects ?? []).map(clip => ({ clip, track: 'effect' as const }))].map(({ clip, track }) => <Pressable key={clip.id} style={styles.listRow} onPress={() => editClip(clip, track)}><Text style={styles.text}>{track === 'background' ? 'Background' : 'Effect'} · {format(clip.atMs)} · {clip.name} · {precise(clip.durationMs)}</Text></Pressable>)}</>}
      <Pressable style={[styles.button, saving && styles.disabled]} disabled={saving} onPress={() => { void save(); }}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save sequence'}</Text></Pressable>
      </View>
    </>}
    <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}><View style={styles.modalBackdrop}><ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled" scrollEnabled={!pickingColor}>
      <Text style={styles.title}>{draft?.events.some(event => event.id === editing?.id) ? 'Edit action' : 'Add action'}</Text>
      <Text style={styles.muted}>{editingLight?.name}</Text>
      <Text style={styles.label}>Time (seconds, 0.1s precision)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={at} onChangeText={setAt} />
      <View style={styles.toggle}><Text style={styles.text}>{on ? 'Turn on' : 'Turn off'}</Text><Switch value={on} onValueChange={setOn} trackColor={{ true: colors.orange }} /></View>
      {editingLight?.kind !== 'onoff-plug' && <>
        <Text style={styles.label}>Transition · {transition === 0 ? 'Instant (0s)' : `${(transition / 10).toFixed(1)}s fade`}</Text>
        <Slider accessibilityLabel="Action transition duration" minimumValue={0} maximumValue={100} step={1} value={transition} onValueChange={setTransition} minimumTrackTintColor={colors.orange} />
        <Text style={styles.muted}>0 = instant; up to 10 seconds. Applies to both on and off actions.</Text>
      </>}
      {on && editingLight?.kind !== 'onoff-plug' && <><Text style={styles.label}>Brightness · {brightness}%</Text><Slider accessibilityLabel="Action brightness" minimumValue={1} maximumValue={100} step={1} value={brightness} onValueChange={setBrightness} minimumTrackTintColor={colors.orange} />
        {(editingLight?.colorCapable || editingLight?.colorTemperatureCapable) && <><Text style={styles.label}>Light color</Text><View style={styles.row}>
          {(['keep', ...(editingLight.colorCapable ? ['color'] : []), ...(editingLight.colorTemperatureCapable ? ['white'] : [])] as ('keep' | 'color' | 'white')[]).map(option => <Pressable key={option} style={[styles.choice, mode === option && styles.chosen]} onPress={() => setMode(option)}><Text style={styles.text}>{option === 'keep' ? 'Keep current' : option === 'color' ? 'RGB color' : 'White preset'}</Text></Pressable>)}
        </View></>}
        {mode === 'color' && editingLight?.colorCapable && <><Text style={styles.label}>Color presets</Text><View style={styles.row}>{colorPresets.map(([name, hue]) => <Pressable key={name} style={[styles.choice, colorHue === hue && colorSaturation === 254 && styles.chosen]} onPress={() => { setColorHue(hue); setColorSaturation(254); }}><Text style={styles.text}>{name}</Text></Pressable>)}</View>
          <Text style={styles.label}>Custom color</Text><ColorWheel hue={colorHue / 65535 * 360} saturation={colorSaturation / 254 * 100} brightness={brightness} onGestureStart={() => setPickingColor(true)} onGestureEnd={() => setPickingColor(false)} onChange={(hue, saturation) => { setColorHue(Math.round(hue / 360 * 65535)); setColorSaturation(Math.round(saturation / 100 * 254)); }} />
        </>}
        {mode === 'white' && editingLight?.colorTemperatureCapable && <><Text style={styles.label}>White temperature</Text><View style={styles.row}>{whites.map(([name, kelvin]) => <Pressable key={name} style={[styles.choice, temperature === kelvin && styles.chosen]} onPress={() => setTemperature(kelvin)}><Text style={styles.text}>{name} · {kelvin} K</Text></Pressable>)}</View></>}
      </>}
      <View style={styles.row}><Pressable style={styles.button} onPress={commit}><Text style={styles.buttonText}>Apply</Text></Pressable><Pressable style={styles.choice} onPress={() => setEditing(null)}><Text style={styles.text}>Cancel</Text></Pressable>
        {draft?.events.some(event => event.id === editing?.id) && <Pressable style={styles.choice} onPress={() => { setDraft(current => current ? { ...current, events: current.events.filter(event => event.id !== editing?.id) } : current); setEditing(null); }}><Text style={styles.delete}>Remove</Text></Pressable>}
      </View>
    </ScrollView></View></Modal>
    <Modal visible={!!editingAudio} transparent animationType="fade" onRequestClose={() => setEditingAudio(null)}><View style={styles.modalBackdrop}><ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{editingAudio?.track === 'background' ? 'Background audio' : 'Sound effect'}</Text>
      <Text style={styles.text}>{editingAudio?.clip.name}</Text><Text style={styles.muted}>File length: {editingAudio ? precise(editingAudio.clip.durationMs) : ''}. Playback stops at the end of the sequence.</Text>
      {editingAudio && <Pressable style={[styles.choice, !!previewing && previewing !== editingAudio.clip.id && styles.disabled]} disabled={!!previewing && previewing !== editingAudio.clip.id} onPress={() => previewAudio(editingAudio.clip.id, editingAudio.clip.uri)}><Text style={styles.text}>{previewing === editingAudio.clip.id ? 'Stop preview' : 'Preview this clip (no lights)'}</Text></Pressable>}
      <Text style={styles.label}>Start (seconds, 0.1s precision)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={audioAt} onChangeText={setAudioAt} />
      <Text style={styles.label}>Volume (0–100%)</Text><TextInput style={styles.input} keyboardType="number-pad" value={audioVolume} onChangeText={setAudioVolume} />
      <View style={styles.row}><Pressable style={styles.button} onPress={applyAudio}><Text style={styles.buttonText}>Apply</Text></Pressable><Pressable style={styles.choice} onPress={() => setEditingAudio(null)}><Text style={styles.text}>Cancel</Text></Pressable><Pressable style={styles.choice} onPress={removeAudio}><Text style={styles.delete}>Remove</Text></Pressable></View>
    </ScrollView></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  editorControls: { gap: 12 },
  dragTarget: { flex: 1, justifyContent: 'center', overflow: 'hidden' },
  dragMarker: { height: 42 },
  dragTime: { position: 'absolute', bottom: '100%', left: 0, color: colors.text, backgroundColor: colors.dark, fontWeight: '800', paddingHorizontal: 5, borderRadius: 4 },
  audioBar: { position: 'absolute', top: 8, height: 44, borderRadius: 6, backgroundColor: '#63cca6', paddingHorizontal: 4, justifyContent: 'center', zIndex: 1 },
  effectBar: { backgroundColor: '#c698f2' },
  audioText: { color: '#190e08', fontSize: 11, fontWeight: '800' },
  container: { backgroundColor: colors.panel, borderRadius: 18, padding: 16, gap: 12 }, title: { color: colors.text, fontSize: 19, fontWeight: '800' }, text: { color: colors.text, fontWeight: '700' }, muted: { color: colors.muted, lineHeight: 20 }, label: { color: colors.text, fontWeight: '700' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, input: { color: colors.text, backgroundColor: colors.dark, borderWidth: 1, borderColor: '#4e425c', borderRadius: 10, padding: 12 }, button: { backgroundColor: colors.orange, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, alignItems: 'center' }, buttonText: { color: '#190e08', fontWeight: '800' }, disabled: { opacity: 0.45 }, choice: { padding: 12, backgroundColor: '#3a2c4c', borderRadius: 10, borderWidth: 1, borderColor: '#3a2c4c' }, chosen: { borderColor: colors.purple }, listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#4e425c', paddingBottom: 8 }, listSelect: { flex: 1 }, delete: { color: '#ff6d7a', fontWeight: '800' }, timeline: { flexDirection: 'row', backgroundColor: colors.dark, borderRadius: 8, overflow: 'hidden' }, labels: { width: labelWidth }, axisLabel: { height: 36, justifyContent: 'center', paddingLeft: 5 }, lampLabel: { height: ROW, padding: 5, justifyContent: 'center', borderTopWidth: 1, borderColor: '#4e425c' }, scroller: { flex: 1 }, axis: { height: 36, flexDirection: 'row' }, axisCell: { width: CELL, paddingLeft: 3, justifyContent: 'center', borderLeftWidth: 1, borderColor: '#4e425c' }, lane: { height: ROW, flexDirection: 'row', borderTopWidth: 1, borderColor: '#4e425c' }, cell: { width: CELL, height: ROW, borderLeftWidth: 1, borderColor: '#4e425c' }, marker: { position: 'absolute', top: 9, minWidth: 42, maxWidth: 54, padding: 8, borderRadius: 8, backgroundColor: colors.orange, zIndex: 1 }, offMarker: { backgroundColor: colors.purple }, markerText: { color: '#190e08', fontWeight: '900', fontSize: 11 }, modalBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.75)' }, dialog: { backgroundColor: colors.panel, borderRadius: 18, maxHeight: '85%' }, dialogContent: { padding: 20, gap: 12 }, toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});



