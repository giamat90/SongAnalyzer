import { useEffect, useState } from "react";
import { usePlayerStore } from "../../stores/player";
import { readSongChords } from "../../lib/tauri";
import type { ChordSegment, Song } from "../../lib/types";

interface ChordRowProps {
  song: Song;
}

function findActiveIndex(segments: ChordSegment[], time: number): number {
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
function formatChord(chord: string): string {
  const [root, quality] = chord.split(":");
  return quality === "min" ? `${root}m` : root;
}

export default function ChordRow({ song }: ChordRowProps) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const [segments, setSegments] = useState<ChordSegment[]>([]);

  useEffect(() => {
    setSegments([]);
    if (!song.hasChords) return;
    let cancelled = false;
    readSongChords(song.id)
      .then((result) => { if (!cancelled) setSegments(result); })
      .catch((e: unknown) => console.error("[ChordRow] readSongChords failed:", e));
    return () => { cancelled = true; };
  }, [song.id, song.hasChords]);

  if (segments.length === 0) return null;

  const activeIndex = findActiveIndex(segments, currentTime);

  return (
    <div className="chord-row">
      {segments.map((seg, i) => (
        <span
          key={`${seg.start}-${seg.chord}`}
          className={`chord-row__chip${i === activeIndex ? " chord-row__chip--active" : ""}`}
        >
          {formatChord(seg.chord)}
        </span>
      ))}
    </div>
  );
}
