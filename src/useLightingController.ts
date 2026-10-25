import { useEffect, useRef, useState } from 'react';
import { clearCredentials, loadCredentials, saveCredentials } from './storage/credentials';
import { clearGroups, loadGroups, saveGroups } from './storage/groups';
import { clearTimelines, loadTimelines, saveTimelines } from './storage/timelines';
import { clearRooms, loadRooms, saveRooms } from './storage/rooms';
import { clearPlaybackTarget, loadPlaybackTarget, savePlaybackTarget } from './storage/playback-target';
import { resolvePlaybackTarget, type PlaybackTarget } from './services/playback-target';
import { deleteRoom, emptyRoomLayout, moveRoomLight, reorderRoom, saveRoom, type RoomLayout } from './services/rooms';
import { saveLightGroup, groupsForAvailableLights } from './services/groups';
import { discoverBridge, getLights, pairBridge, renameLight, setLightState } from './services/hue';
import { builtInSequences, candlelight, createSequenceRunner, halloweenStorm, validateTimeline, type SequenceRunner } from './services/sequences';
import { createAmbiancePlayback, type AmbianceMode } from './services/ambiance';
import { createAudioTimelineRunner, deleteUnusedAudio } from './services/timeline-audio';
import { createRestoringTimelinePreview, shouldRestoreHomePlayback } from './services/timeline-preview';
import type { HueCredentials, HueLight, HueLightGroup, LightState, LightingSequence, TimelineSequence } from './types/hue';
import { useErrorNotification } from './useErrorNotification';

const message = (error: unknown) => error instanceof Error ? error.message : 'Something unexpected went wrong.';

export function useLightingController() {
  const [credentials, setCredentials] = useState<HueCredentials | null>(null);
  const [bridgeIp, setBridgeIp] = useState('');
  const [lights, setLights] = useState<HueLight[]>([]);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [groups, setGroups] = useState<HueLightGroup[]>([]);
  const [roomLayout, setRoomLayout] = useState(emptyRoomLayout);
  const roomsReady = useRef(false);
  const roomWritePending = useRef(false);
  const [timelines, setTimelines] = useState<TimelineSequence[]>([]);
  const [playbackTarget, setPlaybackTarget] = useState<PlaybackTarget | null>(null);
  const [selectedSequenceId, setSelectedSequenceId] = useState(candlelight.id);
  const [ambianceModes, setAmbianceModes] = useState<AmbianceMode[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Checking saved bridge...');
  const [error, setError] = useErrorNotification();
  const [running, setRunning] = useState(false);
  const [homeRestoring, setHomeRestoring] = useState(false);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [previewRestoring, setPreviewRestoring] = useState(false);
  const runner = useRef<SequenceRunner | null>(null);
  const homeRestoreInFlight = useRef(false);
  const previewRunner = useRef<SequenceRunner | null>(null);
  const previewStopped = useRef(false);
  const stopRequested = useRef(false);

  const reportError = (problem: unknown) => {
    const text = message(problem);
    setError(text);
    setStatus(text);
  };
  const [ambiance] = useState(() => createAmbiancePlayback(setAmbianceModes,
    (name, problem) => reportError(new Error(`${name} ambiance stopped: ${message(problem)}`))));
  const refresh = async (active = credentials) => {
    if (!active) throw new Error('Connect your Hue Bridge first.');
    try {
      const next = await getLights(active);
      setLights(next);
      setSelectedLightId(id => id && next.some(light => light.id === id) ? id : next[0]?.id ?? null);
      setConnected(true);
    } catch (problem) {
      setConnected(false);
      throw problem;
    }
  };
  useEffect(() => {
    void (async () => {
      try {
        const [saved, savedGroups, savedTimelines] = await Promise.all([loadCredentials(), loadGroups(), loadTimelines()]);
        try {
          setRoomLayout(await loadRooms());
          roomsReady.current = true;
        } catch (problem) { reportError(problem); }
        setGroups(savedGroups);
        setTimelines(savedTimelines);
        try { setPlaybackTarget(await loadPlaybackTarget()); }
        catch (problem) { reportError(problem); }
        if (!saved) { setStatus('No bridge connected.'); return; }
        setCredentials(saved);
        setBridgeIp(saved.bridgeIp);
        await refresh(saved);
        setStatus('Connected to your saved Hue Bridge.');
      } catch (problem) { reportError(new Error(`Could not restore bridge: ${message(problem)}`)); }
      finally { setRestoring(false); }
    })();
    return () => { ambiance.dispose(); runner.current?.cancel(); previewRunner.current?.cancel(); };
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); return true; }
    catch (problem) { reportError(problem); return false; }
    finally { setBusy(false); }
  };
  const discover = () => run(async () => {
    const ip = await discoverBridge();
    if (!ip) throw new Error('No bridge was found. Enter its local IP instead.');
    setBridgeIp(ip);
    setStatus('Bridge found. Press its link button, then pair within 30 seconds.');
  });
  const pair = () => run(async () => {
    if (!bridgeIp.trim()) throw new Error('Enter or discover a bridge address first.');
    const next = await pairBridge(bridgeIp);
    await saveCredentials(next);
    if (!(await loadCredentials())) throw new Error('Paired, but credentials could not be saved.');
    setCredentials(next);
    setBridgeIp(next.bridgeIp);
    await refresh(next);
    setStatus('Bridge paired.');
  });
  const reconnect = () => run(async () => { await refresh(); setStatus('Bridge connected. Lights refreshed.'); });
  const forget = () => run(async () => {
    await ambiance.stopAll();
    if (previewRunner.current) { const active = previewRunner.current; active.cancel(); await active.done; }
    stopRequested.current = true;
    if (runner.current) { const active = runner.current; active.cancel(); await active.done; }
    runner.current = null;
    setRunning(false);
    await Promise.all([clearCredentials(), clearGroups(), clearTimelines(), clearRooms(), clearPlaybackTarget()]);
    deleteUnusedAudio(timelines, []);
    setCredentials(null);
    setConnected(false);
    setLights([]);
    setGroups([]);
    setRoomLayout(emptyRoomLayout());
    roomsReady.current = true;
    setTimelines([]);
    setSelectedSequenceId(candlelight.id);
    setSelectedLightId(null);
    setPlaybackTarget(null);
    setStatus('Saved connection and device-local rooms, groups and timelines removed.');
  });
  const update = (id: string, state: LightState) => run(async () => {
    if (!credentials) throw new Error('Connect your Hue Bridge first.');
    await setLightState(credentials, id, state);
    await refresh();
    setStatus('Lamp updated.');
  });
  const saveLightName = (id: string, name: string) => run(async () => {
    if (!credentials) throw new Error('Connect your Hue Bridge first.');
    await renameLight(credentials, id, name);
    await refresh();
    setStatus('Lamp name saved to the Hue Bridge.');
  });
  const saveGroup = (name: string, ids: string[], id?: string) => run(async () => {
    if (id !== undefined && (runner.current || previewRunner.current)) throw new Error('Stop playback before editing a group.');
    const next = saveLightGroup(groups, name, ids, id);
    await saveGroups(next);
    setGroups(next);
    setStatus('Group saved.');
  });
  const removeGroup = (group: HueLightGroup) => run(async () => {
    const next = groups.filter(item => item.id !== group.id);
    await saveGroups(next);
    setGroups(next);
    setStatus('Group deleted. Your Hue lights have not been deleted.');
  });
  const selectPlaybackTarget = (target: PlaybackTarget) => run(async () => {
    await savePlaybackTarget(target);
    setPlaybackTarget(target);
    setStatus('Home playback target saved.');
  });
  const changeRooms = async (change: (layout: RoomLayout) => RoomLayout) => {
    if (roomWritePending.current) {
      reportError(new Error('A room change is still saving. Try again in a moment.'));
      return false;
    }
    roomWritePending.current = true;
    try {
      return await run(async () => {
        if (!roomsReady.current) throw new Error('Saved rooms could not be loaded. Restart the app to try again before editing rooms.');
        const next = change(roomLayout);
        await saveRooms(next);
        setRoomLayout(next);
        setStatus('Room organization saved on this device.');
      });
    } finally { roomWritePending.current = false; }
  };
  const saveLightRoom = (id: string | null, name: string) =>
    changeRooms(layout => saveRoom(layout, id ?? `room-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name));
  const removeLightRoom = (id: string) => changeRooms(layout => deleteRoom(layout, id));
  const reorderLightRoom = (id: string, direction: -1 | 1) => changeRooms(layout => reorderRoom(layout, id, direction));
  const moveLightToRoom = (lightId: string, roomId: string | null, beforeId: string | null = null) =>
    changeRooms(layout => moveRoomLight(layout, lights.map(light => light.id), lightId, roomId, beforeId));
  const saveTimeline = async (sequence: TimelineSequence) => {
    if (ambiance.usesSequence(sequence.id)) throw new Error('Stop this sequence in Ambiance before saving changes.');
    const next = [...timelines.filter(item => item.id !== sequence.id), sequence];
    await saveTimelines(next);
    deleteUnusedAudio(timelines, next);
    setTimelines(next);
    if (!runner.current) setSelectedSequenceId(sequence.id);
    setStatus('Sequence saved.');
  };
  const deleteTimeline = async (id: string) => {
    if (ambiance.usesSequence(id)) throw new Error('Stop this sequence in Ambiance before deleting it.');
    const next = timelines.filter(item => item.id !== id);
    await saveTimelines(next);
    deleteUnusedAudio(timelines, next);
    setTimelines(next);
    if (selectedSequenceId === id) setSelectedSequenceId(candlelight.id);
    setStatus('Sequence deleted.');
  };
  const availableGroups = groupsForAvailableLights(groups, lights.map(light => light.id));
  const homeTarget = resolvePlaybackTarget(playbackTarget, groups, lights);
  const selectedTimeline = timelines.find(item => item.id === selectedSequenceId);
  const selectedSequence = builtInSequences.find(sequence => sequence.id === selectedSequenceId) ?? candlelight;
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
  const playPreset = (sequence: LightingSequence, ids: string[], apply: (id: string, state: LightState) => Promise<void>) =>
    createSequenceRunner({ ...sequence, lightIds: ids }, async (lightIds, state) => {
      const results = await Promise.allSettled(lightIds.map(id => apply(id,
        sequence.id === halloweenStorm.id && lights.find(light => light.id === id)?.kind === 'onoff-plug' && state.brightness === 1
          ? { on: false } : state)));
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) throw new Error(`Could not update ${failures.length} lamp(s): ${message(failures[0]!.reason)}`);
    });
  const startAmbiance = (sequenceId: string, target: PlaybackTarget | null) => run(async () => {
    if (!credentials || !connected) throw new Error('Connect your Hue Bridge first.');
    const timeline = timelines.find(item => item.id === sequenceId);
    const preset = builtInSequences.find(item => item.id === sequenceId);
    if (!timeline && !preset) throw new Error('Choose an available sequence.');
    const group = timeline && availableGroups.find(item => item.id === timeline.groupId);
    const resolved = resolvePlaybackTarget(target, groups, lights);
    const targets = timeline ? group?.lightIds ?? [] : resolved.lightIds;
    if (!targets.length) throw new Error(timeline ? 'This timeline needs its saved group and available lamps.' : 'Choose an available group or lamp.');
    if (timeline) validateTimeline(timeline, targets, lights);
    const ids = preset?.id === candlelight.id ? targets.filter(id => lights.find(light => light.id === id)?.kind !== 'onoff-plug') : targets;
    if (!ids.length) throw new Error('Candlelight needs a dimmable lamp; on/off smart switches cannot flicker.');
    ambiance.start({
      sequenceId, name: (timeline ?? preset)!.name,
      targetName: timeline ? group!.name : resolved.name, lightIds: ids,
    }, apply => timeline ? createAudioTimelineRunner(timeline, apply) : playPreset(preset!, ids, apply),
    (id, state) => sendState(credentials, id, state));
    setStatus(`${(timeline ?? preset)!.name} ambiance started.`);
  });
  const stopAmbiance = (id: string) => ambiance.stop(id);
  const stopAllAmbiance = () => ambiance.stopAll();
  const previewTimeline = async (sequence: TimelineSequence) => {
    if (previewRunner.current || runner.current || busy) return;
    const group = availableGroups.find(item => item.id === sequence.groupId);
    if (!credentials || !group || sequence.events.some(event => !group.lightIds.includes(event.lightId))) {
      throw new Error('Connect to the Hue Bridge and choose a group with all preview lamps available.');
    }
    setError(null);
    let failed = false;
    const active = ambiance.foreground(sequence.events.map(event => event.lightId), () => createRestoringTimelinePreview(sequence,
      () => getLights(credentials),
      (id, state) => sendState(credentials, id, state),
      (timeline, apply) => createAudioTimelineRunner(timeline, apply),
      () => { setPreviewRestoring(true); setStatus('Restoring the lamps from before preview...'); }));
    previewRunner.current = active;
    setPreviewRunning(true);
    setPreviewRestoring(false);
    setStatus(`Previewing ${sequence.name}...`);
    try { await active.done; }
    catch (problem) { failed = true; reportError(new Error(`Preview: ${message(problem)}`)); }
    finally {
      if (previewRunner.current === active) {
        const stopped = previewStopped.current;
        previewRunner.current = null;
        previewStopped.current = false;
        setPreviewRunning(false);
        setPreviewRestoring(false);
        try { await refresh(); } catch (problem) { failed = true; reportError(new Error(`Could not refresh lamps: ${message(problem)}`)); }
        if (!failed) setStatus(stopped ? 'Preview stopped; lamps restored.' : 'Preview finished; lamps restored.');
      }
    }
  };
  const stopPreview = () => {
    if (!previewRunner.current) return;
    previewStopped.current = true;
    previewRunner.current.cancel();
    setStatus('Stopping preview and restoring lamps...');
  };
  const leavePreview = async () => {
    const active = previewRunner.current;
    if (!active) return;
    stopPreview();
    try { await active.done; }
    catch (problem) { reportError(new Error(`Preview: ${message(problem)}`)); }
  };
  const start = async () => {
    if (runner.current || previewRunner.current) return;
    setError(null);
    if (selectedTimeline && (!timelineGroup || selectedTimeline.events.some(event => !timelineGroup.lightIds.includes(event.lightId)))) {
      reportError(new Error('A timeline lamp is unavailable. Restore it or edit the sequence before running.'));
      return;
    }
    const sequence = selectedSequence;
    const targets = selectedTimeline ? (timelineGroup?.lightIds ?? []) : homeTarget.lightIds;
    const ids = !selectedTimeline && sequence.id === candlelight.id ? targets.filter(id => lights.find(light => light.id === id)?.kind !== 'onoff-plug') : targets;
    if (!credentials || !targets.length || !ids.length) {
      reportError(new Error(selectedTimeline ? 'This timeline needs its group and at least one available lamp.' : !ids.length && targets.length ? 'Candlelight needs a dimmable lamp; on/off smart switches cannot flicker.' : 'Choose a lamp or group first.'));
      return;
    }
    stopRequested.current = false;
    const restoreHome = shouldRestoreHomePlayback(selectedTimeline);
    homeRestoreInFlight.current = restoreHome;
    const active = ambiance.foreground(selectedTimeline ? selectedTimeline.events.map(event => event.lightId) : ids, () => selectedTimeline
      ? restoreHome
        ? createRestoringTimelinePreview(selectedTimeline, () => getLights(credentials), (id, state) => sendState(credentials, id, state),
          (timeline, apply) => createAudioTimelineRunner(timeline, apply), () => { setHomeRestoring(true); setStatus('Restoring the lamps from before playback...'); })
        : createAudioTimelineRunner(selectedTimeline, (id, state) => sendState(credentials, id, state))
      : playPreset(sequence, ids, (id, state) => sendState(credentials, id, state)));
    runner.current = active;
    setRunning(true);
    setStatus(`${sequenceName} is running...`);
    let failed = false;
    try {
      await active.done;
      if (runner.current === active && !stopRequested.current) setStatus(`${sequenceName} finished.${restoreHome ? ' Lamps restored.' : ''}`);
    } catch (problem) {
      failed = true;
      if (!stopRequested.current || restoreHome) reportError(problem);
    } finally {
      if (runner.current === active) {
        runner.current = null;
        setRunning(false);
        homeRestoreInFlight.current = false;
        setHomeRestoring(false);
        try { await refresh(); } catch (problem) { failed = true; reportError(new Error(`Could not refresh lamps: ${message(problem)}`)); }
        if (restoreHome && stopRequested.current && !failed) setStatus('Sequence stopped; lamps restored.');
      }
    }
  };
  const stop = () => {
    if (homeRestoring) return;
    stopRequested.current = true;
    runner.current?.cancel();
    setStatus(homeRestoreInFlight.current ? 'Stopping sequence and restoring lamps...' : 'Sequence stopped.');
  };
  const targetMissing = !credentials || (selectedTimeline
    ? !timelineGroup || !(selectedTimeline.events.length || selectedTimeline.backgroundAudio || selectedTimeline.audioEffects?.length) || selectedTimeline.events.some(event => !timelineGroup.lightIds.includes(event.lightId))
    : !homeTarget.lightIds.length);

  return {
    credentials, bridgeIp, setBridgeIp, lights, groups, roomLayout, timelines, selectedLightId, setSelectedLightId,
    ambianceModes, startAmbiance, stopAmbiance, stopAllAmbiance,
    playbackTarget, selectPlaybackTarget, homeTarget, selectedSequenceId, setSelectedSequenceId,
    selectedTimeline, timelineGroup, sequenceName, availableGroups, busy, restoring, connected, status, error,
    clearError: () => setError(null), running, homeRestoring, previewRunning, previewRestoring, targetMissing,
    discover, pair, reconnect, forget, update, saveLightName, saveGroup, removeGroup, saveTimeline,
    saveLightRoom, removeLightRoom, reorderLightRoom, moveLightToRoom,
    deleteTimeline, previewTimeline, stopPreview, leavePreview, start, stop,
  };
}

export type LightingController = ReturnType<typeof useLightingController>;
