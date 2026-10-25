import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Checkbox, Dialog, Divider, FAB, Icon, IconButton, List, Portal, Text } from 'react-native-paper';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { lightSections } from '../services/rooms';
import { palette, radius, spacing } from '../theme';
import type { HueLightGroup } from '../types/hue';
import type { LightingController } from '../useLightingController';
import { Action, Caption, EmptyState, Field, Panel, Sheet, ui } from './ui';

type Props = { controller: LightingController };

export function HomeScreen({ controller: c, onConnect, onEdit }: Props & { onConnect: () => void; onEdit: () => void }) {
  const [pageWidth, setPageWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const pager = useRef<ComponentRef<typeof ScrollView>>(null);
  const page = useRef(0);
  const measuredWidth = useRef(0);
  const sequences = c.timelines;
  const selectedIndex = Math.max(0, sequences.findIndex(sequence => sequence.id === c.selectedSequenceId));
  const locked = c.running || c.previewRunning || c.busy || c.restoring;
  const pagesReady = pageWidth > 0 && Math.abs(contentWidth - pageWidth * sequences.length) < 1;
  useEffect(() => {
    if (pagesReady && (page.current !== selectedIndex || measuredWidth.current !== pageWidth)) {
      page.current = selectedIndex;
      measuredWidth.current = pageWidth;
      pager.current?.scrollTo({ x: selectedIndex * pageWidth, animated: false });
    }
  }, [selectedIndex, pageWidth, pagesReady]);
  const target = c.timelineGroup?.name ?? 'Saved group unavailable';
  const blocked = !c.credentials ? 'Connect your bridge to run a sequence.'
    : c.targetMissing ? 'This timeline needs its saved group and every action lamp available. Edit it to continue.' : null;
  if (!sequences.length) return <EmptyState icon="creation-outline" title="No custom timelines"
    description="Create a timeline in Sequences. Candlelight and Halloween storm are available in Ambiance."
    action="Create a timeline" onPress={onEdit} />;
  return <View style={ui.stack}>
    <View onLayout={event => setPageWidth(event.nativeEvent.layout.width)}>
      <ScrollView ref={pager} horizontal pagingEnabled scrollEnabled={!locked} showsHorizontalScrollIndicator={false}
        accessibilityLabel="Sequences" scrollEventThrottle={16}
        onContentSizeChange={width => setContentWidth(width)}
        onScroll={event => {
          if (locked || !pagesReady || measuredWidth.current !== pageWidth) return;
          const index = Math.max(0, Math.min(sequences.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)));
          const sequence = sequences[index];
          if (sequence && index !== page.current) { page.current = index; c.setSelectedSequenceId(sequence.id); }
        }}>
        {sequences.map((sequence, index) => <View key={sequence.id} style={{ width: pageWidth, paddingHorizontal: spacing.xs }}
          aria-hidden={index !== selectedIndex} accessibilityElementsHidden={index !== selectedIndex} importantForAccessibility={index === selectedIndex ? 'auto' : 'no-hide-descendants'}>
          <Panel tonal style={styles.hero}>
            <View style={styles.orb} accessible={false}>
              <Svg width={88} height={88} viewBox="0 0 112 112"><Defs><LinearGradient id={`atmosphere-${index}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={palette.primary} /><Stop offset="1" stopColor={palette.accent} /></LinearGradient></Defs><Circle cx="56" cy="56" r="44" fill={`url(#atmosphere-${index})`} /></Svg>
            </View>
            <Text variant="headlineMedium" accessibilityRole="header" style={styles.sequenceTitle}>{sequence.name}</Text>
            <Caption>{`${sequence.durationMs / 1000}s · ${sequence.events.length} action${sequence.events.length === 1 ? '' : 's'}`}</Caption>
          </Panel>
        </View>)}
      </ScrollView>
    </View>
    <View style={styles.paging}>
      <IconButton icon="chevron-left" accessibilityLabel="Previous sequence" disabled={locked || selectedIndex === 0}
        onPress={() => { const previous = sequences[selectedIndex - 1]; if (previous) c.setSelectedSequenceId(previous.id); }} />
      <Text variant="labelLarge" accessibilityLiveRegion="polite" accessibilityLabel={`Sequence ${selectedIndex + 1} of ${sequences.length}: ${c.sequenceName}`}>{selectedIndex + 1} / {sequences.length}</Text>
      <IconButton icon="chevron-right" accessibilityLabel="Next sequence" disabled={locked || selectedIndex === sequences.length - 1}
        onPress={() => { const next = sequences[selectedIndex + 1]; if (next) c.setSelectedSequenceId(next.id); }} />
    </View>
    {!c.credentials && !c.restoring ? <Action icon="lan-connect" onPress={onConnect}>Connect bridge</Action> :
      <Action icon={c.running ? 'stop' : 'play-outline'} loading={c.homeRestoring} disabled={c.homeRestoring || !c.running && (locked || c.targetMissing)}
        onPress={() => { if (c.running) c.stop(); else void c.start(); }}>
        {c.homeRestoring ? 'Restoring lamps...' : c.running ? c.selectedTimeline?.restoreAfterPlayback ? 'Stop & restore lamps' : 'Stop sequence' : 'Run sequence'}
      </Action>}
    {c.credentials && blocked && <Caption>{blocked}</Caption>}
    {c.selectedTimeline && c.targetMissing && <Action mode="text" onPress={onEdit}>Edit sequence</Action>}
    <List.Item accessibilityRole="text" accessibilityLabel={`Timeline group, ${target}`} title="Timeline group" description={target}
      right={props => <List.Icon {...props} icon="lock-outline" />} style={styles.listItem} />
  </View>;
}

export function BridgeScreen({ controller: c }: Props) {
  const [confirmForget, setConfirmForget] = useState(false);
  return <View style={ui.stack}>
    {c.credentials ? <>
      <Panel tonal><View style={ui.row}><Icon source={c.connected ? 'check-circle-outline' : 'lan-disconnect'} color={c.connected ? palette.success : palette.error} size={24} /><Text variant="titleLarge">{c.restoring ? 'Checking saved connection' : c.connected ? 'Connected' : 'Bridge unreachable'}</Text></View>{!c.connected && <Caption>Check your Wi-Fi. Guest networks and VPNs can block bridge access.</Caption>}</Panel>
      <Panel><Text variant="titleMedium">Hue Bridge</Text><View style={ui.between}><Caption>Local address</Caption><Text>{c.credentials.bridgeIp}</Text></View><Divider /><View style={ui.between}><Caption>Lights found</Caption><Text>{c.lights.length}</Text></View><Action mode="outlined" disabled={c.busy || c.restoring} onPress={() => { void c.reconnect(); }}>Reconnect saved bridge</Action></Panel>
      <Divider />
      <Action mode="text" textColor={palette.error} disabled={c.busy || c.homeRestoring || c.previewRestoring} onPress={() => setConfirmForget(true)}>Forget bridge...</Action>
    </> : <>
      <Panel><Text variant="labelMedium" style={styles.eyebrow}>STEP 1 · FIND</Text><Text variant="titleLarge">Find your Hue Bridge</Text><Action mode="outlined" icon="magnify" disabled={c.busy || c.restoring} onPress={() => { void c.discover(); }}>Discover bridge</Action>
        <Field label="Or enter a local IPv4 address" placeholder="192.168.1.20" value={c.bridgeIp} onChangeText={c.setBridgeIp} keyboardType="numbers-and-punctuation" autoCapitalize="none" autoCorrect={false} editable={!c.busy} />
      </Panel>
      <Panel tonal><Text variant="labelMedium" style={styles.eyebrow}>STEP 2 · PAIR</Text><Text variant="titleLarge">Press the bridge link button</Text><Caption>Then tap Pair bridge within 30 seconds. If the pairing window expires, press the physical button again.</Caption><Action icon="link" disabled={!c.bridgeIp.trim() || c.busy || c.restoring} onPress={() => { void c.pair(); }}>Pair bridge</Action></Panel>
    </>}
    <Portal><Dialog visible={confirmForget} dismissable={!c.busy} onDismiss={() => setConfirmForget(false)}>
      <Dialog.Title>Forget this bridge?</Dialog.Title><Dialog.Content style={ui.stack}><Text variant="bodyMedium">Remove the saved connection and all rooms, groups, custom timelines, and timeline audio on this phone? This cannot be undone. Your Hue lights are not deleted.</Text>{c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}</Dialog.Content>
      <Dialog.Actions><Action mode="text" disabled={c.busy} onPress={() => setConfirmForget(false)}>Cancel</Action><Action mode="text" textColor={palette.error} loading={c.busy} disabled={c.busy} onPress={() => { void c.forget().then(ok => { if (ok) setConfirmForget(false); }); }}>Forget bridge</Action></Dialog.Actions>
    </Dialog></Portal>
  </View>;
}

export function GroupsScreen({ controller: c, onCreate, onEdit }: Props & { onCreate: () => void; onEdit: (group: HueLightGroup) => void }) {
  const [deleting, setDeleting] = useState<HueLightGroup | null>(null);
  return <View style={ui.stack}>
    {!c.groups.length && <EmptyState icon="lightbulb-group-outline" title="No groups" action="New group" onPress={onCreate} />}
    {c.groups.map(group => <Panel key={group.id}>
      <View style={styles.groupHeader}>
        <Text variant="titleLarge" style={ui.flex}>{group.name}</Text>
        <IconButton icon="pencil-outline" accessibilityLabel={`Edit ${group.name}`} disabled={c.busy || c.running || c.previewRunning}
          onPress={() => onEdit(group)} style={styles.groupAction} />
        <IconButton icon="delete-outline" iconColor={palette.error} accessibilityLabel={`Delete ${group.name}`} disabled={c.busy || c.running || c.previewRunning}
          onPress={() => setDeleting(group)} style={styles.groupAction} />
      </View>
      <Caption>{group.lightIds.map(id => c.lights.find(light => light.id === id)?.name ?? `Unavailable lamp (${id})`).join(', ')}</Caption>
    </Panel>)}
    {!!c.groups.length && <FAB icon="plus" label="New group" style={styles.fab} onPress={onCreate} />}
    <Portal><Dialog visible={!!deleting} onDismiss={() => { if (!c.busy) setDeleting(null); }} dismissable={!c.busy}>
      <Dialog.Title>Delete group?</Dialog.Title><Dialog.Content style={ui.stack}><Text>Delete {deleting?.name}? Your Hue lights are not deleted. Timelines using this group will need another group before playback.</Text>{c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}</Dialog.Content>
      <Dialog.Actions><Action mode="text" disabled={c.busy} onPress={() => setDeleting(null)}>Cancel</Action><Action mode="text" textColor={palette.error} disabled={c.busy} onPress={() => { if (deleting) void c.removeGroup(deleting).then(ok => { if (ok) setDeleting(null); }); }}>Delete</Action></Dialog.Actions>
    </Dialog></Portal>
  </View>;
}

export type GroupDraft = { name: string; lightIds: string[] };

export function GroupEditorScreen({ controller: c, draft, onChange, duplicate, onConnect, originalLightIds = [] }: Props & {
  draft: GroupDraft; onChange: (draft: GroupDraft) => void; duplicate: boolean; onConnect: () => void; originalLightIds?: string[];
}) {
  const { name, lightIds: ids } = draft;
  const locked = c.busy || c.running || c.previewRunning;
  const unavailableIds = [...new Set([...originalLightIds, ...ids])].filter(id => !c.lights.some(light => light.id === id));
  const toggle = (id: string) => onChange({ ...draft, lightIds: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] });
  return <View style={ui.stack}>
    <Field label="Group name" value={name} onChangeText={name => onChange({ ...draft, name })} error={duplicate} editable={!locked} autoCapitalize="words" />
    {duplicate && <Text style={styles.error} accessibilityRole="alert">A group with that name already exists. Choose a different name.</Text>}
    <View style={ui.between}>
      <Text variant="titleLarge" accessibilityRole="header" style={ui.flex}>Choose lights</Text>
      <Text variant="bodyMedium" accessibilityLiveRegion="polite" style={ui.muted}>{ids.length} selected</Text>
    </View>
    {lightSections(c.roomLayout, c.lights.map(light => light.id)).map(section => <View key={section.id ?? 'unordered'} style={ui.stack}>
      <View style={styles.sectionHeading}>
        <Text variant="titleMedium" accessibilityRole="header" style={styles.sectionTitle}>{section.name}</Text>
        <Divider />
      </View>
      {section.lightIds.map(id => {
        const light = c.lights.find(item => item.id === id)!;
        return <Checkbox.Item key={id} label={light.name} status={ids.includes(id) ? 'checked' : 'unchecked'} disabled={locked}
          onPress={() => toggle(id)} style={styles.listItem} />;
      })}
      {!section.lightIds.length && <Caption>No lights in this room</Caption>}
    </View>)}
    {!!unavailableIds.length && <View style={ui.stack}>
      <View style={styles.sectionHeading}>
        <Text variant="titleMedium" accessibilityRole="header" style={styles.sectionTitle}>Unavailable lamps</Text>
        <Divider />
      </View>
      {unavailableIds.map(id => <Checkbox.Item key={id} label={`Unavailable lamp (${id})`} status={ids.includes(id) ? 'checked' : 'unchecked'} disabled={locked}
        onPress={() => toggle(id)} style={styles.listItem} />)}
    </View>}
    {!c.lights.length && <EmptyState icon="lightbulb-outline" title="No lights available" description="Connect your bridge and refresh the lamp list first." action="Connect bridge" onPress={onConnect} />}
  </View>;
}

const styles = StyleSheet.create({
  hero: { padding: spacing.lg, borderRadius: radius.xl, alignItems: 'center', gap: spacing.sm },
  orb: { alignItems: 'center' },
  sequenceTitle: { textAlign: 'center' },
  paging: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  eyebrow: { color: palette.accent, letterSpacing: 1.2 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  groupAction: { margin: 0, width: 48, height: 48, flexShrink: 0 },
  listItem: { paddingHorizontal: 0 },
  sectionHeading: { gap: spacing.sm },
  sectionTitle: { color: palette.primary },
  fab: { alignSelf: 'flex-end', backgroundColor: palette.high },
  error: { color: palette.error },
});
