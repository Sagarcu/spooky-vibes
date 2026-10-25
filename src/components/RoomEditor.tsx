import { useState } from 'react';
import { Appbar, Dialog, Portal, Text } from 'react-native-paper';
import type { LightRoom } from '../services/rooms';
import { palette } from '../theme';
import type { LightingController } from '../useLightingController';
import { Action, Field, ui } from './ui';

export function AddRoomAction({ controller }: { controller: LightingController }) {
  const [visible, setVisible] = useState(false);
  return <>
    <Appbar.Action icon="plus" accessibilityLabel="Add room" disabled={controller.busy} onPress={() => setVisible(true)} />
    {visible && <RoomEditor controller={controller} onDismiss={() => setVisible(false)} />}
  </>;
}

export function RoomEditor({ controller: c, room, onDismiss }: {
  controller: LightingController; room?: LightRoom; onDismiss: () => void;
}) {
  const [name, setName] = useState(room?.name ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);
  return <Portal><Dialog visible dismissable={!c.busy} onDismiss={onDismiss}>
    <Dialog.Title>{room ? 'Rename room' : 'Add room'}</Dialog.Title>
    <Dialog.Content style={ui.stack}>
      <Field label="Room name" value={name} autoCapitalize="words" editable={!c.busy} error={!!fieldError}
        onChangeText={value => { setName(value); setFieldError(null); }} />
      {fieldError && <Text accessibilityRole="alert" style={{ color: palette.error }}>{fieldError}</Text>}
      {c.error && <Text accessibilityRole="alert" style={{ color: palette.error }}>{c.error}</Text>}
    </Dialog.Content>
    <Dialog.Actions>
      <Action mode="text" disabled={c.busy} onPress={onDismiss}>Cancel</Action>
      <Action mode="text" disabled={c.busy || !name.trim()} onPress={() => {
        if (c.roomLayout.rooms.some(item => item.id !== room?.id && item.name.toLowerCase() === name.trim().toLowerCase())) {
          setFieldError('A room with that name already exists. Choose a different name.');
          return;
        }
        void c.saveLightRoom(room?.id ?? null, name).then(ok => { if (ok) onDismiss(); });
      }}>Save room</Action>
    </Dialog.Actions>
  </Dialog></Portal>;
}
