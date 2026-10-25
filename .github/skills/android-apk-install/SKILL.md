---
name: android-apk-install
description: 'Build a standalone Spooky Vibes Android APK and install updates on a USB-connected phone. Use when asked to create an APK again, put the latest app on a phone, sideload, or install over USB with adb while preserving saved data.'
---

# Android APK build and USB install

## Scope and safety

- Follow the repository's `AGENTS.md` and the standalone APK section in `README.md`.
- Build only when requested. If the user asks to install an APK just built and verified in this session, reuse it rather than rebuilding.
- When the user requests installation and a phone is connected over USB, install it rather than merely providing the APK path.
- A build-only request does not authorize installation. Do not launch the app or operate real Hue lights without explicit authorization; opening the app could resume device activity.
- Preserve existing source edits and `android\app\debug.keystore`. Never uninstall, clear app data, regenerate the signing key, or use `expo prebuild --clean` to work around installation failures.
- Release APKs currently use the existing development keystore for personal sideloading, not public distribution. Compatible updates require the same application ID and signing certificate.
- Use execution tooling required by the current session. On Windows, use PowerShell syntax and backslash filesystem paths. Check command exit codes and stop on failures.

## Local toolchain

1. Work from the repository root. Inspect the working-tree status without changing user edits.
2. Check the local Android SDK and JDK. On this machine the working locations are:
   - SDK: `$env:LOCALAPPDATA\Android\Sdk`
   - JDK: `C:\Program Files\Android\Android Studio\jbr`
3. Confirm those directories exist before using them. Set `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT` only in the build process environment if needed; do not persist machine-wide changes. The Java executable on `PATH` may not be the intended build JDK.
4. Find `adb.exe` under the SDK's `platform-tools` directory and `apksigner.bat` and `aapt.exe` (or `aapt2.exe`) in an installed SDK `build-tools` version. Do not install dependencies unless an actual missing-dependency failure requires it.

## Build a standalone APK

1. If an earlier APK exists, record its signing-certificate SHA-256 digest using `apksigner verify --verbose --print-certs`. Do not print credentials or key material. Record the build start time.
2. Run `npm run typecheck` and `npm test`. Report failures instead of silently changing application code.
3. Generate/update the ignored native project without cleaning it:

   ```powershell
   npx --no-install expo prebuild --platform android --no-install
   ```

4. After a successful prebuild, build the release APK and run native regression tests:

   ```powershell
   .\android\gradlew.bat -p .\android :app:assembleRelease :spooky-ambiance:testDebugUnitTest -PreactNativeArchitectures=arm64-v8a --console=plain
   ```

   ARM64 is the documented phone target and works for the user's OnePlus 8T. For a different device, verify its ABI before assuming this target.

5. Verify `android\app\build\outputs\apk\release\app-release.apk`:
   - Nonempty and written after the build start time.
   - `apksigner verify` succeeds and its signing certificate matches the earlier APK when available.
   - `aapt dump badging` (or `aapt2 dump badging`) reports package `com.spookyvibes.app` and the expected ABI/version.
   - The APK ZIP contains the nonempty `assets/index.android.bundle`, so Metro is not needed.
   - Native test XML under `modules\spooky-ambiance\android\build\test-results\testDebugUnitTest` reports no failures or errors.
6. Check whether prebuild introduced source/dependency changes; distinguish them from pre-existing user edits. Do not silently revert user work or expand scope to unrelated fixes.
7. For build-only requests, provide the APK link, size, validation results, and the instruction to update without uninstalling. Surface meaningful warnings.

## Install over USB

1. Run the SDK's `adb devices -l`.
   - Select an authorized USB physical device, not an emulator or wireless connection.
   - If multiple eligible devices are present, ask which one to use.
   - If unauthorized, ask the user to unlock the phone and accept the USB-debugging prompt, then retry.
   - If no eligible device or an offline device is found, report the issue and ask the user to check the cable, USB debugging, and connection.
   - Never hard-code the user's device serial in the skill or source.
2. If the APK has not already been verified in the current session, verify its package and signature before installation. Check the selected device's ABI if compatibility is not known.
3. Always target the selected serial explicitly:

   ```powershell
   $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
   & $adb -s $serial install -r '.\android\app\build\outputs\apk\release\app-release.apk'
   ```

   Set `$serial` from the selected device, not a remembered value. Require both exit code zero and literal `Success`. Do not bypass signature mismatches, version downgrade checks, or device security restrictions; surface the exact actionable failure.

4. Verify the installed package with:

   ```powershell
   & $adb -s $serial shell dumpsys package com.spookyvibes.app
   & $adb -s $serial shell pm path com.spookyvibes.app
   ```

   Filter the package output to version code, version name, and last update time; avoid dumping unrelated device information. Confirm that the update time reflects this installation and a package path is returned.
5. Report successful installation, device model, and that the existing app was updated without uninstalling or clearing data. Leave launching the app to the user unless explicitly requested.
