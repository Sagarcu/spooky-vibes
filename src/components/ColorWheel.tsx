import { memo, useId, useState, type ComponentProps } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import { Dialog, Portal, Text, TouchableRipple } from 'react-native-paper';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { hsvHex, parseHexColor, wheelColorAt, WHEEL_RADIUS as RADIUS, WHEEL_SIZE as SIZE } from '../services/color-wheel';
import { palette, spacing } from '../theme';
import { Action, Field, ui } from './ui';

const STEPS = 360;

const wedges = Array.from({ length: STEPS }, (_, index) => {
  const start = (index * 360 / STEPS - 90 - 0.15) * Math.PI / 180;
  const end = ((index + 1) * 360 / STEPS - 90 + 0.15) * Math.PI / 180;
  return {
    path: `M ${SIZE / 2} ${SIZE / 2} L ${SIZE / 2 + RADIUS * Math.cos(start)} ${SIZE / 2 + RADIUS * Math.sin(start)} A ${RADIUS} ${RADIUS} 0 0 1 ${SIZE / 2 + RADIUS * Math.cos(end)} ${SIZE / 2 + RADIUS * Math.sin(end)} Z`,
    color: hsvHex((index + 0.5) * 360 / STEPS, 100, 100),
  };
});

const WheelBackground = memo(function WheelBackground({ size }: { size: number }) {
  const gradientId = useId().replace(/:/g, '');
  return <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} pointerEvents="none">
    <Defs><RadialGradient id={gradientId} cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#ffffff" stopOpacity="1" /><Stop offset="100%" stopColor="#ffffff" stopOpacity="0" /></RadialGradient></Defs>
    {wedges.map(({ path, color }, index) => <Path key={index} d={path} fill={color} />)}
    <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill={`url(#${gradientId})`} />
    <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={palette.outline} strokeWidth={2} />
  </Svg>;
});

type Props = {
  hue: number;
  saturation: number;
  brightness?: number;
  onChange: (hue: number, saturation: number) => void;
  onChangeComplete?: (hue: number, saturation: number) => void;
  onHexChange?: (hue: number, saturation: number, brightness: number) => void;
  disabled?: boolean;
  maxSize?: number;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

export function ColorWheel({ hue, saturation, brightness = 100, onChange, onChangeComplete, onHexChange, disabled = false, maxSize = SIZE, onGestureStart, onGestureEnd }: Props) {
  const { width } = useWindowDimensions();
  const [editingHex, setEditingHex] = useState(false);
  const [hexInput, setHexInput] = useState('');
  const [hexError, setHexError] = useState<string | null>(null);
  const hex = hsvHex(hue, saturation, brightness).toUpperCase();
  const saveHex = () => {
    if (disabled || !onHexChange) return;
    const color = parseHexColor(hexInput);
    if (!color) { setHexError('Enter 3 or 6 hexadecimal digits, such as #FF8800.'); return; }
    setEditingHex(false);
    onHexChange(color.hue, color.saturation, color.brightness);
  };
  const displaySize = Math.min(SIZE, Math.max(160, width - 96), maxSize);
  const angle = (hue - 90) * Math.PI / 180;
  const distance = RADIUS * Math.max(0, Math.min(100, saturation)) / 100;
  const select = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const color = wheelColorAt(locationX * SIZE / displaySize, locationY * SIZE / displaySize, hue);
    onChange(color.hue, color.saturation);
    return color;
  };
  const adjust = (hueDelta: number, saturationDelta = 0) => {
    if (disabled) return;
    const nextHue = (hue + hueDelta + 360) % 360;
    const nextSaturation = Math.max(0, Math.min(100, saturation + saturationDelta));
    onChange(nextHue, nextSaturation);
    onChangeComplete?.(nextHue, nextSaturation);
  };
  const onKeyDown: ComponentProps<typeof View>['onKeyDown'] = event => {
    const { key } = event.nativeEvent;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    adjust(key === 'ArrowRight' ? 5 : key === 'ArrowLeft' ? -5 : 0,
      key === 'ArrowUp' ? 5 : key === 'ArrowDown' ? -5 : 0);
  };

  return <View style={styles.container}>
    <View style={[{ width: displaySize, height: displaySize }, disabled && styles.disabled]}>
      <WheelBackground size={displaySize} />
      <Svg width={displaySize} height={displaySize} viewBox={`0 0 ${SIZE} ${SIZE}`} pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Circle cx={SIZE / 2 + distance * Math.cos(angle)} cy={SIZE / 2 + distance * Math.sin(angle)} r={11} fill={hsvHex(hue, saturation, 100)} stroke={palette.surface} strokeWidth={4} />
        <Circle cx={SIZE / 2 + distance * Math.cos(angle)} cy={SIZE / 2 + distance * Math.sin(angle)} r={11} fill="none" stroke="#ffffff" strokeWidth={2} />
      </Svg>
      <View accessible accessibilityRole="adjustable" accessibilityLabel="RGB color wheel" accessibilityHint="Drag around the circle to choose a hue and toward the center to reduce saturation"
        accessibilityValue={{ min: 0, max: 360, now: Math.round(hue), text: `${Math.round(hue)} degrees, ${Math.round(saturation)} percent saturation` }}
        accessibilityState={{ disabled }} accessibilityActions={[{ name: 'increment', label: 'Increase hue' }, { name: 'decrement', label: 'Decrease hue' }]}
        onAccessibilityAction={event => adjust(event.nativeEvent.actionName === 'increment' ? 5 : -5)}
        {...(Platform.OS === 'web' ? { tabIndex: disabled ? -1 : 0, onKeyDown } : {})}
        style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => !disabled} onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={event => { onGestureStart?.(); select(event); }} onResponderMove={select}
        onResponderRelease={event => {
          if (!disabled) { const color = select(event); onChangeComplete?.(color.hue, color.saturation); }
          onGestureEnd?.();
        }} onResponderTerminate={onGestureEnd} onResponderTerminationRequest={() => false} />
    </View>
    <View style={styles.preview}><View style={[styles.swatch, { backgroundColor: hsvHex(hue, saturation, brightness) }]} />
      {onHexChange ? <TouchableRipple disabled={disabled} accessibilityRole="button" accessibilityLabel={`Edit hex color ${hex}`}
        accessibilityHint="Opens a text field where you can edit or copy the color code"
        onPress={() => { setHexInput(hex); setHexError(null); setEditingHex(true); }} style={styles.hexButton}>
        <Text style={styles.text}>{hex}</Text>
      </TouchableRipple> : <Text selectable style={styles.text}>{hex}</Text>}</View>
    <Portal><Dialog visible={editingHex} dismissable={!disabled} onDismiss={() => setEditingHex(false)}>
      <Dialog.Title>Hex color</Dialog.Title>
      <Dialog.Content style={ui.stack}>
        <Field label="Hex color" value={hexInput} onChangeText={value => { setHexInput(value); setHexError(null); }}
          autoCapitalize="characters" autoCorrect={false} selectTextOnFocus autoFocus editable={!disabled}
          error={!!hexError} onSubmitEditing={saveHex} returnKeyType="done" />
        {hexError && <Text accessibilityRole="alert" style={styles.error}>{hexError}</Text>}
      </Dialog.Content>
      <Dialog.Actions>
        <Action mode="text" disabled={disabled} onPress={() => setEditingHex(false)}>Cancel</Action>
        <Action mode="text" disabled={disabled} onPress={saveHex}>Save hex color</Action>
      </Dialog.Actions>
    </Dialog></Portal>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  disabled: { opacity: 0.5 },
  preview: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderColor: palette.text, borderWidth: 2 },
  text: { color: palette.muted, flexShrink: 1 },
  hexButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm },
  error: { color: palette.error },
});
