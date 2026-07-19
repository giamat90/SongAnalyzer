import { useRef, useState, type RefCallback } from "react";
import { usePlayerStore, getEngine, TAKE_TRACK_KEY } from "../../stores/player";
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

// Drag handle for manually nudging the take's sync position; commits a
// 0.1s-rounded offset on release. Uses pointer capture (not plain mouse
// events) since this is a small element and the drag needs to keep tracking
// even once the cursor leaves it.
// Unclamped in both directions — dragging left of song time 0 is allowed
// (the leading part of the take before song time 0 just isn't reachable
// during playback; the recorded file itself is never trimmed or modified).
function TakeSyncControls({ take }: { take: Take }) {
  const minPxPerSec = usePlayerStore((s) => s.minPxPerSec);
  const setTakeManualOffset = usePlayerStore((s) => s.setTakeManualOffset);
  const dragRef = useRef<{ startX: number; startOffset: number; dragging: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startOffset: take.manualOffset ?? 0, dragging: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const deltaPx = e.clientX - d.startX;
    if (!d.dragging) {
      if (Math.abs(deltaPx) < 3) return;
      d.dragging = true;
      setDragging(true);
    }
    const newOffset = d.startOffset + deltaPx / minPxPerSec;
    getEngine().setTakeManualOffset(newOffset);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d || !d.dragging) return;
    const deltaPx = e.clientX - d.startX;
    const newOffset = d.startOffset + deltaPx / minPxPerSec;
    setTakeManualOffset(take.id, newOffset);
  };

  return (
    <div className="waveform__take-sync">
      <button
        type="button"
        className={`waveform__take-drag${dragging ? " waveform__take-drag--active" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag to nudge take into sync with the other tracks"
      >
        ⠿
      </button>
      <button
        type="button"
        className="waveform__take-reset"
        disabled={!take.manualOffset}
        onClick={() => setTakeManualOffset(take.id, 0)}
        title="Reset to auto-detected position"
      >
        ↺
      </button>
    </div>
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
          <TakeSyncControls take={take} />
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
