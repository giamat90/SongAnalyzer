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

See [Recording Flow](recording-flow.md) for the recording state machine and latency compensation.

## GUI Rule

**All dimensions must use relative units** — `%`, `rem`, `vw`, `vh`, `fr`. Never use fixed pixel values (`px`) for layout dimensions.

## Notable Component Details

### StemView

Mounts/destroys the `AudioEngine` whenever `song.id` changes. Iterates `song.stems` and renders one `StemTrack` per stem, plus a `TakeTrack` when a take is selected, and `TimeRuler` at the top. Does **not** render Export Mix or Download All — those live in `AnalyzerPage.tsx`'s header (see below), not here.

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

### TakeTrack

Extra row rendered when `activeTakeId` is set. Loads the take into the engine via `loadTakeTrack(path, container, startOffset, audioOffset)` so it plays aligned at its `startPosition`; visually positioned/sized proportionally to the song timeline.

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

Canvas strip above all stem tracks. Shows time ticks at adaptive intervals (≥80 px target). Drag to draw/edit the loop region; click to clear. The ⟳ button toggles `punchLoop`. See [Loop Region & Playback](recording-flow.md) for full interaction details.

### TransportControls

Play/pause/stop buttons + current time display. Stop seeks to 0. Time is read from the player store's `currentTime` (updated at ~30 fps from the rAF loop).

### TempoControl

BPM-first speed control (ported from VPS): an editable BPM value (derived from `detectedBpm × playbackRate`) alongside an editable ×-rate, clamped to 0.25–2.5× (corrected 2026-07-08; this page previously said 0.5–2.0×, which didn't match the code's `Math.max(0.25, Math.min(2.5, ...))` clamp). Calls `engine.setPlaybackRate(rate)` and persists the value in the player store.

**Metronome (🥁 toggle, header row, ported from VPS):** same design as VPS's — local component state, synced to the transport (silent while paused, clicks only while `isPlaying`), effective BPM `(detectedBpm ?? 120) * playbackRate`, accented downbeat every 4th click (assumed 4/4), driven by `src/audio/metronome.ts`'s lookahead-scheduled `Metronome` singleton (byte-identical to VPS's — same 25 ms tick / 100 ms schedule-ahead Web Audio scheduler). No SPS-specific adaptation was needed: the feature only touches `TempoControl.tsx` and the player store's existing `isPlaying`/`playbackRate` fields, which are the same shape on both sides. Like VPS, not phase-locked to the song's actual downbeats — no beat-grid/offset data exists to lock to.

### DropZone

Drag-and-drop target. Accepts audio files and calls `uploadSong(filePath)` on the library store. Disabled while any processing job is active.

### YouTubeImport

Input + button for pasting a YouTube URL. Validates client-side with a regex before calling `importYoutube(url)`. Disabled while any processing job is active. Errors appear as a dismissible red banner in `LibraryPage`.

### SongCard (inline in `LibraryPage`)

Each song in the library list. Shows title, BPM, key, stem count, and a delete button. Clicking the card navigates to `AnalyzerPage` with the song loaded.
