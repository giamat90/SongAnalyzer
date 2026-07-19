import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChordSegment, ProcessingStatus, Song, StemName, Take } from "./types";

/** Process a song file through the Python sidecar */
export async function processSong(filePath: string, stemsToExtract?: StemName[], highQuality?: boolean): Promise<Song> {
  return invoke<Song>("process_song", { filePath, stemsToExtract, highQuality });
}

/** List all songs in the library */
export async function listSongs(): Promise<Song[]> {
  return invoke<Song[]>("list_songs");
}

/** Delete a song from the library */
export async function deleteSong(songId: string): Promise<void> {
  return invoke("delete_song", { songId });
}

/** Import a YouTube URL through yt-dlp + Demucs pipeline */
export async function importYoutube(url: string, stemsToExtract?: StemName[], highQuality?: boolean): Promise<Song> {
  return invoke<Song>("import_youtube", { url, stemsToExtract, highQuality });
}

/** Read detected chord segments for a processed song */
export async function readSongChords(songId: string): Promise<ChordSegment[]> {
  return invoke<ChordSegment[]>("read_song_chords", { songId });
}

/** Open a native Save As dialog and copy a stem WAV to user-chosen location */
export async function exportStem(
  stemPath: string,
  suggestedName: string,
): Promise<void> {
  return invoke("export_stem", { stemPath, suggestedName });
}

export interface ZipExportEntry {
  path: string;
  archiveName: string;
}

/** Open a native Save As dialog and bundle stems + takes into a zip archive */
export async function exportAll(entries: ZipExportEntry[], suggestedName: string): Promise<void> {
  return invoke("export_all", { entries, suggestedName });
}

/** Save a recorded take */
export async function saveTake(
  songId: string,
  audioData: number[],
  startPosition: number,
  audioOffset = 0,
): Promise<Take> {
  return invoke<Take>("save_take", { songId, audioData, startPosition, audioOffset });
}

/** List takes recorded for a song */
export async function listTakes(songId: string): Promise<Take[]> {
  return invoke<Take[]>("list_takes", { songId });
}

/** Delete a take */
export async function deleteTakeApi(songId: string, takeId: string): Promise<void> {
  return invoke("delete_take", { songId, takeId });
}

/** Rename a take (empty/whitespace name clears it back to the default "Take N" label) */
export async function renameTakeApi(songId: string, takeId: string, name: string): Promise<Take> {
  return invoke<Take>("rename_take", { songId, takeId, name });
}

/** Persist the metronome's downbeat anchor (song time, seconds) for this song; null clears it back to song start */
export async function setMetronomeOffsetApi(songId: string, offset: number | null): Promise<Song> {
  return invoke<Song>("set_metronome_offset", { songId, offset });
}

/** Persist a manual drag nudge (seconds, signed) on top of a take's auto-detected startPosition; 0 clears it back to that position */
export async function setTakeManualOffsetApi(songId: string, takeId: string, offset: number): Promise<Take> {
  return invoke<Take>("set_take_manual_offset", { songId, takeId, offset });
}

/** Open a native Save As dialog and export a take as WAV */
export async function exportTake(takePath: string, suggestedName: string): Promise<void> {
  return invoke("export_take", { takePath, suggestedName });
}

export interface MixSource {
  path: string;
  gain: number;
  isTake: boolean;
  startPosition?: number;
  audioOffset?: number;
  manualOffset?: number;
}

/**
 * Render a mixdown WAV from `sources` (each already resolved to a final
 * linear gain by the caller) trimmed to [startSec, endSec) of the project
 * timeline, then open a native Save As dialog for the result.
 */
export async function exportMix(
  sources: MixSource[],
  startSec: number,
  endSec: number,
  suggestedName: string,
): Promise<void> {
  return invoke("export_mix", { sources, startSec, endSec, suggestedName });
}

/** Listen for processing progress events */
export function onProcessingProgress(
  callback: (status: ProcessingStatus) => void
): Promise<UnlistenFn> {
  return listen<ProcessingStatus>("processing-progress", (event) => {
    callback(event.payload);
  });
}
