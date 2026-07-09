import { useState, type RefCallback } from "react";
import { usePlayerStore, TAKE_TRACK_KEY } from "../../stores/player";
import { exportTake } from "../../lib/tauri";
import type { Song, Take } from "../../lib/types";

function PunchOverlay() {
  const punchIn     = usePlayerStore((s) => s.punchIn);
  const punchOut    = usePlayerStore((s) => s.punchOut);
  const duration    = usePlayerStore((s) => s.duration);
  const minPxPerSec = usePlayerStore((s) => s.minPxPerSec);
  const scrollTime  = usePlayerStore((s) => s.scrollTime);
  if (punchIn === null || punchOut === null || duration <= 0) return null;
  return (
    <div
      className="waveform__punch-overlay"
      style={{
        left:  `${(punchIn - scrollTime) * minPxPerSec}px`,
        width: `${(punchOut - punchIn) * minPxPerSec}px`,
      }}
    />
  );
}

interface TakeTrackProps {
  take: Take;
  song: Song;
  containerRef: RefCallback<HTMLDivElement>;
}

function TakeTrack({ take, song, containerRef }: TakeTrackProps) {
  const volume        = usePlayerStore((s) => s.takeVolume);
  const setTakeVolume  = usePlayerStore((s) => s.setTakeVolume);
  const isMuted        = usePlayerStore((s) => !!s.mutedStems[TAKE_TRACK_KEY]);
  const soloedStem     = usePlayerStore((s) => s.soloedStem);
  const isSoloed       = soloedStem === TAKE_TRACK_KEY;
  const toggleMute     = usePlayerStore((s) => s.toggleMute);
  const toggleSolo     = usePlayerStore((s) => s.toggleSolo);
  const [isExporting, setIsExporting] = useState(false);

  const label = take.name || "Take";

  const handleDownload = async () => {
    setIsExporting(true);
    try {
      await exportTake(take.filepath, `${song.title} - ${label}.wav`);
    } catch (e) {
      console.error("[TakeTrack] export failed:", e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="stem-track">
      <div className="stem-track__header">
        <span className="stem-track__label waveform__label--take">🎙 {label}</span>
        <div className="stem-track__controls">
          <button
            className={`stem-track__mute${isMuted ? " stem-track__mute--on" : ""}`}
            onClick={() => toggleMute(TAKE_TRACK_KEY)}
            title={isMuted ? "Unmute" : "Mute"}
          >
            M
          </button>
          <button
            className={`stem-track__solo${isSoloed ? " stem-track__solo--on" : ""}`}
            onClick={() => toggleSolo(TAKE_TRACK_KEY)}
            title={isSoloed ? "Unsolo" : "Solo"}
          >
            S
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setTakeVolume(Number(e.target.value))}
            className="stem-track__volume"
            title="Take volume"
          />
          <button
            className="stem-track__download"
            onClick={handleDownload}
            disabled={isExporting}
            title={`Download ${label}`}
          >
            {isExporting ? "…" : "↓"}
          </button>
        </div>
      </div>
      <div className="stem-track__body waveform__take-rail">
        <div ref={containerRef} />
        <PunchOverlay />
      </div>
    </div>
  );
}

export default TakeTrack;
