import { useEffect, useRef, useState } from "react";
import { usePlayerStore, getEngine, buildMixSources } from "../../stores/player";
import { exportMix } from "../../lib/tauri";
import TimeRuler from "./TimeRuler";
import StemTrack from "./StemTrack";
import TakeTrack from "./TakeTrack";
import type { Song } from "../../lib/types";

interface StemViewProps {
  song: Song;
}

function ExportMixButton() {
  // Subscribe to every input buildMixSources reads, so the button's
  // disabled state stays in sync with mute/solo/volume/take changes.
  usePlayerStore((s) => s.song);
  usePlayerStore((s) => s.stemVolumes);
  usePlayerStore((s) => s.mutedStems);
  usePlayerStore((s) => s.soloedStem);
  usePlayerStore((s) => s.takeVolume);
  usePlayerStore((s) => s.activeTakeId);
  const [isExporting, setIsExporting] = useState(false);

  const mix = buildMixSources(usePlayerStore.getState());

  const handleExport = async () => {
    const state = usePlayerStore.getState();
    const built = buildMixSources(state);
    if (!built || !state.song) return;
    setIsExporting(true);
    try {
      await exportMix(built.sources, built.startSec, built.endSec, `${state.song.title} - Mixdown.wav`);
    } catch (e) {
      console.error("[StemView] exportMix failed:", e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      className="stem-view__export-mix"
      onClick={() => void handleExport()}
      disabled={!mix || isExporting}
      title={mix ? "Export the currently audible mix as a WAV file" : "No audible tracks to export"}
    >
      {isExporting ? "Exporting…" : "Export Mix"}
    </button>
  );
}

function StemView({ song }: StemViewProps) {
  const loadSong      = usePlayerStore((s) => s.loadSong);
  const activeTakeId  = usePlayerStore((s) => s.activeTakeId);
  const takes         = usePlayerStore((s) => s.takes);
  const takeVolume    = usePlayerStore((s) => s.takeVolume);
  const setTakeVolume = usePlayerStore((s) => s.setTakeVolume);
  const stemRefs      = useRef<Record<string, HTMLDivElement | null>>({});
  const takeRef       = useRef<HTMLDivElement | null>(null);
  const isLoading     = useRef(false);
  const loadedTakeId  = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading.current) return;
    isLoading.current = true;
    setLoadError(null);

    const containers: Record<string, HTMLElement> = {};
    for (const name of song.stems) {
      const el = stemRefs.current[name];
      if (el) containers[name] = el;
    }

    loadSong(song, containers)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[StemView] loadSong failed:", msg);
        setLoadError(msg);
      })
      .finally(() => { isLoading.current = false; });

    return () => { isLoading.current = false; };
  }, [song.id]);

  // Load (or clear) the take track whenever the active take changes.
  useEffect(() => {
    const eng = getEngine();
    if (!activeTakeId) {
      eng.clearTakeTrack();
      loadedTakeId.current = null;
      return;
    }
    if (activeTakeId === loadedTakeId.current) return;
    const take = takes.find((t) => t.id === activeTakeId);
    if (!take || !takeRef.current) return;
    loadedTakeId.current = activeTakeId;
    eng.loadTakeTrack(take.filepath, takeRef.current, take.startPosition, take.audioOffset ?? 0)
      .then(() => setTakeVolume(takeVolume))
      .catch((e: unknown) => console.error("[StemView] loadTakeTrack failed:", e));
  }, [activeTakeId, takes]);

  const activeTake = takes.find((t) => t.id === activeTakeId);

  return (
    <div className="stem-view">
      {loadError && <div className="stem-view__error">{loadError}</div>}
      <TimeRuler />
      <div className="stem-view__toolbar">
        <ExportMixButton />
      </div>
      {song.stems.map((name) => (
        <StemTrack
          key={name}
          name={name}
          song={song}
          containerRef={(el) => { stemRefs.current[name] = el; }}
        />
      ))}
      {activeTake && (
        <TakeTrack
          take={activeTake}
          song={song}
          containerRef={(el) => { takeRef.current = el; }}
        />
      )}
    </div>
  );
}

export default StemView;
