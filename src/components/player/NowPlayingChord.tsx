import { useChordSegments, formatChordName } from "../../lib/chords";
import type { Song } from "../../lib/types";

interface NowPlayingChordProps {
  song: Song;
}

export default function NowPlayingChord({ song }: NowPlayingChordProps) {
  const { activeChord } = useChordSegments(song);
  if (!song.hasChords || !activeChord) return null;

  return (
    <div className="now-playing-chord">
      <span className="now-playing-chord__label">Chord</span>
      <span className="now-playing-chord__value">{formatChordName(activeChord.chord)}</span>
    </div>
  );
}
