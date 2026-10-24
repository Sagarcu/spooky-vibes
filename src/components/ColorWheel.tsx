import { useId } from 'react';
import { StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { hsvHex, wheelColorAt, WHEEL_RADIUS as RADIUS, WHEEL_SIZE as SIZE } from '../services/color-wheel';

const STEPS = 360;

const wedges = Array.from({ length: STEPS }, (_, index) => {
  const start = (index * 360 / STEPS - 90 - 0.15) * Math.PI / 180;
  const end = ((index + 1) * 360 / STEPS - 90 + 0.15) * Math.PI / 180;
  return {
    path: `M ${SIZE / 2} ${SIZE / 2} L ${SIZE / 2 + RADIUS * Math.cos(start)} ${SIZE / 2 + RADIUS * Math.sin(start)} A ${RADIUS} ${RADIUS} 0 0 1 ${SIZE / 2 + RADIUS * Math.cos(end)} ${SIZE / 2 + RADIUS * Math.sin(end)} Z`,
    color: hsvHex((index + 0.5) * 360 / STEPS, 100, 100),
  };
});

type Props = {
  hue: number;
  saturation: number;
  brightness?: number;
  onChange: (hue: number, saturation: number) => void;
  disabled?: boolean;
  maxSize?: number;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

export function ColorWheel({ hue, saturation, brightness = 100, onChange, disabled = false, maxSize = SIZE, onGestureStart, onGestureEnd }: Props) {
  const { width } = useWindowDimensions();
  const displaySize = Math.min(SIZE, Math.max(160, width - 96), maxSize);
  const gradientId = useId().replace(/:/g, '');
  const angle = (hue - 90) * Math.PI / 180;
  const distance = RADIUS * Math.max(0, Math.min(100, saturation)) / 100;
  const select = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const color = wheelColorAt(locationX * SIZE / displaySize, locationY * SIZE / displaySize, hue);
    onChange(color.hue, color.saturation);
  };

  return <View style={styles.container}>
    <View style={[{ width: displaySize, height: displaySize }, disabled && styles.disabled]}>
      <Svg width={displaySize} height={displaySize} viewBox={`0 0 ${SIZE} ${SIZE}`} pointerEvents="none">
        <Defs><RadialGradient id={gradientId} cx="50%" cy="50%" r="50%"><Stop offset="0%" stopColor="#ffffff" stopOpacity="1" /><Stop offset="100%" stopColor="#ffffff" stopOpacity="0" /></RadialGradient></Defs>
        {wedges.map(({ path, color }, index) => <Path key={index} d={path} fill={color} />)}
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill={`url(#${gradientId})`} />
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#675774" strokeWidth={2} />
        <Circle cx={SIZE / 2 + distance * Math.cos(angle)} cy={SIZE / 2 + distance * Math.sin(angle)} r={11} fill={hsvHex(hue, saturation, 100)} stroke="#211b2e" strokeWidth={4} />
        <Circle cx={SIZE / 2 + distance * Math.cos(angle)} cy={SIZE / 2 + distance * Math.sin(angle)} r={11} fill="none" stroke="#ffffff" strokeWidth={2} />
      </Svg>
      <View accessible accessibilityRole="adjustable" accessibilityLabel="RGB color wheel" accessibilityHint="Drag around the circle to choose a hue and toward the center to reduce saturation"
        style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => !disabled} onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={event => { onGestureStart?.(); select(event); }} onResponderMove={select}
        onResponderRelease={onGestureEnd} onResponderTerminate={onGestureEnd} onResponderTerminationRequest={() => false} />
    </View>
    <View style={styles.preview}><View style={[styles.swatch, { backgroundColor: hsvHex(hue, saturation, brightness) }]} />
      <Text style={styles.text}>{hsvHex(hue, saturation, brightness).toUpperCase()} · {Math.round(saturation)}% saturation</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  disabled: { opacity: 0.5 },
  preview: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderColor: '#f8f2ff', borderWidth: 2 },
  text: { color: '#f8f2ff', fontWeight: '700', flexShrink: 1 },
});



