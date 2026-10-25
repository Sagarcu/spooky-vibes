import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Menu } from 'react-native-paper';
import { colors, nearestWhitePreset, whites, whiteSwatches } from '../services/light-presets';
import { hsvHex } from '../services/color-wheel';
import { palette, spacing } from '../theme';
import { Action } from './ui';

export type PresetColorState = { colorTemperature: number } | { hue: number; saturation: number };

export function ColorPresetMenus({ whiteCapable, colorCapable = true, colorTemperature, disabled, onSelect }: {
  whiteCapable: boolean; colorCapable?: boolean; colorTemperature?: number; disabled: boolean; onSelect: (state: PresetColorState) => void;
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
  const select = (state: PresetColorState) => {
    close();
    onSelect(state);
  };
  const selectedTemperature = nearestWhitePreset(colorTemperature);
  return <View style={styles.buttons}>
    {whiteCapable && <View ref={whiteAnchor} collapsable={false} tabIndex={-1}>
      <Action mode="outlined" disabled={disabled} accessibilityLabel="White presets" accessibilityState={{ expanded: menu?.kind === 'white' }}
        onPress={() => open('white')}>White presets</Action>
    </View>}
    {colorCapable && <View ref={colorAnchor} collapsable={false} tabIndex={-1}>
      <Action mode="outlined" disabled={disabled} accessibilityLabel="RGB color presets" accessibilityState={{ expanded: menu?.kind === 'color' }}
        onPress={() => open('color')}>Color presets</Action>
    </View>}
    {menu && <Menu visible onDismiss={close} anchor={menu.anchor}
      overlayAccessibilityLabel={`Close ${menu.kind} presets`} contentStyle={styles.menu}>
      {menu.kind === 'white' ? whites.map(([name, temperature]) => <Menu.Item key={name} title={`${name} · ${temperature} K`}
        accessibilityLabel={`${name}, ${temperature} kelvin`} disabled={disabled}
        leadingIcon={() => <View style={[styles.swatch, { backgroundColor: whiteSwatches[temperature] }]} />}
        trailingIcon={selectedTemperature === temperature ? 'check' : undefined}
        accessibilityState={{ selected: selectedTemperature === temperature }} onPress={() => select({ colorTemperature: temperature })} />)
        : colors.map(([name, hue]) => <Menu.Item key={name} title={name} accessibilityLabel={`${name} color preset`} disabled={disabled}
          leadingIcon={() => <View style={[styles.swatch, { backgroundColor: hsvHex(hue / 65535 * 360, 100, 100) }]} />}
          onPress={() => select({ hue, saturation: 254 })} />)}
    </Menu>}
  </View>;
}

const styles = StyleSheet.create({
  buttons: { gap: spacing.sm },
  menu: { backgroundColor: palette.surface },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: palette.outline },
});
