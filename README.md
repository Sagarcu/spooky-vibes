# Spooky Vibes

A phone-ready Expo/React Native controller for Philips Hue Halloween lighting. It runs directly on your local network and talks to your Hue Bridge using the Hue v1 local API.

Previously named Spooky Moods. The package name and Expo slug are now `spooky-vibes`, and the Android/iOS application identifier is `com.spookyvibes.app`. Rebuild native installations to use the new name and identifiers. The new identifier installs as a separate app and does not automatically inherit the old installation's saved data. Existing `spooky-moods.*` storage keys are retained for compatibility within the same app storage.

## What is included

- Bridge discovery through the official Philips Hue discovery service
- Link-button pairing and encrypted credential storage with `expo-secure-store`
- Hue capability detection, a touch-enabled RGB color wheel, six white-light presets, and an expanded default color palette
- Persistent named light groups, such as **Downstairs**, with any combination of Hue lights
- A local sequence runner with cancellation; **Haunted Pulse** alternates orange and purple, while **Candlelight** flickers continuously
- No cloud backend and no Hue credentials committed to the repository

## Prerequisites

- Node.js 20+ (Node 22 is supported)
- A physical Android or iPhone on the same LAN as the Hue Bridge
- Expo Go for development, or an Expo development build
- A Philips Hue Bridge with its link button available

## Get running

```powershell
npm install
npm run start
```

Scan the QR code from Expo Go. For reliable local bridge access, use a physical phone rather than a web browser or emulator.

If you still see the old Hue/Saturation/Brightness sliders, reload the project in Expo Go from the current QR code. If a reload does not update it, restart the dev server with `npx expo start --clear` and rescan the code. An installed APK is a separate build and must be rebuilt and reinstalled to receive UI changes.

## App layout

The home screen is intentionally minimal: choose a sequence, then tap **Run sequence**. Use the menu button in the top-left to open the side menu:

- **Connect your bridge** — discover, pair, reconnect, or forget the Hue Bridge.
- **Lamp Overview** — select, rename, and control individual lamps. RGB lamps have a **Color & brightness** button for their dedicated controls.
- **Group Overview** — create groups and select the group targeted by the home sequence.
- **Sequence Creator** — create, edit, and delete group timelines with individual lamp actions.

**Candlelight** gently varies brightness within 10% to 40% until you tap **Stop sequence**. The Hue Bridge fades each change over 500 ms, with the next target sent about every 600 ms, giving the fade time to finish. Brightness changes by at most 6 percentage points instead of jumping to an unrelated random level. If the bridge responds slowly, the app waits for it before sending another request. On lamps that support color temperature it sets a warm 2200 K white; dimmable-only lamps flicker at their current color. On/off-only smart switches cannot flicker and are skipped in mixed groups. The lamp remains at its last brightness when stopped.

## Connect the bridge

1. Tap **Discover bridge**. If discovery cannot find it, enter its LAN IPv4 address (for example `192.168.1.20`) and tap **Use this address**.
2. Press the physical link button on the Hue Bridge.
3. Within 30 seconds, tap **Pair bridge** in the app.
4. Tap **Refresh lights**, select a light, then use the controls or run the sequence.

## Rename a lamp

In **Lamp Overview**, select a lamp, tap **Rename**, enter a name (up to 32 characters), then tap **Save to Hue Bridge**. This changes the lamp's name on the bridge, not just on your phone; refreshing the lamp list picks up names changed elsewhere too. The phone must be on the same network as the bridge.

If Google Home is linked to your Hue account, it may pick up the new Hue name when it syncs devices; this app cannot force Google Home to update it. If the old name remains, try syncing devices in Google Home (or ask Google Assistant to “sync my devices”). A custom name set in Google Home or a different integration such as Matter may remain independent of the Hue Bridge name.

## Create a group for sequences

1. In **Create a light group**, enter a name such as `Downstairs`.
2. Tap every light that belongs in that group, then tap **Save group**.
3. In **Choose a sequence target**, select the saved group.
4. Run **Haunted Pulse**. Each step is sent to every available light in that group at the same time.

Groups are kept securely on the phone. They can overlap (for example, a light may be in both `Downstairs` and `Front Porch`), and deleting a group does not affect any Hue light. If a saved light is unavailable, it is skipped for that sequence run.

## Create a timeline sequence

1. Create a group in **Group Overview**, then open **Sequence Creator** and tap **New sequence**.
2. Enter a name, select a group and choose a duration (1–120 seconds).
3. Swipe empty timeline space horizontally to see later times. Each row represents one lamp; tap a row at a second to add an **On** (with brightness) or **Off** action. For RGB lamps, **RGB color** offers eight presets or custom hue/saturation; for tunable-white lamps, **White preset** offers Candle (2200 K), Warm, Soft, Neutral, Cool and Daylight. **Keep current** leaves the existing color unchanged. Drag a colored marker left or right on its lamp row to move it; the live time indicator snaps to 0.1-second increments. Tap a marker or an item in **Actions** to edit it precisely or remove it. Actions cannot be dropped on another action for the same lamp at the same time.
4. **Add background** imports one optional ambient track; **Add effect** imports timed effects. For a file-free test, tap **Hear creepy knocks** or **Hear eerie chime**, then **Add knocks to effects** or **Add chime to effects** to put either sound on the timeline. Tap **Preview this clip (no lights)** in a clip's editor to check an imported sound. Drag audio bars to move their starts on their existing tracks, or tap a bar to enter a precise start time or adjust volume. Bars show the file's duration and clip at the sequence end; overlapping effects appear on separate subrows. Files are copied or generated in app storage.
5. Tap **Preview sequence (lights + audio)** to try the current draft without saving it. The app reads the affected lamps' current settings from the bridge first, runs the sequence, then restores their power, brightness and active color mode when playback ends. **Stop preview & restore lamps** also stops the audio and restores the lamps after any in-flight bridge commands settle. If a lamp cannot be restored, the app reports an error. Preview requires the selected group and a connected Hue Bridge; leaving the editor also stops the preview. **Preview always restores the lamps**, regardless of the sequence setting below.
6. Use **Restore lamps after Home playback** if Home should also restore the affected lamps when the sequence finishes or you tap Stop. This switch defaults to off, including for older saved sequences. Tap **Save sequence** to persist it. Home playback otherwise keeps the final lamp state; the built-in Haunted Pulse and Candlelight sequences remain unchanged. If a restore fails, the app reports an error.

Custom timelines are stored on this device (not on the Hue Bridge) and are removed by **Forget bridge**. Timeline playback uses the local Hue REST API, so dense or simultaneous actions may be delayed by bridge response time; timing is not sample-accurate. If a timeline lamp is unavailable, playback is disabled until it returns or you edit the sequence. Color and white presets change to a fixed color/temperature at that point; the continuously flickering **Candlelight** preset remains a separate Home sequence. On/off smart switches only receive power actions.

If the knock is silent in its direct preview, check the phone's media volume, output device, and any preview error shown in the app. If preview works but a sequence is silent, check that you saved the edited sequence and selected it on Home. If only an imported clip is silent, preview that clip separately or replace the file.

## Set a light color manually

Each light is classified from the Bridge response as **Color lamp**, **Tunable white lamp**, or **Dimmable lamp**. Select a light in **Choose a light** to see its supported controls:

- **Color lamps** show a **Color & brightness** button. It opens a separate screen with a touch color wheel (tap or drag around the edge for hue and toward the center for saturation), a 0–100% brightness slider, eight default colors, and six white-temperature presets. Tap **Apply color** to send the wheel selection to the Bridge. The wheel is outside the scrollable preset list, so dragging to select a color will not scroll the screen.
- **Tunable white lamps** support the six default white temperatures: Candle, Warm, Soft, Neutral, Cool, and Daylight.
- **Dimmable lamps** provide power and brightness controls only.
- **Smart switches** (Hue on/off plug-in units) are detected separately and provide power controls. Dimmable plug-in units also retain brightness controls.

The swatch below the wheel previews the chosen result before it is sent to the Bridge. On dimmable devices the brightness slider applies when released; 0% turns the light off.

The bridge IP and generated Hue username are stored in the device's encrypted storage. When the app opens again, it automatically restores the bridge and reloads its lights. If the bridge was temporarily unreachable while the app started, use **Reconnect saved bridge** after your phone is back on the same Wi-Fi. Use **Forget bridge** to remove the saved connection.

## Test and quality commands

```powershell
npm run typecheck
npm test
```

## Notes

- Keep the phone and Hue Bridge on the same local network; guest Wi-Fi and VPNs can block access.
- Hue Bridge API v1 accepts HTTP connections on your LAN. Never expose the bridge port to the public internet.
- Candlelight uses local REST commands, not Hue Entertainment streaming. At this cadence, a fast bridge receives around 1–2 commands per second **per lamp**; large groups still require more requests. Actual update speed depends on network and bridge latency. Streaming would require a configured Hue entertainment area, a streaming client key, native DTLS/UDP support, and a custom Expo development or release build. An APK can include that native implementation, but simply building this existing app as an APK does not enable streaming.
- Sequences execute while the app remains open. Background execution would require a platform-specific native background task and is intentionally not implied by this starter.
