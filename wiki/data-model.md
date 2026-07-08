# Data Model

**Key files:** `src/lib/types.ts` · `src-tauri/src/commands.rs` · `src-tauri/src/library.rs` · `src-tauri/src/storage.rs`

## TypeScript Interfaces

### Song

```ts
interface Song {
  id: string;           // UUID
  title: string;
  duration: number;     // seconds
  detectedBpm?: number;
  detectedKey?: string; // e.g. "C minor"
  processedAt: string;  // ISO timestamp
  directory: string;    // absolute path to ~/.songpracticestudio/library/{id}/
  stems: StemName[];    // e.g. ["vocals","drums","bass","guitar","piano","other"]
}
```

### Take

```ts
interface Take {
  id: string;
  songId: string;
  recordedAt: string;     // ISO timestamp
  filepath: string;       // RMS-normalized .wav (raw .webm only if normalization failed)
  name?: string;          // user-assigned; UI falls back to "Take N"
  startPosition: number;  // song time (seconds) where recording began; 0 for full-song takes
  audioOffset?: number;   // seconds into the file to skip on playback (latency compensation overflow)
}
```

Unlike VPS's `Take`, there are no analysis fields (`pitchData`, `vibrato`, …) — SPS does no take analysis.

### StemName

```ts
type StemName = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";
```

All six stems are produced by `htdemucs_6s`. The `stems` array on `Song` lists only the stems that were successfully written to disk.

### ProcessingStatus (event payload)

```ts
interface ProcessingStatus {
  songId: string;
  progress: number;  // 0–1
  stage: string;     // e.g. "separating", "detecting bpm", "detecting key"
  isComplete: boolean;
  error?: string;
}
```

## Storage Layout

All data lives under `~/.songpracticestudio/` (`C:\Users\{user}\.songpracticestudio\` on Windows).

```
~/.songpracticestudio/
├── library.json           master index of all Song records
└── library/
    └── {songId}/          UUID directory per song
        ├── {original}.mp3 copy of the source file (or source.wav for YouTube imports)
        ├── vocals.wav     separated vocals stem
        ├── drums.wav      separated drums stem
        ├── bass.wav       separated bass stem
        ├── guitar.wav     separated guitar stem
        ├── piano.wav      separated piano stem
        ├── other.wav      separated other/residual stem
        ├── takes.json     Take[] metadata
        └── takes/
            └── {takeId}.wav  RMS-normalized take audio (raw .webm kept only when normalization failed)
```

## Tauri Commands

| Command | Arguments | Returns |
|---------|-----------|---------|
| `process_song` | `filePath: string, stemsToExtract?: StemName[], highQuality?: boolean` | `Song` |
| `import_youtube` | `url: string, stemsToExtract?: StemName[], highQuality?: boolean` | `Song` |
| `list_songs` | — | `Song[]` |
| `delete_song` | `songId: string` | `void` |
| `save_take` | `songId, audioData: number[], startPosition: f64, audioOffset: f64` | `Take` (RMS-normalizes via sidecar `normalize_take`) |
| `list_takes` | `songId: string` | `Take[]` |
| `delete_take` | `songId, takeId: string` | `void` |
| `rename_take` | `songId, takeId, name: string` | `Take` (empty/whitespace name resets to default) |
| `export_stem` | `stemPath, suggestedName: string` | `void` (native Save-As dialog) |
| `export_take` | `takePath, suggestedName: string` | `void` (always WAV; sidecar `convert_take` first) |
| `export_mix` | `sources: MixSource[], startSec, endSec: f64, suggestedName: string` | `void` (sidecar `mix_export`, then Save-As) |
| `export_all` | `entries: ZipEntry[] ({path, archiveName}), suggestedName: string` | `void` (native Save-As dialog for `.zip`; `zip` crate writes each entry, no sidecar involved) |

All commands are async and return a `Promise`. Errors are thrown as strings.

## Tauri Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `"processing-progress"` | Rust → frontend | `ProcessingStatus` |
