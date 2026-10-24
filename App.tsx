import { useEffect, useRef, useState } from 'react';
import { Picker } from '@react-native-picker/picker';
import Slider from '@react-native-community/slider';
import { ActivityIndicator, Alert, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clearCredentials, loadCredentials, saveCredentials } from './src/storage/credentials';
import { clearGroups, loadGroups, saveGroups } from './src/storage/groups';
import { clearTimelines, loadTimelines, saveTimelines } from './src/storage/timelines';
import { createLightGroup, groupsForAvailableLights } from './src/services/groups';
import { colors, whites } from './src/services/light-presets';
import { discoverBridge, getLights, pairBridge, renameLight, setLightState } from './src/services/hue';
import { candlelight, createSequenceRunner, hauntedPulse, type SequenceRunner } from './src/services/sequences';
import { createAudioTimelineRunner, deleteUnusedAudio } from './src/services/timeline-audio';
import { createRestoringTimelinePreview, shouldRestoreHomePlayback } from './src/services/timeline-preview';
import { TimelineEditor } from './src/components/TimelineEditor';
import { ColorWheel } from './src/components/ColorWheel';
import type { HueCredentials, HueLight, HueLightGroup, LightState, TimelineSequence } from './src/types/hue';
const C = { bg: '#100d17', panel: '#211b2e', orange: '#ff7b22', purple: '#a96bff', text: '#f8f2ff', muted: '#b9adc8', danger: '#ff6d7a' };
type Screen = 'home' | 'bridge' | 'lamps' | 'color' | 'groups' | 'creator';
const message = (error: unknown) => error instanceof Error ? error.message : 'Something unexpected went wrong.';
export default function App() {
  const { height } = useWindowDimensions();
  const [credentials, setCredentials] = useState<HueCredentials | null>(null);
  const [bridgeIp, setBridgeIp] = useState('');
  const [lights, setLights] = useState<HueLight[]>([]);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [editingLightId, setEditingLightId] = useState<string | null>(null);
  const [draftLightName, setDraftLightName] = useState('');
  const [groups, setGroups] = useState<HueLightGroup[]>([]);
  const [timelines, setTimelines] = useState<TimelineSequence[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [draftLightIds, setDraftLightIds] = useState<string[]>([]);
  const [hue, setHue] = useState(0); const [saturation, setSaturation] = useState(100); const [brightness, setBrightness] = useState(100);
  const [screen, setScreen] = useState<Screen>('home'); const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [restoring, setRestoring] = useState(true); const [status, setStatus] = useState('Loading…'); const [running, setRunning] = useState(false);
  const [selectedSequenceId, setSelectedSequenceId] = useState(hauntedPulse.id);
  const runner = useRef<SequenceRunner | null>(null);
  const homeRestoreInFlight = useRef(false);
  const [homeRestoring, setHomeRestoring] = useState(false);
  const previewRunner = useRef<SequenceRunner | null>(null);
  const previewStopped = useRef(false);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [previewRestoring, setPreviewRestoring] = useState(false);
  const stopRequested = useRef(false);
  const editingColor = useRef(false);
  const refresh = async (active = credentials) => { if (!active) return; const next = await getLights(active); setLights(next); setSelectedLightId(id => id && next.some(light => light.id === id) ? id : next[0]?.id ?? null); };
  useEffect(() => { void (async () => { try { const [saved, savedGroups, savedTimelines] = await Promise.all([loadCredentials(), loadGroups(), loadTimelines()]); setGroups(savedGroups); setTimelines(savedTimelines); if (!saved) { setStatus('No saved bridge yet.'); return; } setCredentials(saved); setBridgeIp(saved.bridgeIp); setStatus(`Restoring ${saved.bridgeIp}…`); await refresh(saved); setStatus('Connected to your saved Hue Bridge.'); } catch (error) { setStatus(`Could not restore bridge: ${message(error)}`); } finally { setRestoring(false); } })(); return () => { runner.current?.cancel(); previewRunner.current?.cancel(); }; }, []);
  useEffect(() => { if (screen !== 'color') return; const listener = BackHandler.addEventListener('hardwareBackPress', () => { setScreen('lamps'); return true; }); return () => listener.remove(); }, [screen]);
  useEffect(() => { const light = lights.find(item => item.id === selectedLightId); if (!light) return; if (!editingColor.current) { setHue(Math.round((light.hue ?? 0) / 65535 * 360)); setSaturation(Math.round((light.saturation ?? 254) / 254 * 100)); } setBrightness(light.on ? light.brightness : 0); }, [lights, selectedLightId]);
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work(); } catch (error) { const text = message(error); setStatus(text); Alert.alert('Hue connection', text); } finally { setBusy(false); } };
  const discover = () => run(async () => { const ip = await discoverBridge(); if (!ip) throw new Error('No bridge was found. Enter its local IP instead.'); setBridgeIp(ip); setStatus(`Bridge found at ${ip}. Press its link button, then pair.`); });
  const pair = () => run(async () => { if (!bridgeIp.trim()) throw new Error('Enter or discover a bridge address first.'); const next = await pairBridge(bridgeIp); await saveCredentials(next); if (!(await loadCredentials())) throw new Error('Paired, but credentials could not be saved.'); setCredentials(next); setBridgeIp(next.bridgeIp); await refresh(next); setStatus('Paired securely.'); });
  const forget = () => run(async () => { if (previewRunner.current) { const active = previewRunner.current; active.cancel(); await active.done; } stopRequested.current = true; if (runner.current && homeRestoreInFlight.current) { const active = runner.current; active.cancel(); await active.done; } else runner.current?.cancel(); runner.current = null; setRunning(false); await Promise.all([clearCredentials(), clearGroups(), clearTimelines()]); deleteUnusedAudio(timelines, []); setCredentials(null); setLights([]); setGroups([]); setTimelines([]); setSelectedSequenceId(hauntedPulse.id); setSelectedLightId(null); setSelectedGroupId(null); setStatus('Saved connection removed.'); });
  const update = (state: LightState) => run(async () => { if (!credentials || !selectedLightId) throw new Error('Select a lamp first.'); await setLightState(credentials, selectedLightId, state); await refresh(); setStatus('Lamp updated.'); });
  const saveLightName = () => run(async () => { if (!credentials || !editingLightId) throw new Error('Select a lamp first.'); await renameLight(credentials, editingLightId, draftLightName); await refresh(); setEditingLightId(null); setStatus('Lamp name saved to the Hue Bridge.'); });
  const createGroup = () => run(async () => { const group = createLightGroup(groupName, draftLightIds); if (groups.some(item => item.name.toLowerCase() === group.name.toLowerCase())) throw new Error('A group with that name already exists.'); const next = [...groups, group]; await saveGroups(next); setGroups(next); setSelectedGroupId(group.id); setGroupName(''); setDraftLightIds([]); });
  const removeGroup = (group: HueLightGroup) => run(async () => { const next = groups.filter(item => item.id !== group.id); await saveGroups(next); setGroups(next); if (selectedGroupId === group.id) setSelectedGroupId(null); });
  const saveTimeline = async (sequence: TimelineSequence) => { const next = [...timelines.filter(item => item.id !== sequence.id), sequence]; await saveTimelines(next); deleteUnusedAudio(timelines, next); setTimelines(next); setSelectedSequenceId(sequence.id); };
  const deleteTimeline = async (id: string) => { const next = timelines.filter(item => item.id !== id); await saveTimelines(next); deleteUnusedAudio(timelines, next); setTimelines(next); if (selectedSequenceId === id) setSelectedSequenceId(hauntedPulse.id); };
  const availableGroups = groupsForAvailableLights(groups, lights.map(light => light.id)); const selectedGroup = availableGroups.find(group => group.id === selectedGroupId); const selectedLight = lights.find(light => light.id === selectedLightId);
  const selectedTimeline = timelines.find(item => item.id === selectedSequenceId);
  const selectedSequence = selectedSequenceId === candlelight.id ? candlelight : hauntedPulse;
  const sequenceName = selectedTimeline?.name ?? selectedSequence.name;
  const timelineGroup = selectedTimeline && availableGroups.find(group => group.id === selectedTimeline.groupId);
  const sendState = (active: HueCredentials, id: string, state: LightState) => {
    const device = lights.find(light => light.id === id);
    const supportedState = device?.kind === 'onoff-plug' ? { on: state.on }
      : device?.kind === 'dimmable-plug' ? { on: state.on, brightness: state.brightness, brightnessRaw: state.brightnessRaw, transitionTimeDeciseconds: state.transitionTimeDeciseconds }
      : { ...state, hue: device?.colorCapable ? state.hue : undefined,
        saturation: device?.colorCapable ? state.saturation : undefined,
        xy: device?.colorCapable ? state.xy : undefined,
        colorTemperature: device?.colorTemperatureCapable ? state.colorTemperature : undefined,
        colorTemperatureMired: device?.colorTemperatureCapable ? state.colorTemperatureMired : undefined };
    return setLightState(active, id, supportedState);
  };
  const previewTimeline = async (sequence: TimelineSequence) => {
    if (previewRunner.current || runner.current || busy) return;
    const group = availableGroups.find(item => item.id === sequence.groupId);
    if (!credentials || !group || sequence.events.some(event => !group.lightIds.includes(event.lightId))) {
      const text = 'Connect to the Hue Bridge and choose a group with all preview lamps available.';
      setStatus(text); Alert.alert('Preview', text); return;
    }
    let stopped = false;
    let failed = false;
    const active = createRestoringTimelinePreview(sequence,
      () => getLights(credentials),
      (id, state) => sendState(credentials, id, state),
      (timeline, apply) => createAudioTimelineRunner(timeline, apply),
      () => { setPreviewRestoring(true); setStatus('Restoring the lamps from before preview…'); });
    previewRunner.current = active;
    setPreviewRunning(true);
    setPreviewRestoring(false);
    setStatus(`Previewing ${sequence.name}…`);
    try { await active.done; }
    catch (error) { failed = true; const text = message(error); setStatus(`Preview: ${text}`); Alert.alert('Preview', text); }
    finally {
      if (previewRunner.current === active) {
        stopped = previewStopped.current;
        previewRunner.current = null;
        previewStopped.current = false;
        setPreviewRunning(false);
        setPreviewRestoring(false);
        try { await refresh(); } catch (error) { failed = true; setStatus(`Could not refresh lamps: ${message(error)}`); }
        if (!failed) setStatus(stopped ? 'Preview stopped; lamps restored.' : 'Preview finished; lamps restored.');
      }
    }
  };
  const stopPreview = () => { if (!previewRunner.current) return; previewStopped.current = true; previewRunner.current.cancel(); setStatus('Stopping preview and restoring lamps…'); };
  const start = async () => {
    if (runner.current || previewRunner.current) return;
    if (selectedTimeline && (!timelineGroup || selectedTimeline.events.some(event => !timelineGroup.lightIds.includes(event.lightId)))) {
      const text = 'A timeline lamp is unavailable. Restore it or edit the sequence before running.';
      setStatus(text); Alert.alert('Sequence', text); return;
    }
    const sequence = selectedSequence;
    const targets = selectedTimeline ? (timelineGroup?.lightIds ?? []) : selectedGroup?.lightIds ?? (selectedLightId ? [selectedLightId] : []);
    const ids = !selectedTimeline && sequence.id === candlelight.id ? targets.filter(id => lights.find(light => light.id === id)?.kind !== 'onoff-plug') : targets;
    if (!credentials || !targets.length || !ids.length) {
      const text = selectedTimeline ? 'This timeline needs its group and at least one available lamp.' : !ids.length && targets.length ? 'Candlelight needs a dimmable lamp; on/off smart switches cannot flicker.' : 'Choose a lamp or group first.';
      setStatus(text); Alert.alert('Sequence', text); return;
    }
    stopRequested.current = false;
    const restoreHome = shouldRestoreHomePlayback(selectedTimeline);
    homeRestoreInFlight.current = restoreHome;
    const active = selectedTimeline
      ? restoreHome
        ? createRestoringTimelinePreview(selectedTimeline, () => getLights(credentials), (id, state) => sendState(credentials, id, state),
          (timeline, apply) => createAudioTimelineRunner(timeline, apply), () => { setHomeRestoring(true); setStatus('Restoring the lamps from before playback…'); })
        : createAudioTimelineRunner(selectedTimeline, (id, state) => sendState(credentials, id, state))
      : createSequenceRunner({ ...sequence, lightIds: ids }, async (lightIds, state) => { await Promise.all(lightIds.map(id => sendState(credentials, id, state))); });
    runner.current = active;
    setRunning(true);
    setStatus(`${sequenceName} is running…`);
    let failed = false;
    try {
      await active.done;
      if (runner.current === active && !stopRequested.current) setStatus(`${sequenceName} finished.${restoreHome ? ' Lamps restored.' : ''}`);
    } catch (error) {
      failed = true;
      if (!stopRequested.current || restoreHome) { const text = message(error); setStatus(text); Alert.alert('Sequence', text); }
    } finally {
      if (runner.current === active) {
        runner.current = null;
        setRunning(false);
        homeRestoreInFlight.current = false;
        setHomeRestoring(false);
        try { await refresh(); } catch (error) { failed = true; setStatus(`Could not refresh lamps: ${message(error)}`); }
        if (restoreHome && stopRequested.current && !failed) setStatus('Sequence stopped; lamps restored.');
      }
    }
  };
  const stop = () => { if (homeRestoring) return; stopRequested.current = true; runner.current?.cancel(); setStatus(homeRestoreInFlight.current ? 'Stopping sequence and restoring lamps…' : 'Sequence stopped.'); };
  const go = (next: Screen) => {
    if (screen === 'creator' && next !== 'creator' && previewRunner.current) {
      const active = previewRunner.current;
      stopPreview();
      void active.done.then(() => { setScreen(next); setDrawerOpen(false); }, () => { setScreen(next); setDrawerOpen(false); });
      return;
    }
    setScreen(next); setDrawerOpen(false);
  };
  const openColor = () => { editingColor.current = false; if (selectedLight) { setHue(Math.round((selectedLight.hue ?? 0) / 65535 * 360)); setSaturation(Math.round((selectedLight.saturation ?? 254) / 254 * 100)); setBrightness(selectedLight.on ? selectedLight.brightness : 0); } go('color'); };
  const toggleDraft = (id: string) => setDraftLightIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const targetMissing = !credentials || (selectedTimeline ? !timelineGroup || !(selectedTimeline.events.length || selectedTimeline.backgroundAudio || selectedTimeline.audioEffects?.length) || selectedTimeline.events.some(event => !timelineGroup.lightIds.includes(event.lightId)) : !selectedGroup && !selectedLight);
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.header}><Pressable onPress={screen === 'color' ? () => go('lamps') : () => setDrawerOpen(true)} style={styles.menu}><Text style={styles.menuText}>{screen === 'color' ? '‹' : '☰'}</Text></Pressable><Text style={styles.headerText}>{screen === 'home' ? 'Spooky Vibes' : screen === 'bridge' ? 'Connect your bridge' : screen === 'lamps' ? 'Lamp Overview' : screen === 'color' ? 'Color & brightness' : screen === 'groups' ? 'Group Overview' : 'Sequence Creator'}</Text></View>
    {screen === 'color' && (selectedLight?.colorCapable ? <View style={styles.colorPage}>
      <Text style={styles.cardTitle} numberOfLines={1}>{selectedLight.name}</Text>
      <View style={styles.colorControls}>
        <ColorWheel hue={hue} saturation={saturation} brightness={brightness} maxSize={Math.max(160, Math.min(320, height - 460))} disabled={busy} onChange={(nextHue, nextSaturation) => { editingColor.current = true; setHue(Math.round(nextHue)); setSaturation(nextSaturation); }} />
        <Text style={styles.label}>Brightness · {brightness}%</Text>
        <Slider minimumValue={0} maximumValue={100} step={1} value={brightness} onValueChange={setBrightness} onSlidingComplete={value => { const level = Math.round(value); void update(level === 0 ? { on: false } : { on: true, brightness: level }); }} minimumTrackTintColor={C.orange} disabled={busy} />
        <Button label="Apply color" onPress={() => { editingColor.current = false; void update({ on: true, brightness, hue: hue / 360 * 65535, saturation: saturation / 100 * 254 }); }} full disabled={busy || brightness === 0} />
      </View>
      <ScrollView style={styles.presetScroll} contentContainerStyle={styles.presetContent} nestedScrollEnabled>
        <Text style={styles.label}>Color presets</Text><View style={styles.row}>{colors.map(([name, colorHue]) => <Button key={name} label={name} onPress={() => { editingColor.current = false; void update({ on: true, brightness: brightness || 80, hue: colorHue, saturation: 254 }); }} disabled={busy} />)}</View>
        {selectedLight.colorTemperatureCapable && <><Text style={styles.label}>White light</Text><View style={styles.row}>{whites.map(([name, temperature]) => <Button key={name} label={name} onPress={() => { editingColor.current = false; void update({ on: true, brightness: brightness || 80, colorTemperature: temperature }); }} secondary disabled={busy} />)}</View></>}
      </ScrollView>
      <Text style={styles.muted} numberOfLines={2}>{busy && 'Working… '}{status}</Text>
    </View> : <View style={styles.content}><Text style={styles.muted}>This RGB lamp is no longer available.</Text><Button label="Back to lamps" onPress={() => go('lamps')} /></View>)}
    {screen !== 'color' && <>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {screen === 'home' && <View style={styles.home}><Text style={styles.eyebrow}>HALLOWEEN LIGHTING</Text><Text style={styles.hero}>Ready to haunt?</Text><Text style={styles.subtitle}>{selectedTimeline ? timelineGroup ? `Timeline group: ${timelineGroup.name}` : 'Timeline group unavailable. Edit it in Sequence Creator.' : selectedGroup ? `Target: ${selectedGroup.name}` : selectedLight ? `Target: ${selectedLight.name}` : 'Choose a lamp or group from the menu.'}</Text><Pressable style={[styles.run, (homeRestoring || !running && (busy || previewRunning || targetMissing)) && styles.disabled]} disabled={homeRestoring || !running && (busy || previewRunning || targetMissing)} onPress={running ? stop : () => { void start(); }}><Text style={styles.runText}>{homeRestoring ? 'Restoring lamps…' : running ? 'Stop sequence' : 'Run sequence'}</Text><Text style={styles.runSub}>{homeRestoring ? 'Please wait' : running ? homeRestoreInFlight.current ? 'Tap to stop & restore' : 'Tap to stop' : sequenceName}</Text></Pressable><View style={styles.selector}><Text style={styles.label}>Sequence</Text><Picker selectedValue={selectedSequenceId} onValueChange={setSelectedSequenceId} enabled={!running && !previewRunning && !busy} style={styles.picker} dropdownIconColor={C.text}><Picker.Item label={hauntedPulse.name} value={hauntedPulse.id} /><Picker.Item label={candlelight.name} value={candlelight.id} />{timelines.map(item => <Picker.Item key={item.id} label={item.name} value={item.id} />)}</Picker></View></View>}
      {screen === 'bridge' && <View style={styles.card}><Text style={styles.cardTitle}>Bridge connection</Text>{restoring ? <View style={styles.line}><ActivityIndicator color={C.orange} /><Text style={styles.muted}>Checking saved connection…</Text></View> : credentials ? <><Text style={styles.connected}>Paired to {credentials.bridgeIp}</Text><Button label="Reconnect saved bridge" onPress={() => run(() => refresh())} full disabled={busy} /><Pressable onPress={forget}><Text style={styles.danger}>Forget bridge</Text></Pressable></> : <><TextInput value={bridgeIp} onChangeText={setBridgeIp} placeholder="Bridge IP, e.g. 192.168.1.20" placeholderTextColor={C.muted} keyboardType="numbers-and-punctuation" style={styles.input} /><View style={styles.row}><Button label="Discover bridge" onPress={discover} disabled={busy} /><Button label="Use this address" onPress={() => setStatus('Press the bridge link button, then pair.')} disabled={!bridgeIp || busy} secondary /></View><Button label="Pair bridge" onPress={pair} disabled={!bridgeIp || busy} full /></>}</View>}
      {screen === 'lamps' && <View style={styles.card}>
        <View style={styles.titleRow}><Text style={styles.cardTitle}>Your lamps</Text><Pressable onPress={() => run(() => refresh())} disabled={busy}><Text style={styles.link}>Refresh</Text></Pressable></View>
        {lights.length === 0 ? <Text style={styles.muted}>Pair your bridge, then refresh lights.</Text> : lights.map(light =>
          <Pressable key={light.id} style={[styles.item, selectedLightId === light.id && styles.selected]} onPress={() => { editingColor.current = false; setSelectedLightId(light.id); setEditingLightId(null); }}>
            <View><Text style={styles.itemTitle}>{light.name}</Text><Text style={styles.muted}>{light.on ? (light.kind === 'onoff-plug' ? 'On' : `${light.brightness}%`) : 'Off'} · {light.kind === 'color' ? 'Color lamp' : light.kind === 'tunable-white' ? 'Tunable white lamp' : light.kind === 'onoff-plug' ? 'Smart switch' : light.kind === 'dimmable-plug' ? 'Dimmable smart switch' : 'Dimmable lamp'}</Text></View><Text style={styles.dot}>{selectedLightId === light.id ? '●' : '○'}</Text>
          </Pressable>)}
        {selectedLight && <>
          <View style={styles.titleRow}><Text style={styles.muted}>Controlling {selectedLight.name}</Text><Pressable disabled={busy} onPress={() => { setEditingLightId(selectedLight.id); setDraftLightName(selectedLight.name); }}><Text style={styles.link}>Rename</Text></Pressable></View>
          {editingLightId === selectedLight.id && <View style={styles.manual}>
            <Text style={styles.label}>New lamp name</Text>
            <TextInput value={draftLightName} onChangeText={setDraftLightName} maxLength={32} autoFocus autoCapitalize="words" placeholder="Lamp name" placeholderTextColor={C.muted} style={styles.input} editable={!busy} />
            <View style={styles.row}><Button label="Save to Hue Bridge" onPress={saveLightName} disabled={busy || !draftLightName.trim()} /><Button label="Cancel" onPress={() => setEditingLightId(null)} secondary disabled={busy} /></View>
          </View>}
          <View style={styles.line}><Text style={styles.label}>Power</Text><Switch value={selectedLight.on} onValueChange={on => update({ on })} disabled={busy} trackColor={{ false: '#665b73', true: C.orange }} /></View>
          {selectedLight.colorCapable ? <Button label="Color & brightness" onPress={openColor} full disabled={busy} /> : selectedLight.kind !== 'onoff-plug' && <View><Text style={styles.label}>Brightness · {brightness}%</Text><Slider minimumValue={0} maximumValue={100} step={1} value={brightness} onValueChange={setBrightness} onSlidingComplete={value => { const level = Math.round(value); void update(level === 0 ? { on: false } : { on: true, brightness: level }); }} minimumTrackTintColor={C.orange} disabled={busy} /></View>}
          {!selectedLight.colorCapable && selectedLight.colorTemperatureCapable && <><Text style={styles.label}>White light</Text><View style={styles.row}>{whites.map(([name, temperature]) => <Button key={name} label={name} onPress={() => update({ on: true, brightness: brightness || 80, colorTemperature: temperature })} secondary disabled={busy} />)}</View></>}
        </>}
      </View>}
      {screen === 'groups' && <><View style={styles.card}><Text style={styles.cardTitle}>Create a group</Text><TextInput value={groupName} onChangeText={setGroupName} placeholder="Group name, e.g. Downstairs" placeholderTextColor={C.muted} style={styles.input} />{lights.map(light => <Pressable key={light.id} style={[styles.item, draftLightIds.includes(light.id) && styles.selected]} onPress={() => toggleDraft(light.id)}><Text style={styles.itemTitle}>{light.name}</Text><Text style={styles.dot}>{draftLightIds.includes(light.id) ? '✓' : '○'}</Text></Pressable>)}<Button label={`Save group${draftLightIds.length ? ` (${draftLightIds.length})` : ''}`} onPress={createGroup} full disabled={busy || !groupName.trim() || !draftLightIds.length} /></View><View style={styles.card}><Text style={styles.cardTitle}>Sequence target</Text><Text style={styles.muted}>Pick a group for the Home sequence. With no group selected, the selected lamp is used.</Text>{groups.map(group => { const available = availableGroups.find(item => item.id === group.id); return <View key={group.id} style={[styles.group, selectedGroupId === group.id && styles.selected]}><Pressable style={styles.groupSelect} onPress={() => setSelectedGroupId(id => id === group.id ? null : group.id)} disabled={!available}><View><Text style={styles.itemTitle}>{group.name}</Text><Text style={styles.muted}>{available ? `${available.lightIds.length} available lamps` : 'No available lamps'}</Text></View><Text style={styles.dot}>{selectedGroupId === group.id ? '●' : '○'}</Text></Pressable><Pressable onPress={() => removeGroup(group)}><Text style={styles.danger}>Delete</Text></Pressable></View>; })}</View></>}
      {screen === 'creator' && <TimelineEditor groups={groups} lights={lights} timelines={timelines} onSave={saveTimeline} onDelete={deleteTimeline} onPreview={previewTimeline} onStopPreview={stopPreview} previewRunning={previewRunning} previewRestoring={previewRestoring} />}
      <View style={styles.status}><Text style={styles.muted}>{busy && 'Working… '}{status}</Text></View>
    </ScrollView>
    </>}
    <Modal visible={drawerOpen} transparent animationType="slide" onRequestClose={() => setDrawerOpen(false)}><SafeAreaView style={styles.overlay} edges={['top', 'bottom']}><View style={styles.drawer}><Text style={styles.drawerTitle}>Spooky Vibes</Text><Text style={styles.muted}>Navigation</Text><Drawer label="Home" active={screen === 'home'} onPress={() => go('home')} /><Drawer label="Connect your bridge" active={screen === 'bridge'} onPress={() => go('bridge')} /><Drawer label="Lamp Overview" active={screen === 'lamps'} onPress={() => go('lamps')} /><Drawer label="Group Overview" active={screen === 'groups'} onPress={() => go('groups')} /><Drawer label="Sequence Creator" active={screen === 'creator'} onPress={() => go('creator')} /></View><Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)} /></SafeAreaView></Modal>
  </SafeAreaView>;
}
function Button({ label, onPress, disabled, full, secondary }: { label: string; onPress: () => void; disabled?: boolean; full?: boolean; secondary?: boolean }) { return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, full && styles.full, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text></Pressable>; }
function Drawer({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.drawerItem, active && styles.selected]}><Text style={[styles.drawerText, active && styles.activeText]}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({
  colorPage: { flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, gap: 8 },
  colorControls: { backgroundColor: C.panel, borderRadius: 18, padding: 12 },
  presetScroll: { flex: 1, backgroundColor: C.panel, borderRadius: 18 },
  presetContent: { padding: 14, gap: 10 },
  safe: { flex: 1, backgroundColor: C.bg }, header: { height: 62, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderBottomColor: '#30273d' }, menu: { padding: 8 }, menuText: { color: C.text, fontSize: 26 }, headerText: { color: C.text, fontSize: 20, fontWeight: '800' }, content: { padding: 20, paddingBottom: 52, gap: 16, flexGrow: 1 }, home: { flex: 1, justifyContent: 'center', gap: 20, paddingVertical: 30 }, eyebrow: { color: C.orange, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 }, hero: { color: C.text, fontSize: 38, fontWeight: '900' }, subtitle: { color: C.muted, fontSize: 16, lineHeight: 23 }, run: { minHeight: 220, backgroundColor: C.orange, borderRadius: 28, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 28 }, runText: { color: '#190e08', fontSize: 32, fontWeight: '900' }, runSub: { color: '#503015', fontSize: 16, fontWeight: '700' }, selector: { backgroundColor: C.panel, borderRadius: 18, padding: 16 }, picker: { color: C.text, backgroundColor: '#17121f' }, card: { backgroundColor: C.panel, borderRadius: 18, padding: 16, gap: 12 }, cardTitle: { color: C.text, fontSize: 19, fontWeight: '800' }, input: { color: C.text, backgroundColor: '#17121f', borderColor: '#4e425c', borderWidth: 1, borderRadius: 10, padding: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, button: { backgroundColor: C.orange, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10, alignItems: 'center' }, full: { width: '100%' }, secondary: { backgroundColor: '#3a2c4c' }, buttonText: { color: '#190e08', fontWeight: '800' }, secondaryText: { color: C.text }, disabled: { opacity: 0.45 }, muted: { color: C.muted, lineHeight: 20 }, connected: { color: '#9bea87', fontWeight: '800' }, danger: { color: C.danger, fontWeight: '700' }, link: { color: C.purple, fontWeight: '800' }, titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, item: { borderWidth: 1, borderColor: '#4e425c', borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, selected: { borderColor: C.purple, backgroundColor: '#2d2140' }, itemTitle: { color: C.text, fontSize: 16, fontWeight: '700' }, dot: { color: C.purple, fontSize: 20 }, label: { color: C.text, fontWeight: '700', marginTop: 4 }, manual: { backgroundColor: '#17121f', borderRadius: 12, padding: 12, gap: 4 }, group: { borderWidth: 1, borderColor: '#4e425c', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, groupSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, status: { borderColor: '#4e425c', borderWidth: 1, borderRadius: 12, padding: 12 }, overlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.55)' }, drawer: { width: '78%', maxWidth: 340, flex: 1, backgroundColor: C.panel, paddingTop: 20, paddingHorizontal: 20, gap: 8 }, backdrop: { flex: 1 }, drawerTitle: { color: C.text, fontSize: 28, fontWeight: '900', marginBottom: 4 }, drawerItem: { paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10 }, drawerText: { color: C.text, fontSize: 16, fontWeight: '600' }, activeText: { color: C.orange },
});








