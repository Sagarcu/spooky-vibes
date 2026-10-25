import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteRoom, emptyRoomLayout, lightSections, moveRoomLight, parseRoomLayout, reorderRoom, roomDropTarget, saveRoom, type RoomLayout } from '../src/services/rooms';

const layout = (): RoomLayout => ({
  rooms: [
    { id: 'living', name: 'Living room', lightIds: ['1', 'offline', '2'] },
    { id: 'bed', name: 'Bedroom', lightIds: [] },
  ],
  unorderedLightIds: ['4', '3'],
});

test('new lamps start unordered and available lamps follow saved room and lamp order', () => {
  assert.deepEqual(lightSections(layout(), ['1', '2', '3', '4', 'new']), [
    { id: null, name: 'Unordered', lightIds: ['4', '3', 'new'] },
    { id: 'living', name: 'Living room', lightIds: ['1', '2'] },
    { id: 'bed', name: 'Bedroom', lightIds: [] },
  ]);
  assert.deepEqual(lightSections(emptyRoomLayout(), ['2', '1']), [
    { id: null, name: 'Unordered', lightIds: ['2', '1'] },
  ]);
});

test('hide empty Unordered but retain empty rooms and expose an unassignment drop target during drag', () => {
  const saved = { rooms: layout().rooms, unorderedLightIds: [] };
  assert.deepEqual(lightSections(saved, ['1', '2']).map(section => section.id), ['living', 'bed']);
  assert.deepEqual(lightSections(saved, ['1', '2'], true)[0], { id: null, name: 'Unordered', lightIds: [] });
});

test('room creation and renaming trim names, reject empty and duplicate names, and preserve assignments', () => {
  const added = saveRoom(layout(), 'office', '  Office  ');
  assert.deepEqual(added.rooms.at(-1), { id: 'office', name: 'Office', lightIds: [] });
  const renamed = saveRoom(added, 'living', ' Lounge ');
  assert.deepEqual(renamed.rooms[0], { id: 'living', name: 'Lounge', lightIds: ['1', 'offline', '2'] });
  assert.throws(() => saveRoom(layout(), 'office', ' BEDROOM '), /already exists/);
  assert.throws(() => saveRoom(layout(), 'office', '  '), /name/);
  assert.equal(saveRoom(layout(), 'living', 'Living room').rooms.length, 2);
});

test('moving lamps assigns exactly one room, remembers new unordered lamps, and preserves offline assignments', () => {
  const original = layout();
  const next = moveRoomLight(original, ['1', '2', '3', '4', 'new'], '3', 'living', '2');
  assert.deepEqual(next.rooms[0]?.lightIds, ['1', 'offline', '3', '2']);
  assert.deepEqual(next.unorderedLightIds, ['4', 'new']);
  assert.deepEqual(original, layout());
  const movedAgain = moveRoomLight(next, ['1', '2', '3', '4', 'new'], '3', 'bed');
  assert.deepEqual(movedAgain.rooms[0]?.lightIds, ['1', 'offline', '2']);
  assert.deepEqual(movedAgain.rooms[1]?.lightIds, ['3']);
});

test('move within a section both directions, append, and return to Unordered', () => {
  const available = ['1', '2', '3', '4'];
  const down = moveRoomLight(layout(), available, '1', 'living');
  assert.deepEqual(down.rooms[0]?.lightIds, ['offline', '2', '1']);
  const up = moveRoomLight(down, available, '1', 'living', '2');
  assert.deepEqual(lightSections(up, available)[1]?.lightIds, ['1', '2']);
  const unordered = moveRoomLight(up, available, '1', null, '3');
  assert.deepEqual(unordered.unorderedLightIds, ['4', '1', '3']);
  assert.deepEqual(unordered.rooms[0]?.lightIds, ['offline', '2']);
});

test('reject invalid moves without modifying the original layout', () => {
  const original = layout();
  assert.throws(() => moveRoomLight(original, ['1'], 'missing', 'living'), /no longer available/);
  assert.throws(() => moveRoomLight(original, ['1'], '1', 'missing'), /room/);
  assert.throws(() => moveRoomLight(original, ['1'], '1', 'bed', '2'), /destination/);
  assert.throws(() => moveRoomLight(original, ['1'], '1', 'living', '1'), /itself/);
  assert.deepEqual(original, layout());
});

test('deleting rooms returns all their lamps, including offline lamps, to Unordered', () => {
  const next = deleteRoom(layout(), 'living');
  assert.deepEqual(next.unorderedLightIds, ['4', '3', '1', 'offline', '2']);
  assert.deepEqual(next.rooms, [{ id: 'bed', name: 'Bedroom', lightIds: [] }]);
  assert.throws(() => deleteRoom(layout(), 'missing'), /no longer available/);
});

test('room reordering preserves room contents and rejects out-of-bounds changes', () => {
  const down = reorderRoom(layout(), 'living', 1);
  assert.deepEqual(down.rooms.map(room => room.id), ['bed', 'living']);
  assert.deepEqual(reorderRoom(down, 'living', -1), layout());
  assert.throws(() => reorderRoom(layout(), 'living', -1), /further/);
  assert.throws(() => reorderRoom(layout(), 'bed', 1), /further/);
  assert.throws(() => reorderRoom(layout(), 'missing', 1), /no longer available/);
});

test('stored layout round-trips order and offline assignments and rejects invalid or duplicate data', () => {
  assert.deepEqual(parseRoomLayout(JSON.stringify(layout())), layout());
  for (const raw of [
    '{', 'null', '{}', '[]',
    JSON.stringify({ rooms: [null], unorderedLightIds: [] }),
    JSON.stringify({ rooms: [{ id: 'x', name: '', lightIds: [] }], unorderedLightIds: [] }),
    JSON.stringify({ rooms: [], unorderedLightIds: [2] }),
    JSON.stringify({ rooms: layout().rooms, unorderedLightIds: ['1'] }),
    JSON.stringify({ rooms: [layout().rooms[0], layout().rooms[0]], unorderedLightIds: [] }),
    JSON.stringify({ rooms: [{ id: 'a', name: 'Room', lightIds: [] }, { id: 'b', name: ' room ', lightIds: [] }], unorderedLightIds: [] }),
  ]) assert.throws(() => parseRoomLayout(raw));
});

test('drop targets use row midpoints, ignore the dragged lamp, and support empty sections', () => {
  const sections = [
    { roomId: null, y: 50, rows: [] },
    { roomId: 'living', y: 100, rows: [{ lightId: '1', y: 150, height: 80 }, { lightId: '2', y: 240, height: 80 }] },
    { roomId: 'bed', y: 340, rows: [] },
  ];
  assert.deepEqual(roomDropTarget(sections, 40, '1'), { roomId: null, beforeId: null });
  assert.deepEqual(roomDropTarget(sections, 180, 'new'), { roomId: 'living', beforeId: '1' });
  assert.deepEqual(roomDropTarget(sections, 200, 'new'), { roomId: 'living', beforeId: '2' });
  assert.deepEqual(roomDropTarget(sections, 160, '1'), { roomId: 'living', beforeId: '2' });
  assert.deepEqual(roomDropTarget(sections, 300, '1'), { roomId: 'living', beforeId: null });
  assert.deepEqual(roomDropTarget(sections, 350, '1'), { roomId: 'bed', beforeId: null });
  assert.equal(roomDropTarget([], 10, '1'), null);
});
