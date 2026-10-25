import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { BackHandler, ScrollView, StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Appbar, Banner, BottomNavigation, Icon, PaperProvider, ProgressBar, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BridgeScreen, GroupsScreen, HomeScreen, GroupEditorScreen, type GroupDraft } from './src/components/LightingScreens';
import type { HueLightGroup } from './src/types/hue';
import { LampsScreen } from './src/components/LampControls';
import { AmbianceScreen } from './src/components/AmbianceScreen';
import { AddRoomAction } from './src/components/RoomEditor';
import { TimelineEditor } from './src/components/TimelineEditor';
import { Action } from './src/components/ui';
import { palette, spacing, theme } from './src/theme';
import { useLightingController } from './src/useLightingController';

type Screen = 'home' | 'ambiance' | 'bridge' | 'lamps' | 'groups' | 'group-editor' | 'creator';
const destinations = [
  { key: 'home', title: 'Home', accessibilityLabel: 'Home', focusedIcon: 'home', unfocusedIcon: 'home-outline' },
  { key: 'ambiance', title: 'Ambiance', accessibilityLabel: 'Ambiance', focusedIcon: 'candle', unfocusedIcon: 'candle' },
  { key: 'lamps', title: 'Lights', accessibilityLabel: 'Lights', focusedIcon: 'lightbulb', unfocusedIcon: 'lightbulb-outline' },
  { key: 'groups', title: 'Groups', accessibilityLabel: 'Groups', focusedIcon: 'view-grid', unfocusedIcon: 'view-grid-outline' },
  { key: 'creator', title: 'Sequences', accessibilityLabel: 'Sequences', focusedIcon: 'creation', unfocusedIcon: 'creation-outline' },
] as const;

export default function App() {
  return <SafeAreaProvider><PaperProvider theme={theme}><StatusBar barStyle="light-content" /><LightingApp /></PaperProvider></SafeAreaProvider>;
}

function LightingApp() {
  const controller = useLightingController();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [selectedScreen, setScreen] = useState<Screen>('home');
  const screen = controller.connected ? selectedScreen : 'bridge';
  const [bridgeReturn, setBridgeReturn] = useState<Screen>('home');
  const [navigationPending, setNavigationPending] = useState(false);
  const [editorActive, setEditorActive] = useState(false);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>({ name: '', lightIds: [] });
  const [editingGroupId, setEditingGroupId] = useState<string | undefined>(undefined);
  const duplicateGroupName = controller.groups.some(group => group.id !== editingGroupId && group.name.toLowerCase() === groupDraft.name.trim().toLowerCase());
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const wide = width >= 700;
  const go = async (next: Screen, group?: HueLightGroup) => {
    if (navigationPending || next === screen) return;
    if (screen === 'creator') {
      setNavigationPending(true);
      try { await controller.leavePreview(); }
      finally { setNavigationPending(false); }
    }
    if (next === 'bridge') setBridgeReturn(screen);
    if (next === 'group-editor') {
      setEditingGroupId(group?.id);
      setGroupDraft(group ? { name: group.name, lightIds: [...group.lightIds] } : { name: '', lightIds: [] });
    }
    setScreen(next);
  };
  const back = () => { void go(screen === 'group-editor' ? 'groups' : bridgeReturn); };
  useEffect(() => {
    if (!controller.connected || !['group-editor', 'bridge'].includes(screen)) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => listener.remove();
  }, [screen, bridgeReturn, navigationPending, controller.connected]);
  const index = Math.max(0, destinations.findIndex(item => item.key === (screen === 'group-editor' ? 'groups' : screen === 'bridge' ? bridgeReturn : screen)));
  const subpage = screen === 'group-editor' || screen === 'bridge';
  const title = screen === 'home' ? 'Spooky Vibes' : screen === 'ambiance' ? 'Ambiance' : screen === 'lamps' ? 'Your lights'
    : screen === 'groups' ? 'Your groups' : screen === 'group-editor' ? editingGroupId !== undefined ? 'Edit group' : 'New group'
        : controller.credentials ? 'Your bridge' : 'Connect your bridge';
  const openBridge = () => { void go('bridge'); };
  const content = screen === 'home' ? <HomeScreen controller={controller} onConnect={openBridge} onEdit={() => { void go('creator'); }} />
    : screen === 'ambiance' ? <AmbianceScreen controller={controller} />
    : screen === 'lamps' ? <LampsScreen controller={controller} onConnect={openBridge} />
      : screen === 'groups' ? <GroupsScreen controller={controller} onCreate={() => { void go('group-editor'); }} onEdit={group => { void go('group-editor', group); }} />
        : screen === 'group-editor' ? <GroupEditorScreen controller={controller} draft={groupDraft} onChange={setGroupDraft}
          duplicate={duplicateGroupName} onConnect={openBridge} originalLightIds={controller.groups.find(group => group.id === editingGroupId)?.lightIds} />
          : screen === 'bridge' ? <BridgeScreen controller={controller} /> : null;

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.layout}>
      {controller.connected && wide && <View style={styles.rail}>
        <Icon source="creation" size={32} color={palette.accent} />
        {destinations.map((route, itemIndex) => <TouchableRipple key={route.key} disabled={navigationPending} accessibilityRole="tab"
          accessibilityState={{ selected: itemIndex === index }} accessibilityLabel={route.title} onPress={() => { void go(route.key); }} style={styles.railItem}>
          <View style={styles.railContent}><View style={[styles.railIcon, itemIndex === index && styles.railSelected]}><Icon source={itemIndex === index ? route.focusedIcon : route.unfocusedIcon} size={24} color={itemIndex === index ? palette.primary : palette.muted} /></View><Text variant="labelMedium">{route.title}</Text></View>
        </TouchableRipple>)}
        <Appbar.Action icon={controller.connected ? 'lan-connect' : 'lan-disconnect'} accessibilityLabel="Bridge connection" onPress={openBridge} />
      </View>}
      <View style={[styles.main, (!controller.connected || wide || subpage || editorActive) && { paddingBottom: insets.bottom }]}>
        {screen !== 'creator' && <Appbar.Header style={styles.header} statusBarHeight={0}>
          {controller.connected && subpage && <Appbar.BackAction onPress={back} accessibilityLabel="Back" />}
          <Appbar.Content title={title} titleStyle={styles.headerTitle} />
          {screen === 'ambiance' && !!controller.ambianceModes.length && <Action mode="text"
            disabled={controller.busy || controller.ambianceModes.every(mode => mode.stopping)} onPress={() => { void controller.stopAllAmbiance(); }}>Stop all</Action>}
          {screen === 'home' && <TouchableRipple onPress={openBridge} style={styles.connection} accessibilityRole="button" accessibilityLabel={`Bridge: ${controller.restoring ? 'checking' : controller.connected ? 'connected' : controller.credentials ? 'unreachable' : 'not paired'}`}>
            <View style={styles.connectionContent}><Icon source={controller.connected ? 'check-circle-outline' : 'lan-disconnect'} size={16} color={controller.connected ? palette.success : palette.muted} /><Text variant="labelMedium">{controller.restoring ? 'Checking' : controller.connected ? 'Bridge' : 'Connect'}</Text></View>
          </TouchableRipple>}
          {screen === 'lamps' && <AddRoomAction controller={controller} />}
          {screen === 'lamps' && <Appbar.Action icon="refresh" accessibilityLabel="Refresh lights" disabled={controller.busy || !controller.credentials} onPress={() => { void controller.reconnect(); }} />}
          {screen === 'group-editor' && <Action mode="text" accessibilityLabel="Save group" loading={controller.busy}
            disabled={controller.busy || controller.running || controller.previewRunning || !groupDraft.name.trim() || !groupDraft.lightIds.length || duplicateGroupName}
            onPress={() => { void controller.saveGroup(groupDraft.name, groupDraft.lightIds, editingGroupId).then(ok => { if (ok) void go('groups'); }); }}>Save</Action>}
        </Appbar.Header>}
        <Banner visible={!!controller.error} icon="alert-circle-outline" actions={[{ label: 'Dismiss', onPress: controller.clearError }, ...(!controller.connected && controller.credentials ? [{ label: 'Reconnect', onPress: () => { void controller.reconnect(); } }] : [])]}>
          <Text accessibilityRole="alert">{controller.error}</Text>
        </Banner>
        {(controller.busy || controller.restoring || navigationPending) && <ProgressBar indeterminate color={palette.primary} />}
        {screen === 'creator' ? <TimelineEditor
          groups={controller.groups} lights={controller.lights} timelines={controller.timelines}
          onSave={controller.saveTimeline} onDelete={controller.deleteTimeline} onPreview={controller.previewTimeline}
          onStopPreview={controller.stopPreview} previewRunning={controller.previewRunning} previewRestoring={controller.previewRestoring}
          playbackRunning={controller.running} onLeavePreview={controller.leavePreview}
          ambianceSequenceIds={controller.ambianceModes.map(mode => mode.sequenceId)}
          onEditingChange={setEditorActive}
          onOpenAmbiance={() => { void go('ambiance'); }}
          onCreateGroup={() => { void go('group-editor'); }}
        /> : screen === 'lamps' ? content : <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={[styles.content, wide && styles.wideContent]} keyboardShouldPersistTaps="handled">{content}</ScrollView>}
        {controller.connected && !wide && !subpage && !editorActive && <BottomNavigation.Bar navigationState={{ index, routes: [...destinations] }}
          onTabPress={({ route, preventDefault }) => { preventDefault(); if (!navigationPending) void go(route.key); }}
          activeColor={palette.primary} inactiveColor={palette.muted} style={styles.navigation} />}
      </View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  layout: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
  header: { backgroundColor: palette.background },
  headerTitle: { fontSize: 22 },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingTop: spacing.sm, gap: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  wideContent: { maxWidth: 900, paddingHorizontal: spacing.xxl },
  connection: { borderWidth: 1, borderColor: palette.outline, borderRadius: 12, marginRight: spacing.lg },
  connectionContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 48 },
  navigation: { backgroundColor: palette.surface },
  rail: { width: 88, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xl, alignItems: 'center', borderRightWidth: 1, borderColor: palette.high, backgroundColor: palette.surface },
  railItem: { width: '100%', borderRadius: 16 },
  railContent: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  railIcon: { width: 56, minHeight: 32, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  railSelected: { backgroundColor: palette.high },
});
