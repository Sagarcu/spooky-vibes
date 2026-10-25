import { StyleSheet, View } from 'react-native';
import { Divider, RadioButton, Text } from 'react-native-paper';
import type { PlaybackTarget } from '../services/playback-target';
import { lightSections } from '../services/rooms';
import { palette, spacing } from '../theme';
import type { LightingController } from '../useLightingController';
import { Caption, ui } from './ui';

export function PlaybackTargetPicker({ controller: c, value, disabled, onSelect }: {
  controller: Pick<LightingController, 'groups' | 'availableGroups' | 'lights' | 'roomLayout'>;
  value: PlaybackTarget | null;
  disabled: boolean;
  onSelect: (target: PlaybackTarget) => void;
}) {
  return <>
    <Text variant="titleMedium">Groups</Text>
    {!c.groups.length && <Caption>No groups</Caption>}
    {c.groups.map(group => <RadioButton.Item key={group.id} label={`${group.name} · ${c.availableGroups.find(item => item.id === group.id)?.lightIds.length ?? 0} available`}
      value={group.id} status={value?.kind === 'group' && value.id === group.id ? 'checked' : 'unchecked'}
      disabled={disabled || !c.availableGroups.some(item => item.id === group.id)}
      onPress={() => onSelect({ kind: 'group', id: group.id })} />)}
    <Text variant="titleMedium">Single lamps</Text>
    {lightSections(c.roomLayout, c.lights.map(light => light.id)).map(section => <View key={section.id ?? 'unordered'} style={ui.stack}>
      <View style={styles.sectionHeading}>
        <Text variant="titleMedium" accessibilityRole="header" style={styles.sectionTitle}>{section.name}</Text>
        <Divider />
      </View>
      {section.lightIds.map(id => <RadioButton.Item key={id} label={c.lights.find(light => light.id === id)!.name} value={id}
        status={value?.kind === 'light' && value.id === id ? 'checked' : 'unchecked'} disabled={disabled}
        onPress={() => onSelect({ kind: 'light', id })} />)}
      {!section.lightIds.length && <Caption>No lights in this room</Caption>}
    </View>)}
    {!c.lights.length && <Caption>Connect your bridge, then refresh the lights.</Caption>}
  </>;
}

const styles = StyleSheet.create({
  sectionHeading: { gap: spacing.sm },
  sectionTitle: { color: palette.primary },
});
