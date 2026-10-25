# Spooky Vibes

A phone-ready Expo/React Native controller for Philips Hue Halloween lighting. It runs directly on your local network and talks to your Hue Bridge using the Hue v1 local API.

Previously named Spooky Moods. The package name and Expo slug are now `spooky-vibes`, and the Android/iOS application identifier is `com.spookyvibes.app`. Rebuild native installations to use the new name and identifiers. The new identifier installs as a separate app and does not automatically inherit the old installation's saved data. Existing `spooky-moods.*` storage keys are retained for compatibility within the same app storage.

## What is included

- Bridge discovery through the official Philips Hue discovery service
- Link-button pairing and encrypted credential storage with `expo-secure-store`
- Hue capability detection, a touch-enabled RGB color wheel, six white-light presets, and eight RGB color presets
- Persistent named light groups, such as **Downstairs**, with any combination of Hue lights
- Device-local room sections with drag-and-drop lamp organization, shared with group creation
- Custom timeline playback on Home, with cancellation and optional lamp restoration
- Saved, configurable **Candlelight**, **Halloween storm**, and timeline **Ambiance** modes with independent start/stop and per-lamp priority for Home and editor previews, including Android background playback in custom builds
- No cloud backend and no Hue credentials committed to the repository

## Prerequisites

- Node.js 22.13+ (22.x), 24.3+ (24.x), or 26+
- A physical Android or iPhone on the same LAN as the Hue Bridge
- Expo Go compatible with SDK 58 for foreground development, or a custom Android build for Ambiance
- A Philips Hue Bridge with its link button available

## Get running

```powershell
npm install
npm run start
```

Scan the QR code from Expo Go. For reliable local bridge access, use a physical phone rather than a web browser or emulator.

### Android background ambiance

Android Ambiance uses the local native module in [modules/spooky-ambiance](modules/spooky-ambiance), so it **requires a custom Android build**. Expo Go can still use Home and editor previews, but starting Ambiance there reports that a custom build is required. A JavaScript reload or over-the-air update cannot add the native service to an older APK.

With Android Studio, its Android SDK and a compatible JDK installed, connect an Android phone with USB debugging enabled and run:

```powershell
npx expo run:android --device
```

Expo generates the native Android project and autolinks the local module. Rebuild and reinstall after changing native module code or permissions, including the configurable Ambiance brightness/colors and updated smart-plug behavior. A JavaScript-only reload cannot update the native scheduler. The generated `android` directory is ignored; keep native changes in the local module, not generated files.

Gradle must also know the Android SDK location. Set `ANDROID_HOME` in your Windows user environment and fully restart VS Code, or set `sdk.dir` in the machine-local, ignored `android/local.properties` file. Android Studio can create that file when opening the generated Android project. Do not commit machine-specific SDK paths. If Gradle reports **SDK location not found**, installing Platform-Tools or adding `adb` to `Path` alone is not sufficient.

Windows builds use [an Expo config plugin](plugins/with-windows-cmake-paths.js) to limit CMake object paths to 240 characters. This makes CMake hash long generated paths before they reach Ninja's Windows filename limit. If an Android project already exists when this configuration changes, run `npx expo prebuild --platform android --no-install` once before building again; do not edit the generated Gradle file manually.

On first use:

1. Allow notifications so the running notification and its **Stop all** control are available.
2. If prompted, allow **Spooky Vibes** to run without battery optimization in Android's settings. Return to the app and start Ambiance again. This exemption is required because Doze can otherwise block local Hue network access even with a foreground service. The app opens the system battery-optimization list; names and additional background restrictions vary by manufacturer.
3. Start one or more modes, then lock the screen or open another app. Keep the phone on the bridge's local Wi-Fi network.

The Android service owns lighting timers, Hue requests and timeline audio independently of React screens. Its ongoing notification shows the number of modes, opens the app when tapped, and offers **Stop all**. CPU and Wi-Fi locks are held only while the service is running, so continuous ambiance uses more battery. Playback errors stop the affected mode, produce an error notification, and are shown in the app when it is reopened. Disconnecting headphones/Bluetooth output stops modes containing audio; light-only modes continue.

Returning to the app reconnects to live service state rather than starting duplicate modes. Modes, playback credentials and error history are kept only in process memory, not saved as background jobs. Swiping away the task may stop playback; force-stop, reboot and process termination do not automatically restart it. iOS and web retain foreground-only playback. Home and editor previews themselves remain foreground-only on every platform.

This project uses Expo SDK 58. If Expo Go reports an incompatible SDK, check that the version installed on your phone supports SDK 58. After upgrading the project, stop the previous dev server, run `npx expo start --clear`, and scan the new QR code. Existing development builds must be rebuilt after an SDK upgrade.

If the UI does not update, reload the project in Expo Go from the current QR code. If a reload does not update it, restart the dev server with `npx expo start --clear` and rescan the code. An installed APK is a separate build and must be rebuilt and reinstalled to receive UI changes.

### Standalone Android APK (no USB or development server)

For personal use, build a release APK with the JavaScript and assets bundled inside it. This includes the native background ambiance module. With the Android SDK and JDK configured as described above, run:

```powershell
npx expo prebuild --platform android --no-install
.\android\gradlew.bat -p .\android :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

This builds for arm64 phones, including the OnePlus 8T. The APK is generated at `android\app\build\outputs\apk\release\app-release.apk`. To update a connected, USB-debugging-authorized phone without uninstalling the app:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r ".\android\app\build\outputs\apk\release\app-release.apk"
```

Adjust the SDK path if it is installed elsewhere; use `-s SERIAL` before `install` if multiple devices are connected. After installation, open **Spooky Vibes** from the phone launcher. USB and Metro are no longer needed, but the phone must remain on the Hue Bridge's local Wi-Fi network. The notification and battery-optimization permissions described above still apply.

The generated Expo project currently signs release builds with its development keystore. This is suitable only for personal sideloading, not store publication or public distribution. Updates preserve local data only when the application ID and signing key match the installed app. Keep that keystore if you need to rebuild compatible personal updates; do not uninstall the app or regenerate its key to work around a signature mismatch without first preserving your data. A distributed release needs a separately managed private signing key.

Rebuild and reinstall this APK to receive future code or asset changes; restarting the development server does not update a standalone installation.

### App icon

The approved **Little light keeper** icon is a lilac ghost holding an amber bulb, matching the Midnight Studio palette. Its editable artwork is [assets/icon.svg](assets/icon.svg). [assets/icon.png](assets/icon.png) is the full-color app icon; Android uses a transparent [adaptive foreground](assets/adaptive-icon.png) on midnight plum and a separate [monochrome layer](assets/monochrome-icon.png) for themed icons. Both Android layers have editable SVG sources alongside their PNGs. Launcher masks and themed colors depend on the device.

Icon changes require rebuilding and reinstalling the native app; a JavaScript reload does not update the launcher icon. For an existing Android project, regenerate the native resources before rebuilding:

```powershell
npx expo prebuild --platform android --no-install
npm run android -- --device
```

## App layout

The UI uses React Native Paper and the approved **Midnight Studio** Material 3 theme: dark plum surfaces, lilac controls, and amber atmosphere accents. The [approved mockup board](docs/material-redesign.html) is the visual reference (open the HTML file in a browser). Theme colors, typography defaults, and spacing are shared through [src/theme.ts](src/theme.ts).

Until a bridge responds successfully, the app opens directly on **Connect your bridge**, with discovery, manual address entry, and link-button pairing. Successful initial pairing opens Home and unlocks the app's screens and navigation. Saved connections are checked automatically at startup; if a saved bridge is unreachable, the bridge screen offers reconnect controls. The other screens and navigation stay hidden while disconnected, including after forgetting a bridge or a failed reconnect; connection errors appear as notifications.

Once connected, five bottom navigation destinations become a navigation rail on wider screens:

- **Home** — swipe left/right between saved custom timeline cards (or use the previous/next buttons), then tap **Run sequence**. Swiping selects but never starts playback. Each timeline uses its saved group; there is no separate target picker. Candlelight and Halloween storm are available only in Ambiance. With no custom timelines, Home offers **Create a timeline**. Returning from another screen restores the selected card and its position indicator together. Browsing is locked during playback. The compact controls fit a typical phone screen; smaller screens and larger text can scroll.
- **Ambiance** — create named, saved Candlelight, Halloween storm, or timeline modes. Configure a built-in's group or single lamp, brightness limits, RGB colors, and independent adjustable-white tones before choosing **Save** or **Save & start**. Stopped cards remain ready to **Start** again; **Edit** changes the saved setup and **Delete** explicitly removes it after confirmation. Run several modes at once or use **Stop all**, without deleting their setups. Timelines use their saved group and repeat their audio too. See [Ambiance playback](#ambiance-playback) and the [updated screen reference](docs/saved-ambiance.html).
- **Lights** (**Your lights**) — tap a lamp header to expand its supported controls; opening another lamp closes the previous one and brings the new card into view. Tap the expanded lamp's icon or header background again to hide its details; all cards can be collapsed without changing saved playback targets. The power switch only changes power. Tapping the expanded lamp's name still renames it. RGB lamps show the color wheel, full-width **White presets** (when supported) and **Color presets** buttons stacked vertically, then brightness, all in the lamp card. Each button opens a small anchored menu: six named white temperatures or eight named RGB colors, with color swatches. Choosing a preset closes the menu and applies it at the saved brightness (or 80% if brightness is zero); opening or dismissing a menu changes nothing. Releasing the wheel applies the final color once; dragging only previews it, and a canceled gesture sends nothing. Selecting a wheel color turns the lamp on at its saved brightness (or 80% if brightness is zero). There is no separate color screen or Apply button. Tunable-white lamps keep their six compact white-tone circles in a single row above brightness, from Candle to Daylight, without a heading; each circle has an accessible preset name and temperature. A ring (or a check in the RGB lamp's white menu) highlights the preset nearest to the bridge-reported temperature (ties favor the warmer preset); no selection is shown when temperature is unavailable or an RGB lamp is in color mode. The indicator reflects the last bridge refresh, including after applying a preset, rather than live monitoring changes from other apps.
- **Groups** (**Your groups**) — each card shows its name with **Edit** (pencil) and **Delete** (trash) icons directly after the title, and its lamp names underneath. Delete asks for confirmation. Edit opens the same room-organized picker as **New group**, prefilled with the existing name and lamps. Add or remove lamps across rooms, then **Save**; Back discards unsaved changes. At least one lamp is required, and names must be unique ignoring capitalization. Unavailable saved lamps remain selected unless explicitly removed, and can be checked again before saving. Saving preserves the group's ID, so Home and timelines retain their group references; timelines referencing a removed lamp must be edited before playback. Editing and deletion are disabled during playback. There are no default-target controls or settings sheet. The [approved group editing mockup](docs/group-editing.html) supersedes the earlier [group settings wireframes](docs/group-settings.html).
- **Sequences** (**Your sequences**) — create, edit, and delete custom timelines. A link opens Ambiance for continuous moods; built-ins are no longer Home sequence choices. The library remains a list; only Home uses swipeable cards. The library and timeline editor are separate views. Action editors use bottom sheets on phones and a side inspector on wide screens; audio has a dedicated library and clip editor.

Screen content keeps control labels and useful state information without decorative headings or routine how-to paragraphs. Errors, connection/pairing requirements, and destructive-action confirmations remain visible.

### Organize lights into rooms

On **Your lights**, use the **+ (Add room)** button in the top bar, beside refresh, to create a section. Long-press a lamp header (including its icon or name) to pick it up, drag to a room or between lamps, and release to save its position. A highlighted insertion line or drop area marks the destination. Holding near the top or bottom scrolls the list. Dragging temporarily hides the expanded controls without changing saved playback targets or sending commands to the bridge.

The lamp's **three-dot menu** offers **Move to room**, **Move lamp up**, and **Move lamp down**, including for keyboard and screen-reader users. Choose **Unordered** to remove its room assignment. New lamps start in Unordered; this header is hidden when empty, except while dragging so it remains a drop target. Empty named rooms stay visible.

A room's **three-dot menu** lets you rename it, move the section up or down, or delete it after confirmation. Deleting a room returns its lamps to Unordered without deleting lamps or changing lighting groups. Room names must be nonempty and unique (ignoring capitalization). A lamp belongs to at most one room, but can still belong to multiple lighting groups.

Rooms and lamp ordering are saved on this device, not to Hue rooms or zones. Ambiance's **Choose group or lamp** picker shows single lamps in the same room sections and order as **Your lights** and **New group**, including Unordered lamps and empty named rooms. Choosing a lamp selects only that lamp for playback. Refreshes and app restarts retain the layout; temporarily unavailable lamps keep their saved assignments for when they return. **Forget bridge** also removes rooms and saved ambiance setups, preventing assignments from carrying over to a different bridge. The [approved room wireframes](docs/room-organization.html) record the agreed layout and interactions; they extend the existing Midnight Studio theme.

Tap the **Bridge/Connect** indicator on Home (or the bridge icon in the wide-screen navigation rail) to discover, pair, reconnect, or forget the Hue Bridge. Connection status reflects a successful bridge response, not merely saved credentials. Error notifications appear in a dismissible banner at the top, with additional feedback inside relevant dialogs and editors, and clear automatically after three seconds. Each new error restarts the timer, even when its message is unchanged; inline field validation remains until corrected. There is no persistent bottom status line. Deleting groups, deleting timelines, and forgetting a bridge require confirmation.

Color controls and editor sheets can scroll on short screens and with larger text. Wheel gestures temporarily lock their containing scroll view. The wheel's static color background is cached separately from its moving selection marker, avoiding hundreds of SVG updates during each drag. The wheel supports screen-reader hue adjustments; keyboard users can use Left/Right for hue and Up/Down for saturation. These adjustments apply immediately for lamp controls. There are no separate precise color sliders; timeline actions and audio retain their list-based precise editors.

Under an RGB lamp's wheel, tap its hex code to edit it or select and copy it using the text field's normal copy controls. Enter three or six hexadecimal digits, with or without `#`, then choose **Save hex color** (or submit the field). Saving applies both color and brightness so the same code can be reused on another lamp; `#000000` turns the lamp off. Invalid input shows an inline error and sends nothing. Hue's numeric rounding and each lamp's color gamut can slightly affect the reported code and physical color. The saturation percentage is no longer displayed.

`npm run web` provides a browser preview. Secure storage, local audio files, and real Hue control remain native-device features; use a physical Android/iPhone for end-to-end operation.

**Candlelight** defaults to brightness between 8% and 50%, with configurable whole-percentage limits from 1% to 100% (minimum must not exceed maximum). Equal limits give fixed brightness. Light smoothing stays within the range. Each target lasts a randomly chosen 600–2000 ms, with an independently varied 200–800 ms fade that always finishes before the next target. Slow bridge responses finish before the next request. RGB lamps default to 2200 K white where supported; choose another white temperature, a wheel color, or keep current color. Non-RGB adjustable-white lamps have their own shared **Candlelight white** setting, independent of RGB: keep current white (the default), choose a named white preset, or adjust its temperature from 2000 to 6500 K. Fixed-white lamps keep their tone. All dimmable lamps flicker at the configured brightness. On/off smart plugs turn on and stay on throughout Candlelight, including plug-only targets. Stopping leaves the final lamp/plug state.

**Halloween storm** alternates random 4–18 second gaps with 1–3 second lightning bursts. Lightning defaults to 80–100% brightness, with configurable limits from 1–100%. These limits do not apply to the quiet gaps, which randomly use darkness or a faint 1% glow. RGB lamps have independent lightning and faint-glow settings: white temperature, wheel color, or keep current color; defaults are 6500 K lightning and 2200 K glow where supported. Non-RGB adjustable-white lamps have independent **Lightning white** and **Faint-glow white** settings, each defaulting to keep current white. Their choices do not alter RGB colors or the shared brightness limits. Dark gaps never send a white-temperature change. Fixed-white lamps retain their tone. On/off smart plugs turn on for lightning and off during every gap, including faint-glow gaps. This is a light-only effect, not thunder audio or rapid strobing. Actual minimum brightness and color temperature depend on the lamp.

Ambiance reuses the Lights screen's RGB wheel, editable/copyable hex field, and full-width **White presets** and **Color presets** menus. The menus show the same six named whites and eight RGB colors with colored swatch icons. Lightning and faint-glow RGB colors each have these controls. A separate **White-only lamps** section appears when the target includes non-RGB adjustable-white lamps, reusing the white preset swatch menu, a temperature slider, and **Keep current white**. Choose a white preset to enable its slider. One white-only setting applies to all compatible lamps in the saved mode, not per lamp. Existing saved modes without white-only settings keep their current white. Color choices and hex input set hue/saturation only, leaving the saved brightness limits unchanged. Black is rejected for an effect color rather than silently turning a mode off. **Keep current color** remains available, and a white-temperature slider preserves precise values from 2000 to 6500 K on supported RGB lamps.

### Ambiance playback

- Tap **Add ambiance**, enter a name, choose an effect, and select a group or lamp for a built-in. Brightness controls appear for dimmable devices; RGB controls appear for RGB lamps, and separate white-only controls appear for non-RGB adjustable-white lamps. Fixed-white lamps and plugs need no additional configuration. Choose **Save** to keep a stopped card or **Save & start** to begin immediately. Custom timelines use their saved group and require every action lamp to be available; their colors and brightness come from timeline actions.
- Each mode saves its own name, target, brightness limits and colors on this device. Two modes may use the same effect and target with different settings. **Stop** and **Stop all** keep saved cards; **Start** runs them again. Editing a running mode asks to stop it first. Deleting a mode asks for confirmation and stops it before removing its configuration. A playback failure stops the runtime but keeps its saved setup.
- Each ambiance repeats until stopped, including saved timeline audio. The timeline's **Restore after Home playback** switch is ignored in Ambiance: it does not restore lamps at loop boundaries or when stopped. A timeline's audio is prepared again each loop, so loop boundaries are not guaranteed to be gapless. On custom Android builds this continues while the phone is locked or another app is open; see [Android background ambiance](#android-background-ambiance).
- Multiple modes, including the same sequence on different targets, run independently. Overlapping lamps are allowed with a warning: both ambiance modes send commands, with no blending or automatic arbitration between them. More modes and lamps mean more bridge requests; the user is responsible for choosing suitable combinations.
- Home playback and editor light previews reserve only the lamps they affect for their entire run, including any restoration. Ambiance commands already in flight finish before foreground playback starts; no further ambiance commands are sent to those lamps until it ends, fails, or is stopped. Other lamps continue. Ambiance timing and audio continue underneath, and the latest accumulated lamp state is reapplied immediately when priority is released; timelines do not restart from the beginning after an override.
- Manual controls in Lights do not pause ambiance and can be overwritten by its next command.
- Cards show stopped, running, partially active, waiting, or stopping state. A playback failure reports an error without repeatedly retrying; other modes are unaffected. Stopping waits for outstanding commands and leaves the final lamp state. Saved configurations survive app restarts but never automatically start playback. Android's existing service can reconnect to modes still running in the background. **Forget bridge** stops all modes and removes their saved configurations.
- Running modes retain the lamps selected when started; later group edits affect new starts, not an existing run. Stop a running ambiance timeline before saving changes to it or deleting it, so its active audio files are preserved. Editing a draft and previewing remain available.
- **Background means across screens within the open app.** This version does not provide reliable execution with the phone locked, another app open, or the app terminated. Keep the phone awake, the app open, and the bridge on the same LAN.

## Connect the bridge

1. Tap **Discover bridge**. If discovery cannot find it, enter its LAN IPv4 address (for example `192.168.1.20`).
2. Press the physical link button on the Hue Bridge.
3. Within 30 seconds, tap **Pair bridge** in the app.
4. Open **Lights**, refresh if needed using the refresh icon, select a light, then use the controls or run a sequence.

## Rename a lamp

In **Lights**, select a lamp, tap its name in the expanded lamp card, enter a name (up to 32 characters), then tap **Save to bridge**. Tapping an unselected lamp's name selects it first; tapping it again opens the rename dialog. This changes the lamp's name on the bridge, not just on your phone; refreshing the lamp list picks up names changed elsewhere too. The phone must be on the same network as the bridge.

If Google Home is linked to your Hue account, it may pick up the new Hue name when it syncs devices; this app cannot force Google Home to update it. If the old name remains, try syncing devices in Google Home (or ask Google Assistant to “sync my devices”). A custom name set in Google Home or a different integration such as Matter may remain independent of the Hue Bridge name.

## Create a group for sequences

1. Open **Groups**, tap **New group**, and enter a name such as `Downstairs`.
2. Tap every light that belongs in that group, then tap **Save** in the top-right app bar. Save stays visible while the light list scrolls and is enabled once the group has a unique name and at least one selected lamp.
3. Choose the saved group in a custom timeline or when creating an Ambiance mode.
4. For **Candlelight** or **Halloween storm**, select the group in **Ambiance**, configure the effect, then **Save & start**. Each step is adapted to the available devices' capabilities.

Groups are kept securely on the phone. They can overlap (for example, a light may be in both `Downstairs` and `Front Porch`), and deleting a group does not affect any Hue light. If a saved light is unavailable, it is skipped for that sequence run.

## Create a timeline sequence

1. Create a group in **Groups**, then open **Sequences** and tap **New sequence**.
2. Enter a name, select a group and choose a duration (1–120 seconds).
3. Swipe empty timeline space horizontally to see later times. Each row represents one lamp; tap a row at a second to add an **On** (with brightness) or **Off** action. For RGB lamps, **RGB color** offers eight presets or custom hue/saturation; for tunable-white lamps, **White preset** offers Candle (2200 K), Warm, Soft, Neutral, Cool and Daylight. **Keep current** leaves the existing color unchanged. Drag a colored marker left or right on its lamp row to move it; the live time indicator snaps to 0.1-second increments. Tap a marker or an item in **Actions** to edit it precisely or remove it. Actions cannot be dropped on another action for the same lamp at the same time.
4. Tap **Audio**, then **Import background** for one optional ambient track or **Import effect** for timed effects. For a file-free test, use **Hear sound** and **Add effect** on **Creepy knocks** or **Eerie chime**. Tap **Preview clip · no lights** in a clip's editor to check an imported sound. Drag audio bars to move their starts on their existing tracks, or tap a bar to enter a precise start time or adjust volume. Bars show the file's duration and clip at the sequence end; overlapping effects appear on separate subrows. Files are copied or generated in app storage.
5. Tap **Preview lights + audio** to try the current draft without saving it. The app reads the affected lamps' current settings from the bridge first, runs the sequence, then restores their power, brightness and active color mode when playback ends. **Stop preview & restore lamps** also stops the audio and restores the lamps after any in-flight bridge commands settle. If a lamp cannot be restored, the app reports an error. Preview requires the selected group and a connected Hue Bridge; leaving the editor also stops the preview. **Preview always restores the lamps**, regardless of the sequence setting below.
6. Use **Restore after Home playback** if Home should also restore the affected lamps when the sequence finishes or you tap Stop. This switch defaults to off, including for older saved sequences. Tap **Save** to persist it. Home playback otherwise keeps the final lamp state. Ambiance modes always keep their final state when stopped. If ambiance is active on an affected lamp, it resumes after restoration. If a restore fails, the app reports an error.

Custom timelines are stored on this device (not on the Hue Bridge) and are removed by **Forget bridge**. Timeline playback uses the local Hue REST API, so dense or simultaneous actions may be delayed by bridge response time; timing is not sample-accurate. If a timeline lamp is unavailable, playback is disabled until it returns or you edit the sequence. Color and white presets change to a fixed color/temperature at that point; continuously flickering **Candlelight** is available only in Ambiance. On/off smart switches only receive power actions.

If the knock is silent in its direct preview, check the phone's media volume, output device, and any preview error shown in the app. If preview works but a sequence is silent, check that you saved the edited sequence and selected it on Home. If only an imported clip is silent, preview that clip separately or replace the file.

## Set a light color manually

Each light is classified from the Bridge response as **Color lamp**, **Tunable white lamp**, or **Dimmable lamp**. Select a light in **Lights** to see its supported controls:

- **Color lamps** show a **Color & brightness** button. It opens a separate screen with a touch color wheel (tap or drag around the edge for hue and toward the center for saturation), a 0–100% brightness slider, eight default colors, and six white-temperature presets on supported lamps. Tap **Apply color** to send the wheel selection to the Bridge. Wheel gestures lock scrolling while selecting a color. Open **Precise color controls** for labeled hue and saturation sliders.
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
- Candlelight uses local REST commands, not Hue Entertainment streaming. A single instance sends at most one step every 600 ms **per lamp**; large groups and overlapping modes require more requests. Actual update speed depends on network and bridge latency. Streaming would require a configured Hue entertainment area, a streaming client key, native DTLS/UDP support, and a custom Expo development or release build. An APK can include that native implementation, but simply building this existing app as an APK does not enable streaming.
- Android Ambiance uses a native foreground service in custom builds. Home/editor playback, iOS and web remain foreground-only. Android battery optimization exemption and notification access are required; manufacturer-specific restrictions can still interrupt playback.

### Android validation

JavaScript/controller regression checks use `npm run typecheck` and `npm test`. Native scheduler, playback-rule and mock-bridge tests live alongside the local module and can be run after generating the Android project:

```powershell
.\android\gradlew.bat -p .\android :spooky-ambiance:testDebugUnitTest
```

Before relying on background playback, validate a custom build on a physical Android phone:

- Run Candlelight and Halloween storm together; test a color lamp, a dimmable lamp and an on/off switch.
- Set custom brightness limits, RGB colors, and independent white-only tones, including separate storm lightning/glow settings. Confirm old saved modes keep their white tone until configured, white-only choices never recolor RGB or fixed-white lamps, dark gaps send no temperature, Candlelight keeps plugs on, and storm plugs switch off in every gap (including when lightning brightness is set to 1%).
- Save without starting; start, stop and restart the card; edit after stopping; delete after confirmation; relaunch and verify saved cards remain stopped unless the Android background service is still running. Home must list only custom timelines.
- Run a saved timeline with background audio and overlapping effects, and an audio-only timeline. Confirm multiple loops and expected clip volumes while another app is open and during at least 30 minutes locked, unplugged and stationary.
- With ambiance still running, use Home and editor previews on some of its lamps. Confirm in-flight ambiance requests finish before foreground control, other lamps and audio continue, and the latest ambiance state resumes after playback/restoration.
- Stop individual modes and use notification **Stop all** while locked. Confirm no later light commands or audio, and the running notification disappears after the last mode stops.
- Return to the app and confirm mode state is current; verify that a running timeline cannot be saved over or deleted.
- Disconnect Wi-Fi, remove an audio file in a test build, and disconnect headphones. Check actionable errors and cleanup rather than a false running state.
- Deny notifications or battery exemption and confirm starting fails with instructions. Test device idle/Doze and any manufacturer-specific battery restrictions; an emulator or a brief screen-off check is not sufficient.

Use mocked devices for automated tests. Only perform tests against real lights when explicitly authorized.
