import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { AccessibilityInfo, PanResponder, ScrollView, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { Dialog, IconButton, Portal, RadioButton, Text } from 'react-native-paper';
import { lightSections, roomDropTarget, type LightRoom, type RoomDropSection } from '../services/rooms';
import { palette, radius, spacing } from '../theme';
import type { HueLight } from '../types/hue';
import type { LightingController } from '../useLightingController';
import { RoomEditor } from './RoomEditor';
import { Action, Caption, Sheet, ui } from './ui';

export type RoomLampInteractions = {
  onLongPress: (event: GestureResponderEvent) => void;
  canPress: () => boolean;
  openMove: () => void;
  dragging: boolean;
};

type Drag = { id: string; name: string; y: number };
type Drop = { roomId: string | null; beforeId: string | null };
type Bounds = { y: number; height: number };
const sectionKey = (id: string | null) => id === null ? 'unordered' : `room:${id}`;

export function RoomLights({ controller: c, pickingColor, expandedId, onDragStart, children, empty }: {
  controller: LightingController; pickingColor: boolean; expandedId: string | null; onDragStart: () => void;
  children: (light: HueLight, interactions: RoomLampInteractions) => ReactNode; empty: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const content = useRef<ComponentRef<typeof View>>(null);
  const elements = useRef(new Map<string, ComponentRef<typeof View>>());
  const viewport = useRef({ top: 0, height: 0, contentHeight: 0, offset: 0 });
  const bounds = useRef(new Map<string, Bounds>());
  const active = useRef<Drag | null>(null);
  const suppressTap = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [roomMenu, setRoomMenu] = useState<LightRoom | null>(null);
  const [editor, setEditor] = useState<LightRoom | null>(null);
  const [deleting, setDeleting] = useState<LightRoom | null>(null);
  const [moving, setMoving] = useState<HueLight | null>(null);
  const sections = lightSections(c.roomLayout, c.lights.map(light => light.id), !!drag);
  const lightById = new Map(c.lights.map(light => [light.id, light]));
  const measureViewport = () => scroll.current?.measureInWindow((_x, y, _width, height) => {
    viewport.current.top = y;
    viewport.current.height = height;
  });
  const measureBounds = () => {
    const parent = content.current;
    if (!parent) return;
    for (const [key, element] of elements.current) {
      element.measureLayout(parent, (_x, y, _width, height) => bounds.current.set(key, { y, height }));
    }
  };
  const updateTarget = () => {
    const current = active.current;
    if (!current) return;
    const geometry: RoomDropSection[] = sections.map(section => ({
      roomId: section.id,
      y: bounds.current.get(sectionKey(section.id))?.y ?? 0,
      rows: section.lightIds.flatMap(id => {
        const rect = bounds.current.get(`light:${id}`);
        return rect ? [{ lightId: id, ...rect }] : [];
      }),
    }));
    const target = roomDropTarget(geometry, current.y - viewport.current.top + viewport.current.offset, current.id);
    setDrop(previous => previous?.roomId === target?.roomId && previous?.beforeId === target?.beforeId ? previous : target);
    return target;
  };
  const begin = (light: HueLight, event: GestureResponderEvent) => {
    if (c.busy || pickingColor) return;
    suppressTap.current = true;
    measureViewport();
    measureBounds();
    const next = { id: light.id, name: light.name, y: event.nativeEvent.pageY };
    active.current = next;
    onDragStart();
    setDrag(next);
    AccessibilityInfo.announceForAccessibility(`Moving ${light.name}. Drag to a room or use the Move lamp menu.`);
  };
  const move = (y: number) => {
    if (!active.current) return;
    active.current = { ...active.current, y };
    setDrag(active.current);
    updateTarget();
  };
  const finish = (cancel = false) => {
    const current = active.current;
    if (!current) return;
    const target = updateTarget();
    active.current = null;
    setDrag(null);
    setDrop(null);
    setTimeout(() => { suppressTap.current = false; }, 0);
    if (!cancel && target) {
      void c.moveLightToRoom(current.id, target.roomId, target.beforeId).then(ok => {
        if (ok) AccessibilityInfo.announceForAccessibility(`${current.name} moved to ${sections.find(section => section.id === target.roomId)?.name ?? 'Unordered'}.`);
      });
    }
  };
  const tick = () => {
    if (!active.current) return;
    measureBounds();
    const view = viewport.current;
    const relativeY = active.current.y - view.top;
    const speed = relativeY < 64 ? -16 : relativeY > view.height - 64 ? 16 : 0;
    if (speed) {
      const next = Math.max(0, Math.min(Math.max(0, view.contentHeight - view.height), view.offset + speed));
      view.offset = next;
      scroll.current?.scrollTo({ y: next, animated: false });
    }
    updateTarget();
  };
  const latest = useRef({ move, finish, tick });
  latest.current = { move, finish, tick };
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: () => active.current !== null,
    onPanResponderMove: (_event, gesture) => latest.current.move(gesture.moveY),
    onPanResponderRelease: () => latest.current.finish(),
    onPanResponderTerminate: () => latest.current.finish(true),
    onPanResponderTerminationRequest: () => false,
  }), []);
  useEffect(() => {
    if (!drag) return;
    const timer = setInterval(() => latest.current.tick(), 40);
    return () => clearInterval(timer);
  }, [drag?.id]);
  useEffect(() => {
    const frame = requestAnimationFrame(measureBounds);
    return () => cancelAnimationFrame(frame);
  }, [drag?.id, expandedId, c.roomLayout, width]);
  const previousExpanded = useRef(expandedId);
  const reveal = useRef<string | null>(null);
  if (previousExpanded.current !== expandedId) {
    previousExpanded.current = expandedId;
    reveal.current = expandedId;
  }
  const remember = (key: string, rect: Bounds) => {
    bounds.current.set(key, rect);
    if (key === `light:${reveal.current}`) {
      reveal.current = null;
      scroll.current?.scrollTo({ y: Math.max(0, rect.y - spacing.sm), animated: false });
    }
  };
  const track = (key: string, element: ComponentRef<typeof View> | null) => {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  };
  const movingSection = moving && lightSections(c.roomLayout, c.lights.map(light => light.id), true)
    .find(section => section.lightIds.includes(moving.id));
  const moveIndex = moving && movingSection ? movingSection.lightIds.indexOf(moving.id) : -1;
  const moveWithinRoom = (direction: -1 | 1) => {
    if (!moving || !movingSection) return;
    const remaining = movingSection.lightIds.filter(id => id !== moving.id);
    const before = remaining[moveIndex + direction] ?? null;
    void c.moveLightToRoom(moving.id, movingSection.id, before);
  };
  return <View style={styles.container}>
    <ScrollView ref={scroll} scrollEnabled={!pickingColor && !drag} keyboardShouldPersistTaps="handled"
      onLayout={measureViewport} scrollEventThrottle={16}
      onContentSizeChange={(_width, height) => { viewport.current.contentHeight = height; }}
      onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.y; updateTarget(); }}>
      <View ref={content} style={[styles.content, width >= 700 && styles.wide]} {...responder.panHandlers}
        onTouchStart={() => { if (!active.current) suppressTap.current = false; }}
        onTouchMove={event => latest.current.move(event.nativeEvent.pageY)}
        onTouchEnd={() => latest.current.finish()}
        onTouchCancel={() => latest.current.finish(true)}
        onPointerMove={event => latest.current.move(event.nativeEvent.pageY)}
        onPointerUp={() => latest.current.finish()}
        onPointerCancel={() => latest.current.finish(true)}>
        {!c.lights.length && empty}
        {sections.flatMap(section => {
          const key = sectionKey(section.id);
          const room = c.roomLayout.rooms.find(item => item.id === section.id);
          const header = <View key={key} ref={element => track(key, element)} onLayout={event => remember(key, event.nativeEvent.layout)}
            style={styles.sectionHeader}>
            <Text variant="titleMedium" accessibilityRole="header" style={ui.flex}>{section.name}</Text>
            {room && <IconButton icon="dots-vertical" accessibilityLabel={`${room.name} room options`} disabled={c.busy || !!drag} onPress={() => setRoomMenu(room)} />}
          </View>;
          const rows = section.lightIds.map(id => {
            const light = lightById.get(id)!;
            return <View key={`light:${id}`} ref={element => track(`light:${id}`, element)} onLayout={event => remember(`light:${id}`, event.nativeEvent.layout)}
              style={[styles.item, drag?.id === id && styles.dragSource,
                drop?.roomId === section.id && drop.beforeId === id && styles.dropBefore]}>
              {children(light, {
                onLongPress: event => begin(light, event),
                canPress: () => !suppressTap.current,
                openMove: () => setMoving(light),
                dragging: !!drag,
              })}
            </View>;
          });
          const target = <View key={`${key}:end`} style={[
            styles.sectionEnd, !section.lightIds.length && styles.emptyRoom, drag && styles.dragEnd,
            drop?.roomId === section.id && drop.beforeId === null && styles.dropEnd,
          ]}>
            {(!section.lightIds.length || drag) && <Caption>{drag ? 'Drop a light here' : 'No lights in this room'}</Caption>}
          </View>;
          return [header, ...rows, target];
        })}
      </View>
    </ScrollView>
    {drag && <View pointerEvents="none" style={[styles.dragPreview, { top: Math.max(0, Math.min(viewport.current.height - 56, drag.y - viewport.current.top - 28)) }]}>
      <Text variant="titleMedium">{drag.name}</Text>
    </View>}
    <Sheet visible={!!roomMenu} title={roomMenu?.name ?? 'Room options'} onDismiss={() => setRoomMenu(null)}>
      <Action mode="text" icon="pencil" disabled={c.busy} onPress={() => {
        if (roomMenu) { setEditor(roomMenu); setRoomMenu(null); }
      }}>Rename room</Action>
      <Action mode="text" icon="arrow-up" disabled={c.busy || !roomMenu || c.roomLayout.rooms[0]?.id === roomMenu.id}
        onPress={() => { if (roomMenu) void c.reorderLightRoom(roomMenu.id, -1).then(ok => { if (ok) setRoomMenu(null); }); }}>Move room up</Action>
      <Action mode="text" icon="arrow-down" disabled={c.busy || !roomMenu || c.roomLayout.rooms.at(-1)?.id === roomMenu.id}
        onPress={() => { if (roomMenu) void c.reorderLightRoom(roomMenu.id, 1).then(ok => { if (ok) setRoomMenu(null); }); }}>Move room down</Action>
      <Action mode="text" icon="delete-outline" textColor={palette.error} disabled={c.busy} onPress={() => { setDeleting(roomMenu); setRoomMenu(null); }}>Delete room</Action>
      {c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}
    </Sheet>
    <Sheet visible={!!moving} title={`Move ${moving?.name ?? 'lamp'}`} onDismiss={() => setMoving(null)}>
      <Text variant="titleMedium">Move to room</Text>
      {lightSections(c.roomLayout, c.lights.map(light => light.id), true).map(section =>
        <RadioButton.Item key={sectionKey(section.id)} label={section.name} value={sectionKey(section.id)}
          status={movingSection?.id === section.id ? 'checked' : 'unchecked'} disabled={c.busy}
          onPress={() => {
            if (moving) void c.moveLightToRoom(moving.id, section.id).then(ok => { if (ok) setMoving(null); });
          }} />)}
      <Action mode="text" icon="arrow-up" disabled={c.busy || moveIndex <= 0} onPress={() => moveWithinRoom(-1)}>Move lamp up</Action>
      <Action mode="text" icon="arrow-down" disabled={c.busy || !movingSection || moveIndex < 0 || moveIndex >= movingSection.lightIds.length - 1}
        onPress={() => moveWithinRoom(1)}>Move lamp down</Action>
      {c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}
    </Sheet>
    {editor && <RoomEditor controller={c} room={editor} onDismiss={() => setEditor(null)} />}
    <Portal>
      <Dialog visible={!!deleting} dismissable={!c.busy} onDismiss={() => setDeleting(null)}>
        <Dialog.Title>Delete room?</Dialog.Title>
        <Dialog.Content style={ui.stack}>
          <Text>Delete {deleting?.name}? Its lamps return to Unordered. Your lights and lighting groups are not changed.</Text>
          {c.error && <Text accessibilityRole="alert" style={styles.error}>{c.error}</Text>}
        </Dialog.Content>
        <Dialog.Actions><Action mode="text" disabled={c.busy} onPress={() => setDeleting(null)}>Cancel</Action>
          <Action mode="text" textColor={palette.error} disabled={c.busy} onPress={() => {
            if (deleting) void c.removeLightRoom(deleting.id).then(ok => { if (ok) setDeleting(null); });
          }}>Delete room</Action></Dialog.Actions>
      </Dialog>
    </Portal>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  wide: { maxWidth: 900, paddingHorizontal: spacing.xxl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: spacing.sm },
  item: { paddingTop: spacing.sm, borderTopWidth: 3, borderTopColor: 'transparent' },
  sectionEnd: { minHeight: spacing.lg, borderWidth: 2, borderColor: 'transparent', borderRadius: radius.sm },
  emptyRoom: { padding: spacing.lg, backgroundColor: palette.surface },
  dropBefore: { borderTopColor: palette.primary },
  dragEnd: { padding: spacing.md },
  dropEnd: { borderColor: palette.primary, backgroundColor: palette.high },
  dragSource: { opacity: 0.35 },
  dragPreview: { position: 'absolute', left: spacing.xl, right: spacing.xl, padding: spacing.lg, borderRadius: radius.md, backgroundColor: palette.high, borderWidth: 2, borderColor: palette.primary },
  error: { color: palette.error },
});
