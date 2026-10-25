import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { List, RadioButton, Text } from 'react-native-paper';
import { builtInSequences, candlelight } from '../services/sequences';
import { resolvePlaybackTarget, type PlaybackTarget } from '../services/playback-target';
import { palette } from '../theme';
import type { LightingController } from '../useLightingController';
import { PlaybackTargetPicker } from './PlaybackTargetPicker';
import { Action, Caption, EmptyState, Panel, Sheet, ui } from './ui';

export function AmbianceScreen({ controller: c }: { controller: Pick<LightingController,
  'timelines' | 'groups' | 'availableGroups' | 'lights' | 'roomLayout' | 'ambianceModes' | 'busy' | 'restoring' |
  'connected' | 'error' | 'startAmbiance' | 'stopAmbiance'> }) {
  const { width } = useWindowDimensions();
  const [adding, setAdding] = useState(false);
  const [section, setSection] = useState<'configure' | 'sequence' | 'target'>('configure');
  const [sequenceId, setSequenceId] = useState(candlelight.id);
  const [target, setTarget] = useState<PlaybackTarget | null>(null);
  const sequences = [...builtInSequences, ...c.timelines];
  const selected = sequences.find(sequence => sequence.id === sequenceId);
  const timeline = c.timelines.find(sequence => sequence.id === sequenceId);
  const group = timeline && c.availableGroups.find(item => item.id === timeline.groupId);
  const resolved = resolvePlaybackTarget(target, c.groups, c.lights);
  const targetName = timeline ? group?.name ?? 'Saved group unavailable' : resolved.name;
  const targets = timeline ? group?.lightIds ?? [] : resolved.lightIds;
  const lightIds = sequenceId === candlelight.id ? targets.filter(id => c.lights.find(light => light.id === id)?.kind !== 'onoff-plug') : targets;
  const missingTimelineLamp = timeline?.events.some(event => !lightIds.includes(event.lightId)) ?? false;
  const overlap = c.ambianceModes.some(mode => mode.lightIds.some(id => lightIds.includes(id)));
  const locked = c.busy || c.restoring || !c.connected;
  const open = () => { setSection('configure'); setAdding(true); };

  return <View style={ui.stack}>
    {!c.ambianceModes.length && <EmptyState icon="creation" title="No ambiance running" description="Choose a sequence and let it repeat." />}
    {c.ambianceModes.some(mode => mode.activeLightIds.length < mode.lightIds.length) &&
      <Panel tonal><Caption>Home or preview playback has priority. Ambiance resumes on those lamps when playback ends.</Caption></Panel>}
    <View style={[ui.stack, width >= 900 && styles.grid]}>
      {c.ambianceModes.map(mode => {
        const waiting = mode.lightIds.filter(id => !mode.activeLightIds.includes(id));
        const state = mode.stopping ? 'Stopping...' : !waiting.length ? 'Running'
          : !mode.activeLightIds.length ? 'Waiting for playback' : `${mode.activeLightIds.length} of ${mode.lightIds.length} active`;
        return <Panel key={mode.id} style={width >= 900 ? styles.card : undefined}>
          <View style={[ui.between, styles.heading]}>
            <Text variant="titleLarge" accessibilityRole="header" style={styles.name}>{mode.name}</Text>
            <Text variant="labelMedium" accessibilityLiveRegion="polite" style={{ color: waiting.length ? palette.accent : palette.success }}>{state}</Text>
          </View>
          <Caption>{mode.targetName} · {mode.lightIds.length} lamp{mode.lightIds.length === 1 ? '' : 's'}</Caption>
          {!!waiting.length && <Caption>Waiting: {waiting.map(id => c.lights.find(light => light.id === id)?.name ?? id).join(', ')}</Caption>}
          <Action mode="outlined" icon="stop" disabled={mode.stopping} loading={mode.stopping} onPress={() => { void c.stopAmbiance(mode.id); }}>
            Stop {mode.name}
          </Action>
        </Panel>;
      })}
    </View>
    <Action icon="plus" disabled={locked} onPress={open}>Add ambiance</Action>
    <Sheet visible={adding} title={section === 'sequence' ? 'Choose sequence' : section === 'target' ? 'Choose group or lamp' : 'Add ambiance'}
      onDismiss={() => { if (!c.busy) setAdding(false); }}>
      {c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}
      {section === 'sequence' ? <>
        {sequences.map(sequence => <RadioButton.Item key={sequence.id} label={sequence.name} value={sequence.id}
          status={sequenceId === sequence.id ? 'checked' : 'unchecked'} disabled={locked}
          onPress={() => { setSequenceId(sequence.id); setSection('configure'); }} />)}
        <Action mode="text" onPress={() => setSection('configure')}>Back</Action>
      </> : section === 'target' ? <>
        <PlaybackTargetPicker controller={c} value={target} disabled={locked}
          onSelect={next => { setTarget(next); setSection('configure'); }} />
        <Action mode="text" onPress={() => setSection('configure')}>Back</Action>
      </> : <>
        <List.Item title="Sequence" description={selected?.name ?? 'Choose a sequence'} accessibilityLabel={`Choose sequence, ${selected?.name ?? 'none selected'}`}
          accessibilityRole="button" onPress={() => setSection('sequence')} disabled={locked} right={props => <List.Icon {...props} icon="chevron-down" />} />
        <List.Item title={timeline ? 'Timeline group' : 'Group or lamp'} description={targetName}
          accessibilityRole={timeline ? 'text' : 'button'} accessibilityLabel={`${timeline ? 'Timeline group' : 'Choose group or lamp'}, ${targetName}`}
          onPress={timeline ? undefined : () => setSection('target')} disabled={locked}
          right={props => <List.Icon {...props} icon={timeline ? 'lock-outline' : 'chevron-down'} />} />
        {timeline && <Caption>Repeats the saved timeline and its audio using its saved group. Restore-after-Home playback does not apply here.</Caption>}
        {!lightIds.length && <Caption>{targets.length ? 'Candlelight needs a dimmable lamp.' : 'Choose an available group or lamp.'}</Caption>}
        {missingTimelineLamp && <Text accessibilityRole="alert" style={styles.error}>A timeline lamp is unavailable. Restore it or edit the sequence first.</Text>}
        {overlap && <Caption>Another ambiance uses these lamps. Both will send commands; overlapping effects may conflict.</Caption>}
        {sequenceId === 'halloween-storm' && <Caption>Occasional bright bursts with dark or barely glowing gaps. No rapid strobing.</Caption>}
        <Action disabled={locked || !selected || !lightIds.length || missingTimelineLamp} loading={c.busy}
          onPress={() => { void c.startAmbiance(sequenceId, target).then(ok => { if (ok) setAdding(false); }); }}>Start ambiance</Action>
        <Action mode="text" disabled={c.busy} onPress={() => setAdding(false)}>Cancel</Action>
      </>}
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  card: { width: '48%', flexGrow: 1 },
  heading: { flexWrap: 'wrap' },
  name: { flexShrink: 1 },
  error: { color: palette.error },
});
