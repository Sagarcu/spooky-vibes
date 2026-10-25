# Project Guidelines

## Scope and purpose

- These instructions apply to this repository, not to other projects.
- Spooky Vibes is an app for managing Philips Hue lights with user-created sequences. See [README.md](README.md) for the project overview.
- The repository contains an Expo/React Native app written in TypeScript, managed with npm, plus a local Kotlin Expo module for Android background ambiance. It uses the Hue v1 local API, device-local storage, and Node's test runner through `tsx`; there is no cloud backend.
- Use `npm run start` for development, `npm run typecheck` for TypeScript checks, and `npm test` for automated tests. Business logic and device access live under `src/services/`, persistence under `src/storage/`, and tests under `tests/`.
- Android background playback lives under `modules/spooky-ambiance/android/` and requires a custom build (`npx expo run:android --device`), notification access and battery-optimization exemption. Expo Go does not include this service. Keep native changes in the local module, not the generated, ignored `android/` project.

## Working approach

- Implement only what the user explicitly requests. Exploration, questions, brainstorming, and spec creation are not authorization to implement; ask for approval before moving from discussion or planning to implementation.
- Approval of a design or spec alone is not authorization to start coding. Wait for an explicit implementation request, and ask before expanding the agreed scope.
- Read the relevant code and documentation before making changes. Follow established patterns as the project develops.
- Ask before making foundational technology choices or resolving requirements that materially affect behavior or scope.
- Make the smallest complete change that satisfies the request. Avoid unrelated fixes, refactoring, scaffolding, and configuration changes; preserve existing user changes.
- Prefer straightforward implementations and existing dependencies over speculative abstractions or new packages.
- Update directly related documentation when setup, commands, or behavior changes.
- Keep communication brief and direct. Summarize outcomes and blockers; provide detailed explanations only when asked.

## Code structure and reuse

- Search for existing shared components, utilities, and patterns before adding new ones. Reuse them instead of duplicating behavior or UI.
- Extract shared code when it serves actual reuse, not hypothetical future needs. Avoid one-off abstractions and unnecessary layers.
- Keep functions and components focused, with clear names and readable control flow. Split large, mixed-responsibility modules into cohesive pieces rather than creating long, unstructured files.
- Prefer descriptive names and explicit control flow over clever one-liners. Comment non-obvious reasons, not what the code already says.
- Keep business logic separate from UI rendering and device/network access so it is understandable and testable without real lights.

## UI design

- The UI uses React Native Paper with the approved Midnight Studio Material 3 theme in `src/theme.ts`. Reuse Paper components and shared helpers in `src/components/ui.tsx`. The approved visual reference is `docs/material-redesign.html`; its alternate palettes are exploration only. Do not redesign the existing UI unless explicitly requested; ask before choosing another UI library.
- As part of the approved UI redesign, establish a shared theme with a user-approved color palette and reusable color, typography, and spacing tokens. All redesigned screens and components must use that theme rather than hard-coded alternatives; ask before changing the palette.
- Prioritize phone-first design and accessibility: generous touch targets, readable text that supports scaling, sufficient contrast, screen-reader labels, and layouts that work on narrow screens. Preserve keyboard access and visible focus for keyboard users.
- During spec creation for UI changes, show visual mockups of the affected screens before requesting approval. Include relevant interaction states and responsive layouts; a prose description alone is not a mockup.
- Keep mockups scoped to the proposed change and present them for feedback. Creating a mockup does not authorize building the application or installing dependencies.
- Record the approved mockups or links to them in the change's design artifact, and use them as the reference during implementation. For changes without a UI impact, explicitly note that mockups are not applicable.

## Philips Hue integration

- Keep bridge credentials and application keys out of source control, logs, and example data. Use placeholders in documentation.
- Make connection, authentication, and device-operation failures visible and actionable; do not report success when an operation fails.
- Use mocks or simulated devices for automated tests. Do not connect to or control real lights unless explicitly requested.

## Validation

- Use `npm run typecheck` and `npm test` as appropriate for the change. No dedicated lint or production build script is currently defined; do not invent commands or claim checks passed without running them.
- Write or update unit tests for new or changed business logic, covering meaningful rules, edge cases, and failure paths. Mock device/network boundaries.
- Do not add unit tests for every tiny change, trivial wiring, presentational components, or styling-only edits. For UI changes, use relevant existing checks and visual verification against the approved mockups instead.
- Run the smallest relevant checks and report what was run, the results, and any validation limitations.
- After generating the Android project, run native tests with `.\android\gradlew.bat -p .\android :spooky-ambiance:testDebugUnitTest`. Native changes also need an Android build and authorized physical-device validation of locked-phone/Doze behavior; TypeScript tests alone do not verify background playback.
- Keep this file current when the stack, development commands, or project conventions are established.
