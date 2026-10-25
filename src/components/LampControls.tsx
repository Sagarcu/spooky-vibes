import { useEffect, useRef, useState, type ComponentRef } from 'react';
import Slider from '@react-native-community/slider';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Dialog, Icon, IconButton, Menu, Portal, Switch, Text, TouchableRipple } from 'react-native-paper';
import { colors, nearestWhitePreset, whites } from '../services/light-presets';
import { hsvHex } from '../services/color-wheel';
import { palette, radius, spacing } from '../theme';
import type { HueLight, LightState } from '../types/hue';
import type { LightingController } from '../useLightingController';
import { ColorWheel } from './ColorWheel';
import { RoomLights } from './RoomLights';
import { Action, Caption, EmptyState, Field, Panel, ui } from './ui';

const kinds: Record<HueLight['kind'], string> = {
  color: 'Color lamp', 'tunable-white': 'Tunable white', dimmable: 'Dimmable lamp',
  'onoff-plug': 'Smart switch', 'dimmable-plug': 'Dimmable smart switch',
};

const whiteSwatches: Record<(typeof whites)[number][1], string> = {
  2200: '#ff932c', 2700: '#ffa757', 3000: '#ffb16e',
  3500: '#ffc18d', 4000: '#ffcea6', 5000: '#ffe4ce',
};

function Brightness({ light, disabled, onApply }: { light: HueLight; disabled: boolean; onApply: (state: LightState) => void }) {
  const [level, setLevel] = useState(light.on ? light.brightness : 0);
  useEffect(() => { setLevel(light.on ? light.brightness : 0); }, [light]);
  return <View>
    <View style={ui.between}><Text variant="titleMedium">Brightness</Text><Text>{level}%</Text></View>
    <Slider accessibilityLabel={`${light.name} brightness`} minimumValue={0} maximumValue={100} step={1} value={level} onValueChange={setLevel}
      onSlidingComplete={value => onApply(value === 0 ? { on: false } : { on: true, brightness: value })}
      minimumTrackTintColor={palette.primary} maximumTrackTintColor={palette.high} thumbTintColor={palette.primary} disabled={disabled} style={styles.slider} />
  </View>;
}

function LampColorWheel({ light, disabled, onApply, onPickingColor }: {
  light: HueLight; disabled: boolean; onApply: (state: LightState) => void; onPickingColor: (picking: boolean) => void;
}) {
  const [draft, setDraft] = useState<{ hue: number; saturation: number } | null>(null);
  useEffect(() => () => onPickingColor(false), [onPickingColor]);
  return <ColorWheel hue={draft?.hue ?? (light.hue ?? 0) / 65535 * 360}
    saturation={draft?.saturation ?? (light.saturation ?? 254) / 254 * 100}
    brightness={light.on ? (light.brightnessRaw === undefined ? light.brightness : light.brightnessRaw / 254 * 100) : 0} maxSize={228} disabled={disabled}
    onGestureStart={() => onPickingColor(true)}
    onGestureEnd={() => { setDraft(null); onPickingColor(false); }}
    onChange={(hue, saturation) => setDraft({ hue, saturation })}
    onChangeComplete={(hue, saturation) => {
      setDraft(null);
      onApply({ on: true, brightness: light.brightness || 80, hue: hue / 360 * 65535, saturation: saturation / 100 * 254 });
    }}
    onHexChange={(hue, saturation, brightness) => {
      setDraft(null);
      onApply({ on: brightness > 0, brightness, hue: hue / 360 * 65535, saturation: saturation / 100 * 254 });
    }} />;
}

function LampPresetMenus({ light, disabled, onApply }: {
  light: HueLight; disabled: boolean; onApply: (state: LightState) => void;
}) {
  const [menu, setMenu] = useState<{ kind: 'white' | 'color'; anchor: { x: number; y: number } } | null>(null);
  const whiteAnchor = useRef<ComponentRef<typeof View>>(null);
  const colorAnchor = useRef<ComponentRef<typeof View>>(null);
  const open = (kind: 'white' | 'color') => {
    const anchor = kind === 'white' ? whiteAnchor : colorAnchor;
    anchor.current?.measureInWindow((x, y, _width, height) => setMenu({ kind, anchor: { x, y: y + height } }));
  };
  const close = () => {
    const anchor = menu?.kind === 'white' ? whiteAnchor : colorAnchor;
    setMenu(null);
    requestAnimationFrame(() => anchor.current?.focus());
  };
  const selectedTemperature = nearestWhitePreset(light.colorMode === 'ct' ? light.colorTemperature : undefined);
  const select = (state: LightState) => {
    close();
    onApply({ on: true, brightness: light.brightness || 80, ...state });
  };
  return <View style={styles.presetButtons}>
    {light.colorTemperatureCapable && <View ref={whiteAnchor} collapsable={false} tabIndex={-1}>
      <Action mode="outlined" disabled={disabled} accessibilityLabel="White presets" accessibilityState={{ expanded: menu?.kind === 'white' }} onPress={() => open('white')}>White presets</Action>
    </View>}
    <View ref={colorAnchor} collapsable={false} tabIndex={-1}>
      <Action mode="outlined" disabled={disabled} accessibilityLabel="RGB color presets" accessibilityState={{ expanded: menu?.kind === 'color' }} onPress={() => open('color')}>Color presets</Action>
    </View>
    {menu && <Menu visible onDismiss={close} anchor={menu.anchor}
      overlayAccessibilityLabel={`Close ${menu.kind} presets`} contentStyle={styles.presetMenu}>
      {menu.kind === 'white' ? whites.map(([name, temperature]) => <Menu.Item key={name} title={`${name} · ${temperature} K`}
        accessibilityLabel={`${name}, ${temperature} kelvin`} disabled={disabled}
        leadingIcon={() => <View style={[styles.menuSwatch, { backgroundColor: whiteSwatches[temperature] }]} />}
        trailingIcon={selectedTemperature === temperature ? 'check' : undefined}
        accessibilityState={{ selected: selectedTemperature === temperature }} onPress={() => select({ colorTemperature: temperature })} />)
        : colors.map(([name, hue]) => <Menu.Item key={name} title={name} accessibilityLabel={`${name} color preset`} disabled={disabled}
        leadingIcon={() => <View style={[styles.menuSwatch, { backgroundColor: hsvHex(hue / 65535 * 360, 100, 100) }]} />}
        onPress={() => select({ hue, saturation: 254 })} />)}
    </Menu>}
  </View>;
}

export function LampsScreen({ controller: c, onConnect }: {
  controller: LightingController; onConnect: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const compactHeader = width / fontScale < 380;
  const [renaming, setRenaming] = useState<HueLight | null>(null);
  const [name, setName] = useState('');
  const [expandedId, setExpandedId] = useState(c.selectedLightId);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [pickingColor, setPickingColor] = useState(false);
  const toggle = (light: HueLight) => {
    const nextId = expandedId === light.id ? null : light.id;
    setExpandedId(nextId);
    if (nextId) c.setSelectedLightId(nextId);
  };
  return <>
    <RoomLights controller={c} pickingColor={pickingColor} expandedId={expandedId} onDragStart={() => setPressedId(null)}
      empty={<EmptyState icon="lightbulb-outline" title="No lights" action={c.credentials ? 'Refresh lights' : 'Connect bridge'} onPress={c.credentials ? () => { void c.reconnect(); } : onConnect} />}>
    {(light, interactions) => {
      const selected = light.id === expandedId;
      const lampIcon = <Icon source={light.kind.includes('plug') ? 'power-socket-eu' : 'lightbulb-outline'} size={28} color={palette.accent} />;
      return <Panel tonal={selected} style={[styles.lamp, !selected && pressedId === light.id && styles.pressedLamp]}>
        <View style={ui.row}>
          <TouchableRipple onPress={() => { if (interactions.canPress()) toggle(light); }} onLongPress={interactions.onLongPress}
            accessible={!selected} focusable={!selected}
            accessibilityRole={selected ? undefined : 'button'} accessibilityLabel={selected ? undefined : `Show ${light.name} controls`}
            accessibilityHint="Long-press to drag this lamp into a room"
            accessibilityState={selected ? undefined : { expanded: false }} rippleColor={selected ? undefined : 'transparent'}
            onPressIn={() => { if (!selected) setPressedId(light.id); }}
            onPressOut={() => setPressedId(null)} style={ui.flex}>
            <View style={ui.row}>
              {selected ? <TouchableRipple onPress={event => { event.stopPropagation(); if (interactions.canPress()) toggle(light); }}
                onLongPress={interactions.onLongPress} accessibilityRole="button"
                accessibilityState={{ expanded: true }} accessibilityLabel={`Hide ${light.name} controls`} style={styles.lightIcon}>
                {lampIcon}
              </TouchableRipple> : <View style={styles.lightIcon}>{lampIcon}</View>}
              <View style={ui.flex}>
                {selected ? <TouchableRipple onPress={event => { event.stopPropagation(); if (interactions.canPress()) { setRenaming(light); setName(light.name); } }}
                  onLongPress={interactions.onLongPress}
                  disabled={c.busy} accessibilityRole="button" accessibilityLabel={`Rename ${light.name}`}
                  accessibilityHint="Opens the lamp name editor" style={styles.lampName}>
                  <Text variant="titleMedium">{light.name}</Text>
                </TouchableRipple> : <View style={styles.lampName}><Text variant="titleMedium">{light.name}</Text></View>}
                <Caption>{kinds[light.kind]} · {light.on ? light.kind === 'onoff-plug' ? 'On' : `${light.brightness}%` : 'Off'}</Caption>
              </View>
            </View>
          </TouchableRipple>
          <View style={[styles.lampActions, compactHeader && styles.compactLampActions]}>
            <IconButton icon="dots-vertical" accessibilityLabel={`Move ${light.name} to room or reorder`} disabled={c.busy || interactions.dragging} onPress={interactions.openMove} style={styles.moveMenu} />
            <Switch value={light.on} disabled={c.busy || interactions.dragging} accessibilityLabel={`${light.name} power`} onValueChange={on => { void c.update(light.id, { on }); }} />
          </View>
        </View>
        {selected && !interactions.dragging && <>
          {light.colorCapable && <LampColorWheel light={light} disabled={c.busy} onPickingColor={setPickingColor} onApply={state => { void c.update(light.id, state); }} />}
          {light.colorCapable ? <LampPresetMenus light={light} disabled={c.busy} onApply={state => { void c.update(light.id, state); }} />
            : light.colorTemperatureCapable && <WhitePresets temperature={light.colorTemperature} disabled={c.busy} onSelect={temperature => { void c.update(light.id, { on: true, brightness: light.brightness || 80, colorTemperature: temperature }); }} />}
          {light.kind !== 'onoff-plug' && <Brightness light={light} disabled={c.busy} onApply={state => { void c.update(light.id, state); }} />}
        </>}
      </Panel>;
    }}
    </RoomLights>
    <Portal><Dialog visible={!!renaming} dismissable={!c.busy} onDismiss={() => setRenaming(null)}>
      <Dialog.Title>Rename lamp</Dialog.Title><Dialog.Content style={ui.stack}><Caption>This name is saved to the Hue Bridge.</Caption>{c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}<Field label="Lamp name" value={name} onChangeText={setName} maxLength={32} autoCapitalize="words" editable={!c.busy} /><Caption>{name.length}/32 characters</Caption></Dialog.Content>
      <Dialog.Actions><Action mode="text" disabled={c.busy} onPress={() => setRenaming(null)}>Cancel</Action><Action mode="text" disabled={c.busy || !name.trim()} onPress={() => { if (renaming) void c.saveLightName(renaming.id, name).then(ok => { if (ok) setRenaming(null); }); }}>Save to bridge</Action></Dialog.Actions>
    </Dialog></Portal>
  </>;
}

function WhitePresets({ disabled, onSelect, temperature }: { disabled: boolean; onSelect: (temperature: number) => void; temperature?: number }) {
  const selectedTemperature = nearestWhitePreset(temperature);
  return <View style={styles.whitePresetRow}>{whites.map(([name, temperature]) =>
    <TouchableRipple key={name} disabled={disabled} onPress={() => onSelect(temperature)}
      accessibilityRole="button" accessibilityLabel={`${name}, ${temperature} kelvin`}
      accessibilityState={{ selected: temperature === selectedTemperature }}
      style={[styles.whitePreset, disabled && styles.disabledPreset]}>
      <View style={[styles.whitePresetRing, temperature === selectedTemperature && styles.selectedPreset]}>
        <View style={[styles.whiteSwatch, { backgroundColor: whiteSwatches[temperature] }]} />
      </View>
    </TouchableRipple>)}</View>;
}

const styles = StyleSheet.create({
  lamp: { padding: spacing.lg, gap: spacing.md },
  moveMenu: { margin: 0, width: 48, height: 48 },
  lampActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  compactLampActions: { flexDirection: 'column-reverse', gap: 0 },
  pressedLamp: { backgroundColor: palette.high },
  lightIcon: { width: 48, height: 48, backgroundColor: palette.high, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  lampName: { minHeight: 48, justifyContent: 'center' },
  whitePresetRow: { flexDirection: 'row', alignItems: 'center' },
  whitePreset: { flex: 1, maxWidth: 48, minHeight: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  whitePresetRing: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
  selectedPreset: { borderColor: palette.primary },
  whiteSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: palette.outline },
  disabledPreset: { opacity: 0.5 },
  presetButtons: { gap: spacing.sm },
  presetMenu: { backgroundColor: palette.surface },
  menuSwatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: palette.outline },
  slider: { minHeight: 48, width: '100%' },
  error: { color: palette.error },
});
