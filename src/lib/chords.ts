import { useEffect, useState } from "react";
import { usePlayerStore } from "../stores/player";
import { readSongChords } from "./tauri";
import type { ChordSegment, Song } from "./types";

export function findActiveChordIndex(segments: ChordSegment[], time: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid];
    if (time < seg.start) hi = mid - 1;
    else if (time >= seg.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Chord name like "C:maj" / "A:min" -> "C" / "Am" */
export function formatChordName(chord: string): string {
  const [root, quality] = chord.split(":");
  return quality === "min" ? `${root}m` : root;
}

/** Loads a song's detected chord segments once and tracks which one is currently playing. */
export function useChordSegments(song: Song) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const [segments, setSegments] = useState<ChordSegment[]>([]);

  useEffect(() => {
    setSegments([]);
    if (!song.hasChords) return;
    let cancelled = false;
    readSongChords(song.id)
      .then((result) => { if (!cancelled) setSegments(result); })
      .catch((e: unknown) => console.error("[useChordSegments] readSongChords failed:", e));
    return () => { cancelled = true; };
  }, [song.id, song.hasChords]);

  const activeIndex = findActiveChordIndex(segments, currentTime);
  return { segments, activeIndex, activeChord: activeIndex >= 0 ? segments[activeIndex] : null };
}
