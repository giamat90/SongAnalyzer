import type { RefCallback } from "react";
import { usePlayerStore, TAKE_TRACK_KEY } from "../../stores/player";
import type { Take } from "../../lib/types";

function PunchOverlay() {
  const punchIn  = usePlayerStore((s) => s.punchIn);
  const punchOut = usePlayerStore((s) => s.punchOut);
  const duration = usePlayerStore((s) => s.duration);
  if (punchIn === null || punchOut === null || duration <= 0) return null;
  return (
    <div
      className="waveform__punch-overlay"
      style={{
        left:  `${(punchIn  / duration) * 100}%`,
        width: `${((punchOut - punchIn) / duration) * 100}%`,
      }}
    />
  );
}

interface TakeTrackProps {
  take: Take;
  containerRef: RefCallback<HTMLDivElement>;
}

function TakeTrack({ take, containerRef }: TakeTrackProps) {
  const volume        = usePlayerStore((s) => s.takeVolume);
  const setTakeVolume  = usePlayerStore((s) => s.setTakeVolume);
  const isMuted        = usePlayerStore((s) => !!s.mutedStems[TAKE_TRACK_KEY]);
  const soloedStem     = usePlayerStore((s) => s.soloedStem);
  const isSoloed       = soloedStem === TAKE_TRACK_KEY;
  const toggleMute     = usePlayerStore((s) => s.toggleMute);
  const toggleSolo     = usePlayerStore((s) => s.toggleSolo);

  return (
    <div className="stem-track">
      <div className="stem-track__header">
        <span className="stem-track__label waveform__label--take">🎙 {take.name || "Take"}</span>
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
