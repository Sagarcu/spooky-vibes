import { useEffect, useState } from 'react';
import Slider from '@react-native-community/slider';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Dialog, List, Portal, RadioButton, Text } from 'react-native-paper';
import { builtInSequences, candlelight } from '../services/sequences';
import { defaultAmbianceSettings, isAmbianceSettings, isBuiltInAmbiance, type AmbianceColor, type AmbianceWhite, type SavedAmbiance } from '../services/ambiance-settings';
import { isWhiteOnlyLight } from '../services/hue-state';
import { resolvePlaybackTarget } from '../services/playback-target';
import { hsvHex } from '../services/color-wheel';
import { PlaybackTargetPicker } from './PlaybackTargetPicker';
import { ColorWheel } from './ColorWheel';
import { ColorPresetMenus } from './ColorPresetMenus';
import { palette, spacing } from '../theme';
import type { LightingController } from '../useLightingController';
import { Action, Caption, EmptyState, Field, Panel, Sheet, ui } from './ui';

const colorDescription = (color: AmbianceColor) => color.mode === 'keep' ? 'keep current color'
  : color.mode === 'white' ? `${color.temperature} K` : hsvHex(color.hue / 65535 * 360, color.saturation / 254 * 100, 100).toUpperCase();

const whiteDescription = (color?: AmbianceWhite) => color?.mode === 'white' ? `${color.temperature} K` : 'keep current white';

function ColorSetting({ title, color, onChange, onPickingChange, disabled, whiteCapable }: {
  title: string; color: AmbianceColor; onChange: (color: AmbianceColor) => void; onPickingChange: (picking: boolean) => void; disabled: boolean; whiteCapable: boolean;
}) {
  const [lastColor, setLastColor] = useState({ hue: color.mode === 'color' ? color.hue : 6500, saturation: color.mode === 'color' ? color.saturation : 254 });
  const [wheelDraft, setWheelDraft] = useState<{ hue: number; saturation: number } | null>(null);
  const rgb = color.mode === 'color' ? color : lastColor;
  const selectColor = (hue: number, saturation: number) => {
    const next = { hue: Math.round(hue / 360 * 65535), saturation: Math.round(saturation / 100 * 254) };
    setLastColor(next);
    setWheelDraft(null);
    onChange({ mode: 'color', ...next });
  };
  useEffect(() => () => onPickingChange(false), [onPickingChange]);
  return <Panel tonal>
    <Text variant="titleMedium" accessibilityRole="header">{title}</Text>
    <ColorWheel disabled={disabled} maxSize={228} allowBlack={false}
      hue={wheelDraft?.hue ?? rgb.hue / 65535 * 360} saturation={wheelDraft?.saturation ?? rgb.saturation / 254 * 100}
      onChange={(hue, saturation) => setWheelDraft({ hue, saturation })} onChangeComplete={selectColor}
      onHexChange={(hue, saturation) => selectColor(hue, saturation)}
      onGestureStart={() => onPickingChange(true)} onGestureEnd={() => { setWheelDraft(null); onPickingChange(false); }} />
    <ColorPresetMenus whiteCapable={whiteCapable} disabled={disabled} colorTemperature={color.mode === 'white' ? color.temperature : undefined}
      onSelect={state => {
        if ('colorTemperature' in state) onChange({ mode: 'white', temperature: state.colorTemperature });
        else { setLastColor(state); onChange({ mode: 'color', ...state }); }
      }} />
    {!(color.mode === 'white' && whiteCapable) && <Caption>{colorDescription(color)}</Caption>}
    {color.mode === 'white' && whiteCapable && <>
      <Caption>White temperature · {color.temperature} K</Caption>
      <Slider disabled={disabled} accessibilityLabel={`${title} temperature`} accessibilityValue={{ min: 2000, max: 6500, now: color.temperature, text: `${color.temperature} kelvin` }}
        value={color.temperature} minimumValue={2000} maximumValue={6500} step={100} minimumTrackTintColor={palette.primary}
        maximumTrackTintColor={palette.high} thumbTintColor={palette.primary} style={styles.slider}
        onValueChange={temperature => onChange({ mode: 'white', temperature })} />
    </>}
    <Action mode="text" icon={color.mode === 'keep' ? 'check' : 'restore'} disabled={disabled} onPress={() => onChange({ mode: 'keep' })}>Keep current color</Action>
  </Panel>;
}

type Props = { controller: Pick<LightingController,
  'timelines' | 'groups' | 'availableGroups' | 'lights' | 'roomLayout' | 'ambianceModes' | 'savedAmbiances' |
  'busy' | 'restoring' | 'connected' | 'error' | 'clearError' | 'saveAmbiance' | 'removeAmbiance' |
  'startAmbiance' | 'stopAmbiance' | 'stopAmbianceForEdit'> };

function WhiteSetting({ title, color, disabled, onChange }: {
  title: string; color: AmbianceWhite; disabled: boolean; onChange: (color: AmbianceWhite) => void;
}) {
  return <View style={ui.stack}>
    <Text variant="titleSmall" accessibilityRole="header">{title}</Text>
    <ColorPresetMenus whiteCapable colorCapable={false} disabled={disabled}
      colorTemperature={color.mode === 'white' ? color.temperature : undefined}
      onSelect={state => { if ('colorTemperature' in state) onChange({ mode: 'white', temperature: state.colorTemperature }); }} />
    <Caption>{color.mode === 'keep' ? 'Keep current white' : `${color.temperature} K`}</Caption>
    <Slider disabled={disabled || color.mode === 'keep'} accessibilityLabel={`${title} temperature`}
      accessibilityValue={color.mode === 'white' ? { min: 2000, max: 6500, now: color.temperature, text: `${color.temperature} kelvin` } : { text: 'Keep current white' }}
      value={color.mode === 'white' ? color.temperature : 2200} minimumValue={2000} maximumValue={6500} step={100}
      minimumTrackTintColor={palette.primary} maximumTrackTintColor={palette.high} thumbTintColor={palette.primary} style={styles.slider}
      onValueChange={temperature => onChange({ mode: 'white', temperature })} />
    <View style={ui.between}><Caption>Warm</Caption><Caption>Cool</Caption></View>
    <Action mode="text" icon={color.mode === 'keep' ? 'check' : 'restore'} disabled={disabled}
      accessibilityLabel={`${title}: keep current white`} onPress={() => onChange({ mode: 'keep' })}>Keep current white</Action>
  </View>;
}

export function AmbianceScreen({ controller: c }: Props) {
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<SavedAmbiance | null>(null);
  const [section, setSection] = useState<'configure' | 'sequence' | 'target'>('configure');
  const [minimum, setMinimum] = useState('8');
  const [maximum, setMaximum] = useState('50');
  const [pickingColor, setPickingColor] = useState(false);
  const [deleting, setDeleting] = useState<SavedAmbiance | null>(null);
  const [editingRunning, setEditingRunning] = useState<SavedAmbiance | null>(null);
  const locked = c.busy || c.restoring;
  const sequences = [...builtInSequences, ...c.timelines];
  const sequence = sequences.find(item => item.id === draft?.sequenceId);
  const timeline = c.timelines.find(item => item.id === draft?.sequenceId);
  const group = timeline && c.availableGroups.find(item => item.id === timeline.groupId);
  const resolved = resolvePlaybackTarget(draft?.target ?? null, c.groups, c.lights);
  const ids = timeline ? group?.lightIds ?? [] : resolved.lightIds;
  const hasRgb = c.lights.some(light => ids.includes(light.id) && light.colorCapable);
  const hasRgbWhite = c.lights.some(light => ids.includes(light.id) && light.colorCapable && light.colorTemperatureCapable);
  const hasWhiteOnly = c.lights.some(light => ids.includes(light.id) && isWhiteOnlyLight(light));
  const hasDimmable = c.lights.some(light => ids.includes(light.id) && light.kind !== 'onoff-plug');
  const settings = draft?.settings;
  const rangeValid = !settings || isAmbianceSettings({ ...settings, minBrightness: Number(minimum), maxBrightness: Number(maximum) }) && minimum.trim() !== '' && maximum.trim() !== '';
  const missingTimeline = timeline?.events.some(event => !ids.includes(event.lightId)) ?? false;
  const overlap = c.ambianceModes.some(mode => mode.configurationId !== draft?.id && mode.lightIds.some(id => ids.includes(id)));
  const canSave = !!draft?.name.trim() && !!sequence && !!ids.length && !missingTimeline && rangeValid;

  const open = (configuration?: SavedAmbiance) => {
    c.clearError();
    const next = configuration ?? {
      id: `ambiance-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: '', sequenceId: candlelight.id, target: null, settings: defaultAmbianceSettings(candlelight.id),
    };
    setDraft(next);
    setMinimum(String(next.settings?.minBrightness ?? 8));
    setMaximum(String(next.settings?.maxBrightness ?? 50));
    setSection('configure');
    setPickingColor(false);
  };
  const chooseSequence = (sequenceId: string) => {
    if (!draft) return;
    const next = isBuiltInAmbiance(sequenceId) ? defaultAmbianceSettings(sequenceId) : undefined;
    setDraft({ ...draft, sequenceId, settings: next });
    setMinimum(String(next?.minBrightness ?? 8));
    setMaximum(String(next?.maxBrightness ?? 50));
    setSection('configure');
  };
  const save = async (start: boolean) => {
    if (!draft || !canSave) return;
    const next = { ...draft, settings: settings ? { ...settings, minBrightness: Number(minimum), maxBrightness: Number(maximum) } : undefined };
    if (await c.saveAmbiance(next, start)) setDraft(null);
  };
  const edit = (configuration: SavedAmbiance) => {
    if (c.ambianceModes.some(mode => mode.configurationId === configuration.id)) setEditingRunning(configuration);
    else open(configuration);
  };
  return <View style={ui.stack}>
    {!c.savedAmbiances.length && <EmptyState icon="candle" title="No saved ambiance" />}
    <View style={[ui.stack, width >= 900 && styles.grid]}>
      {c.savedAmbiances.map(configuration => {
        const active = c.ambianceModes.find(mode => mode.configurationId === configuration.id);
        const waiting = active?.lightIds.filter(id => !active.activeLightIds.includes(id)) ?? [];
        const state = !active ? 'Stopped' : active.stopping ? 'Stopping...' : !waiting.length ? 'Running'
          : !active.activeLightIds.length ? 'Waiting for playback' : `${active.activeLightIds.length} of ${active.lightIds.length} active`;
        const savedTimeline = c.timelines.find(item => item.id === configuration.sequenceId);
        const savedTarget = resolvePlaybackTarget(configuration.target, c.groups, c.lights);
        const target = savedTimeline ? c.groups.find(item => item.id === savedTimeline.groupId)?.name ?? 'Saved group unavailable' : savedTarget.name;
        const targetLights = c.lights.filter(light => savedTarget.lightIds.includes(light.id));
        const plugOnly = targetLights.length > 0 && targetLights.every(light => light.kind === 'onoff-plug');
        const rgb = targetLights.some(light => light.colorCapable);
        const whiteOnly = targetLights.some(isWhiteOnlyLight);
        const effect = sequences.find(item => item.id === configuration.sequenceId)?.name ?? 'Saved timeline unavailable';
        return <Panel key={configuration.id} style={width >= 900 ? styles.card : undefined}>
          <View style={[ui.between, styles.heading]}>
            <Text variant="titleLarge" accessibilityRole="header" style={styles.name}>{configuration.name}</Text>
            <Text variant="labelMedium" accessibilityLiveRegion="polite" style={{ color: active ? waiting.length ? palette.accent : palette.success : palette.muted }}>{state}</Text>
          </View>
          <Caption>{effect} · {target}</Caption>
          {configuration.settings && (plugOnly
            ? <Caption>{configuration.sequenceId === candlelight.id ? 'Power only: stays on' : 'Power only: on for lightning, off in gaps'}</Caption>
            : <Caption>{configuration.sequenceId === candlelight.id ? 'Flicker' : 'Lightning'}: {configuration.settings.minBrightness}–{configuration.settings.maxBrightness}%
              {rgb ? ` · ${colorDescription(configuration.settings.color)}${configuration.sequenceId === 'halloween-storm' ? ` · glow: ${colorDescription(configuration.settings.glowColor)}` : ''}` : ''}</Caption>)}
          {configuration.settings && whiteOnly && <Caption>White-only: {whiteDescription(configuration.settings.whiteColor)}
            {configuration.sequenceId === 'halloween-storm' ? ` · glow: ${whiteDescription(configuration.settings.glowWhiteColor)}` : ''}</Caption>}
          {!!waiting.length && <Caption>Waiting for Home/preview: {waiting.map(id => c.lights.find(light => light.id === id)?.name ?? id).join(', ')}</Caption>}
          <Action mode={active ? 'outlined' : 'contained'} icon={active ? 'stop' : 'play-outline'} disabled={locked || !!active?.stopping || !active && !c.connected}
            accessibilityLabel={`${active ? 'Stop' : 'Start'} ${configuration.name}`} loading={active?.stopping}
            onPress={() => { if (active) void c.stopAmbiance(active.id); else void c.startAmbiance(configuration.id); }}>
            {active ? 'Stop' : 'Start'}
          </Action>
          <View style={ui.wrap}><Action mode="text" disabled={locked || !!active?.stopping} accessibilityLabel={`Edit ${configuration.name}`} onPress={() => edit(configuration)}>Edit</Action>
            <Action mode="text" textColor={palette.error} disabled={locked || !!active?.stopping} accessibilityLabel={`Delete ${configuration.name}`} onPress={() => setDeleting(configuration)}>Delete</Action></View>
        </Panel>;
      })}
    </View>
    {c.ambianceModes.filter(mode => !c.savedAmbiances.some(configuration => configuration.id === mode.configurationId)).map(mode =>
      <Panel key={mode.id}><Text variant="titleLarge">{mode.name}</Text><Caption>{mode.targetName} · Unsaved</Caption>
        <Action mode="outlined" disabled={locked || mode.stopping} onPress={() => { void c.stopAmbiance(mode.id); }}>Stop {mode.name}</Action></Panel>)}
    <Action icon="plus" disabled={locked} onPress={() => open()}>Add ambiance</Action>
    <Sheet visible={!!draft} title={section === 'sequence' ? 'Choose effect' : section === 'target' ? 'Choose group or lamp'
      : c.savedAmbiances.some(item => item.id === draft?.id) ? 'Edit ambiance' : 'New ambiance'}
      scrollEnabled={!pickingColor} onDismiss={() => { if (!locked) setDraft(null); }}
      footer={section === 'configure' ? <View style={styles.saveActions}>
        <Action mode="outlined" disabled={locked || !canSave} loading={c.busy} style={styles.saveAction} onPress={() => { void save(false); }}>Save</Action>
        <Action disabled={locked || !canSave || !c.connected} style={styles.saveAction} onPress={() => { void save(true); }}>Save &amp; start</Action>
      </View> : undefined}>
      {c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}
      {draft && (section === 'sequence' ? <>
        {sequences.map(item => <RadioButton.Item key={item.id} label={item.name} value={item.id}
          status={draft.sequenceId === item.id ? 'checked' : 'unchecked'} disabled={locked} onPress={() => chooseSequence(item.id)} />)}
        <Action mode="text" onPress={() => setSection('configure')}>Back</Action>
      </> : section === 'target' ? <>
        <PlaybackTargetPicker controller={c} value={draft.target} disabled={locked}
          onSelect={target => { setDraft({ ...draft, target }); setSection('configure'); }} />
        <Action mode="text" onPress={() => setSection('configure')}>Back</Action>
      </> : <>
        <Field label="Ambiance name" value={draft.name} maxLength={60} editable={!locked} onChangeText={name => setDraft({ ...draft, name })} />
        <List.Item title="Effect" description={sequence?.name ?? 'Saved timeline unavailable'} accessibilityRole="button" disabled={locked}
          onPress={() => setSection('sequence')} right={props => <List.Icon {...props} icon="chevron-down" />} />
        <List.Item title={timeline ? 'Timeline group' : 'Group or lamp'} description={timeline ? group?.name ?? 'Saved group unavailable' : resolved.name}
          accessibilityRole={timeline ? 'text' : 'button'} disabled={locked}
          onPress={timeline ? undefined : () => setSection('target')} right={props => <List.Icon {...props} icon={timeline ? 'lock-outline' : 'chevron-down'} />} />
        {!timeline && settings && <>
          {hasDimmable && <Panel tonal>
            <Text variant="titleMedium" accessibilityRole="header">{draft.sequenceId === candlelight.id ? 'Flicker brightness' : 'Lightning brightness'}</Text>
            <View style={ui.row}>
              <Field label="Minimum (%)" value={minimum} onChangeText={setMinimum} keyboardType="number-pad" editable={!locked} style={ui.flex} error={!rangeValid} />
              <Field label="Maximum (%)" value={maximum} onChangeText={setMaximum} keyboardType="number-pad" editable={!locked} style={ui.flex} error={!rangeValid} />
            </View>
            <Caption>Minimum</Caption>
            <Slider accessibilityLabel="Minimum brightness" disabled={locked} value={Number(minimum) || 1} minimumValue={1} maximumValue={100} step={1}
              minimumTrackTintColor={palette.primary} maximumTrackTintColor={palette.high} thumbTintColor={palette.primary} style={styles.slider} onValueChange={value => setMinimum(String(value))} />
            <Caption>Maximum</Caption>
            <Slider accessibilityLabel="Maximum brightness" disabled={locked} value={Number(maximum) || 1} minimumValue={1} maximumValue={100} step={1}
              minimumTrackTintColor={palette.primary} maximumTrackTintColor={palette.high} thumbTintColor={palette.primary} style={styles.slider} onValueChange={value => setMaximum(String(value))} />
            {!rangeValid && <Text accessibilityRole="alert" style={styles.error}>Use whole percentages from 1 to 100. Minimum must not exceed maximum.</Text>}
          </Panel>}
          {hasWhiteOnly && <Panel tonal>
            <Text variant="titleMedium" accessibilityRole="header">White-only lamps</Text>
            <WhiteSetting title={draft.sequenceId === candlelight.id ? 'Candlelight white' : 'Lightning white'}
              color={settings.whiteColor ?? { mode: 'keep' }} disabled={locked}
              onChange={whiteColor => setDraft({ ...draft, settings: { ...settings, whiteColor } })} />
            {draft.sequenceId === 'halloween-storm' && <>
              <WhiteSetting title="Faint-glow white" color={settings.glowWhiteColor ?? { mode: 'keep' }} disabled={locked}
                onChange={glowWhiteColor => setDraft({ ...draft, settings: { ...settings, glowWhiteColor } })} />
            </>}
          </Panel>}
          {hasRgb && <ColorSetting title={draft.sequenceId === candlelight.id ? 'RGB lamp color' : 'RGB lightning color'} color={settings.color}
            onChange={color => setDraft({ ...draft, settings: { ...settings, color } })} onPickingChange={setPickingColor} disabled={locked} whiteCapable={hasRgbWhite} />}
          {draft.sequenceId === 'halloween-storm' && hasRgb && <ColorSetting title="RGB faint-glow color" color={settings.glowColor}
            onChange={glowColor => setDraft({ ...draft, settings: { ...settings, glowColor } })} onPickingChange={setPickingColor} disabled={locked} whiteCapable={hasRgbWhite} />}
          <Action mode="text" disabled={locked} onPress={() => {
            const next = defaultAmbianceSettings(draft.sequenceId); setMinimum(String(next.minBrightness)); setMaximum(String(next.maxBrightness)); setDraft({ ...draft, settings: next });
          }}>Reset effect defaults</Action>
        </>}
        {!ids.length && <Caption>Choose an available group or lamp.</Caption>}
        {missingTimeline && <Text accessibilityRole="alert" style={styles.error}>A timeline lamp is unavailable. Restore it or edit the timeline first.</Text>}
        {overlap && <Caption>Overlapping ambiance may conflict.</Caption>}
      </>)}
    </Sheet>
    <Portal>
      <Dialog visible={!!deleting} onDismiss={() => { if (!locked) setDeleting(null); }}>
        <Dialog.Title>Delete ambiance?</Dialog.Title><Dialog.Content><Caption>Delete {deleting?.name} and its settings? Playback will stop.</Caption></Dialog.Content>
        <Dialog.Actions><Action mode="text" disabled={locked} onPress={() => setDeleting(null)}>Cancel</Action><Action mode="text" textColor={palette.error} disabled={locked}
          onPress={() => { if (deleting) void c.removeAmbiance(deleting.id).then(ok => { if (ok) setDeleting(null); }); }}>Delete</Action></Dialog.Actions>
      </Dialog>
      <Dialog visible={!!editingRunning} onDismiss={() => { if (!locked) setEditingRunning(null); }}>
        <Dialog.Title>Stop to edit?</Dialog.Title><Dialog.Content><Caption>Stop {editingRunning?.name} to edit its settings?</Caption></Dialog.Content>
        <Dialog.Actions><Action mode="text" disabled={locked} onPress={() => setEditingRunning(null)}>Cancel</Action><Action mode="text" disabled={locked}
          onPress={() => { if (editingRunning) void c.stopAmbianceForEdit(editingRunning.id).then(ok => { if (ok) { open(editingRunning); setEditingRunning(null); } }); }}>Stop &amp; edit</Action></Dialog.Actions>
      </Dialog>
    </Portal>
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  card: { width: '48%', flexGrow: 1 },
  heading: { flexWrap: 'wrap' },
  name: { flexShrink: 1 },
  saveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  saveAction: { flexGrow: 1, flexBasis: 140 },
  slider: { minHeight: 48 },
  error: { color: palette.error },
});
