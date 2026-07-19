# Frontend Components

**Directory:** `src/components/`

## Component Tree

```
App
├── LibraryPage
│   ├── DropZone           — drag-and-drop audio file import
│   ├── YouTubeImport      — paste-and-import YouTube URL
│   ├── SongCard           — song list item with stem count + delete
│   └── About modal        — version/info dialog
├── AnalyzerPage
│   ├── topbar (fixed)
│   │   ├── TransportControls  — play/pause/stop + current time display
│   │   ├── TempoControl       — BPM-first speed control
│   │   ├── MicSelector        — microphone input picker
│   │   ├── OutputSelector     — audio output device picker (ported from VPS)
│   │   └── RecordButton       — start/stop recording
│   ├── StemView            — orchestrates TimeRuler + all StemTracks + TakeTrack; loads AudioEngine
│   │   ├── TimeRuler       — canvas time ruler with drag-to-select punch/loop region
│   │   ├── StemTrack (×N)  — one row per stem: waveform + mute/solo + volume + download button
│   │   ├── TakeTrack       — recorded take row, aligned at its startPosition
│   │   └── ExportMixButton — render the audible mix (mute/solo/volume/punch) to WAV
│   └── TakeList            — take list with select/rename/delete
│       └── RecordingOffsetControl — per-device latency calibration wizard
└── UpdateDialog            — auto-update modal (tauri-plugin-updater)
```

## State Management

### Library Store (`src/stores/library.ts`)

Manages the song list, import/upload flow, and error state.

| Field | Type | Description |
|-------|------|-------------|
| `songs` | `Song[]` | All songs in the library |
| `processing` | `ProcessingStatus \| null` | Active processing job (null when idle) |
| `isLoading` | `boolean` | Initial fetch in progress |
| `error` | `string \| null` | Last friendly error message |

Actions: `fetchSongs`, `uploadSong`, `importYoutube`, `deleteSong`, `clearError`, `initProgressListener`.

Errors from `importYoutube` and `uploadSong` are parsed by `friendlyError()` into human-readable messages.

### Player Store (`src/stores/player.ts`)

All player state lives in a single Zustand store.

```ts
import { usePlayerStore } from "../../stores/player";

const isPlaying = usePlayerStore((s) => s.isPlaying);
const togglePlay = usePlayerStore((s) => s.togglePlay);
```

| Field | Type | Description |
|-------|------|-------------|
| `song` | `Song \| null` | Currently loaded song |
| `isPlaying` | `boolean` | Playback state |
| `currentTime` | `number` | Playback position (seconds) |
| `duration` | `number` | Song length (seconds) |
| `playbackRate` | `number` | Speed multiplier (0.5–2.0) |
| `stemVolumes` | `Record<string, number>` | Per-stem volume 0–1 (all default 1.0) |
| `mutedStems` | `Record<string, boolean>` | Per-stem mute toggles |
| `soloedStem` | `string \| null` | Currently soloed stem (mutes all others) |
| `punchIn` | `number \| null` | Loop region start (seconds) |
| `punchOut` | `number \| null` | Loop region end (seconds) |
| `punchLoop` | `boolean` | Loop the region during playback |
| `audioDevices` / `selectedDeviceId` | | Microphone enumeration + selection |
| `outputDevices` / `selectedOutputDeviceId` | | Output device enumeration + selection |
| `isRecording` / `isSavingTake` | `boolean` | Recording lifecycle flags |
| `takes` / `activeTakeId` / `takeVolume` | | Recorded takes + active selection |
| `recordingOffsets` | `Record<string, CalibrationEntry>` | Per-device latency calibration `{ offset, stale?, madMs? }`, localStorage-backed |
| `usedLatencyFallback` | `boolean` | True when recording started without a usable calibration |
| `minPxPerSec` | `number` | Timeline zoom level (WaveSurfer's own px-per-second unit); ctrl+wheel changes this |
| `scrollTime` | `number` | Song time (seconds) at the left edge of the visible timeline window; shift+wheel changes this |
| `metronomeOffset` | `number` | Song time (seconds) where the metronome's beat 1 lands; persisted per song via `set_metronome_offset` |

See [Recording Flow](recording-flow.md) for the recording state machine and latency compensation.

## GUI Rule

**All dimensions must use relative units** — `%`, `rem`, `vw`, `vh`, `fr`. Never use fixed pixel values (`px`) for layout dimensions.

## Notable Component Details

### StemView

Mounts/destroys the `AudioEngine` whenever `song.id` changes. Iterates `song.stems` and renders one `StemTrack` per stem, plus a `TakeTrack` when a take is selected, and `TimeRuler` at the top. Does **not** render Export Mix or Download All — those live in `AnalyzerPage.tsx`'s header (see below), not here.

#### Timeline Zoom/Pan

`TimeRuler`, the stem rows, and the take row are wrapped in a new `.stem-view__timeline` element (`ref`'d as `timelineRef`), which owns two `useEffect`-mounted listeners:

- A **non-passive `wheel` listener** (`addEventListener("wheel", handler, { passive: false })` — React's `onWheel` prop is passive since React 17 and can't `preventDefault()` native ctrl+wheel page-zoom). Ctrl+wheel calls `computeZoomToCursor()` (`src/lib/zoomPan.ts`) with the cursor's pixel offset within the wrapper, then `eng.zoomAll(newPx, newScroll)`; shift+wheel calls `computePan()` then `eng.setScrollAll(newScroll)`. Both cases call `eng.noteManualScrollInteraction()` first, suppressing the engine's playhead auto-follow (see [Audio Engine: Timeline Zoom/Pan](audio-engine.md#timeline-zoompan)) for 800ms. Wheel events without `ctrlKey`/`shiftKey` are ignored (not `preventDefault()`-ed), so ordinary page scroll/zoom over the timeline behaves normally.
- A **`ResizeObserver`** that reclamps `scrollTime` into bounds and snaps `minPxPerSec` up to the new dynamic "whole song fits" floor if the container shrank, since both depend on live container width.

`src/lib/zoomPan.ts` holds the pure math (byte-identical to VPS's copy): `computeZoomToCursor()` keeps the exact song-time under the mouse cursor fixed on screen while `minPxPerSec` changes by an exponential factor of wheel delta (`Math.exp(-deltaY * ZOOM_SENSITIVITY)` — proportional zoom feels consistent regardless of current zoom level, unlike a fixed additive step); `computePan()` shifts `scrollTime` by `deltaPx / minPxPerSec`. Both clamp `scrollTime` into `[0, max(0, duration - viewportWidthPx/minPxPerSec)]` and `minPxPerSec` into `[dynamicLowerBound, MAX_PX_PER_SEC]` — the lower bound comes from `eng.getMinPxPerSec()` (the "whole song fills the container" floor), so zooming out can never scroll past the song's edges.

### ExportMixButton / DownloadAllButton

Both render in `AnalyzerPage.tsx`'s `.analyzer-page__header`, next to the song title — whole-song actions, not stem-view-specific, so they don't belong inside `StemView.tsx`. `ExportMixButton` was extracted out of `StemView.tsx` into its own file (2026-07-08) to sit alongside `DownloadAllButton` in the header, matching the equivalent move made in VPS (`ExportMixButton` out of `Waveform.tsx` into `PracticeRoom.tsx`'s header).

- **Export Mix**: `buildMixSources(state)` resolves one final linear gain per audible track from mute/solo/volume (plus the take with its `startPosition`/`audioOffset` alignment) and clamps the render window to the punch region; the `export_mix` Tauri command renders it via the sidecar `mix_export` and opens a native Save-As dialog. Native `title` tooltip: "Export the currently audible mix as a WAV file" (or "No audible tracks to export" when disabled).
- **Download All**: bundles every stem WAV plus every take's normalized WAV into one zip via the `export_all` Tauri command and a single Save-As dialog. Native `title` tooltip: "Download all stems and takes as a zip archive".

### StemTrack

Single stem row. Contains:
- A WaveSurfer waveform container (wired to the engine via `engine.loadStem()`)
- Mute (`M`) and solo (`S`) buttons wired to `toggleMute` / `toggleSolo` in the player store
- A volume slider that calls `engine.setStemVolume(name, value)`
- A download button that calls `exportStem(songId, stemName)` via a native Save-As dialog

Its `.stem-track__body` wrapper (`position: relative`, `overflow: hidden`) clips `PunchOverlay` — now positioned in pixels (`left`/`width` derived from `minPxPerSec`/`scrollTime`, not a percentage of the row's raw width — see [Timeline Zoom/Pan](#timeline-zoompan) above) — when the punch region extends off-screen under zoom/pan. `.stem-track__body` already had `overflow: hidden` before zoom/pan existed, so no CSS change was needed here (unlike VPS, where the equivalent `.waveform__track-body` rule had to gain it).

### TakeTrack

Extra row rendered when `activeTakeId` is set. Loads the take into the engine via `loadTakeTrack(path, container, startOffset, audioOffset, manualOffset)` so it plays aligned at its `startPosition` (+ `manualOffset`); visually positioned/sized in pixels derived from the current zoom/scroll (`_resizeTakeTrack()` in the engine — see [Audio Engine: Take Track](audio-engine.md#take-track)), not a fixed ratio. Its own `PunchOverlay` copy gets the same pixel-positioning treatment as `StemTrack`'s.

#### Take Sync Controls

`TakeSyncControls` (local sub-component, rendered in `TakeTrack`'s `.stem-track__controls` row) lets the user drag the take into sync with the other tracks after recording, then reset it back to the auto-detected position.

- **Grip handle** (`⠿`) — a small button, not the waveform body itself, so dragging never conflicts with WaveSurfer's own `"interaction"` click-to-seek on the take waveform. Uses **Pointer Events** (`onPointerDown` + `e.currentTarget.setPointerCapture(e.pointerId)`, then `onPointerMove`/`onPointerUp`) rather than `TimeRuler.tsx`'s plain mouse events — the grip is a small element, so tracking needs to survive the pointer leaving its bounds mid-drag, which pointer capture guarantees and plain React mouse handlers on a small target do not.
- A `< 3px` movement threshold distinguishes an intentional drag from a click before calling `getEngine().setTakeManualOffset(newOffset)` live on every `pointermove` (see [Audio Engine: Manual Take Sync](audio-engine.md#manual-take-sync)) — no store write during drag.
- The offset is **unclamped in both directions** — dragging left of song time 0 is allowed (the take's leading edge before song time 0 simply becomes unreachable during playback via the existing `Math.max(0, …)` guard in `_seekTake`; the recorded file itself is never trimmed or otherwise modified). On `pointerup` the offset is committed via the player store's `setTakeManualOffset(takeId, offset)` action, which rounds to `0.1s` (matching the metronome/punch precision) and persists via `set_take_manual_offset`.
- **Reset button** (`↺`) — always mounted, `disabled` (not unmounted) when `take.manualOffset` is falsy, matching how other transport buttons in this codebase indicate unavailability. Calls the same store action with `offset = 0`.

### Recording components (`src/components/recording/`)

- **RecordButton** — starts/stops recording via the player store; disabled until a song is loaded.
- **MicSelector** — input device picker; devices get real labels only after the first `getUserMedia` grant.
- **TakeList** — recorded takes with select/rename/delete; selecting a take mounts `TakeTrack`.
- **RecordingOffsetControl** — click-clap latency calibration wizard writing `recordingOffsets` entries with MAD-based confidence; see [Recording Flow](recording-flow.md#latency-compensation).

### OutputSelector

Audio output device picker (ported from VPS). `fetchOutputDevices` / `setOutputDevice` in the player store; the engine re-routes every WaveSurfer instance (and newly created ones) via `setSinkId`.

### UpdateDialog (`src/components/updater/`)

Auto-update modal backed by `src/stores/updater.ts` and `tauri-plugin-updater`: release notes, download progress, install/restart.

### TimeRuler

Canvas strip above all stem tracks. Shows time ticks at adaptive intervals (≥80 px target). Drag to draw/edit the loop region; click to clear. Toggling the loop itself is done from [LoopButton](#loopbutton), not a button on this ruler (moved 2026-07-10 — see that section). See [Loop Region & Playback](recording-flow.md) for full interaction details. Also draws a draggable blue downbeat marker (dashed line + flag at the bottom edge) for the metronome's phase-lock anchor, hit-tested with priority over the loop-region drag modes — see [Metronome: Downbeat offset](#tempocontrol).

All of `tX`/`xToTime` (coordinate mapping), `modeForOffset` (handle hit-testing), and the tick-drawing loop read `minPxPerSec`/`scrollTime` from the player store instead of assuming the whole song spans the full canvas width — tick spacing gets finer as zoom increases (`tickInterval` is computed from the *visible* duration, `canvasWidthPx / minPxPerSec`, not the song's total duration), and only the visible time range is drawn. See [Timeline Zoom/Pan](#timeline-zoompan) above.

### TransportControls

Play/pause/stop buttons + current time display. Stop seeks to 0. Time is read from the player store's `currentTime` (updated at ~30 fps from the rAF loop).

### LoopButton

Standalone component (`src/components/player/LoopButton.tsx`), ported from VPS unchanged apart from field names already matching — reads `punchIn`/`punchOut`/`punchLoop`/`isRecording`/`setPunchLoop` directly from `usePlayerStore`, no props. Always rendered — a circular `⟳` toggle, red-tinted (`.loop-btn--active`) when `punchLoop` is true, `disabled` (dimmed, `opacity: 0.4`) whenever there's no loop region set or while recording, so it stays a stable landmark in the topbar rather than appearing/disappearing. Rendered in `AnalyzerPage.tsx`'s topbar directly after `<TransportControls />`.

Previously `TimeRuler.tsx` rendered its own in-ruler `⟳` with no `isRecording` guard (unlike VPS's, which already hid the button during recording). Moving it here added that guard for parity — cosmetic only, since the `isRecording` branch in `onTimeUpdate`'s punch-out handler already takes priority over `punchLoop` regardless of the button's visibility (recording always auto-stops at punch-out; it never loops).

### TempoControl

BPM-first speed control (ported from VPS): an editable BPM value (derived from `detectedBpm × playbackRate`) alongside an editable ×-rate, clamped to 0.25–2.5× (corrected 2026-07-08; this page previously said 0.5–2.0×, which didn't match the code's `Math.max(0.25, Math.min(2.5, ...))` clamp). Calls `engine.setPlaybackRate(rate)` and persists the value in the player store.

**Metronome (🥁 toggle, header row, ported from VPS):** same design as VPS's — local component state (`metronomeEnabled`, not in the Zustand store), synced to the transport (silent while paused, clicks only while `isPlaying`), effective BPM `(detectedBpm ?? 120) * playbackRate`, accented downbeat every 4th click (assumed 4/4), driven by `src/audio/metronome.ts`'s lookahead-scheduled `Metronome` singleton (byte-identical to VPS's — same 25 ms tick / 100 ms schedule-ahead Web Audio scheduler). The controlling `useEffect` resyncs (not just retunes) on every `metronomeEnabled`/`isPlaying`/effective-BPM/`metronomeOffset` change.

**Downbeat offset (phase-locking):** the metronome used to always start ticking at beat 0 the instant playback started, drifting out of sync with the song's actual downbeat whenever there's silence (or a pickup) before it. `metronomeOffset` (player store, persisted per song via the `metronomeOffset` field on `Song` and the `set_metronome_offset` Tauri command — mirrors `rename_take`) is a song-time anchor the click track phase-locks to instead: `src/lib/metronomeSync.ts`'s `computeMetronomePhase()` (pure, byte-identical with VPS) returns the wall-clock delay until the next aligned click plus which beat-in-bar it is, fed straight into `Metronome.start(bpm, timeUntilNextBeat, startBeat)` — reworked to always reset phase, even if already running (removed the old "already running → just retuned" early-return and the now-unused `setBpm()`). No SPS-specific adaptation was needed for any of this: it only touches `TempoControl.tsx` (byte-identical file) and the player store's existing `isPlaying`/`playbackRate` shape, same as the original metronome port.

The anchor is set two ways, both in `TempoControl`'s new "Downbeat" row (shown only while `metronomeEnabled`) and on `TimeRuler`:
- **Set button** — captures `getEngine().getCurrentTime()` at the moment it's clicked.
- **Drag** — `TimeRuler` draws a draggable marker (dashed blue vertical line + downward flag at the bottom edge) at the anchor's position, hit-tested with priority over the existing punch-region `create`/`drag-in`/`drag-out` modes (a new `"drag-metronome"` `DragMode` and a third `overrideMetronome` parameter on `draw()`, mirroring `overrideIn`/`overrideOut`).

A "↺" reset-to-0 button appears next to Set once the offset is nonzero.

### DropZone

Drag-and-drop target. Accepts audio files and calls `uploadSong(filePath)` on the library store. Disabled while any processing job is active.

### YouTubeImport

Input + button for pasting a YouTube URL. Validates client-side with a regex before calling `importYoutube(url)`. Disabled while any processing job is active. Errors appear as a dismissible red banner in `LibraryPage`.

### SongCard (inline in `LibraryPage`)

Each song in the library list. Shows title, BPM, key, stem count, and a delete button. Clicking the card navigates to `AnalyzerPage` with the song loaded.
