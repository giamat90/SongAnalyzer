import { create } from "zustand";
import { AudioEngine } from "../audio/engine";
import { VocalRecorder } from "../audio/recorder";
import type { Song, StemName, Take } from "../lib/types";
import { saveTake, listTakes, deleteTakeApi, renameTakeApi } from "../lib/tauri";

let engine: AudioEngine | null = null;
let recorder: VocalRecorder | null = null;
// Captured when recording starts so stopRecording can pass it to saveTake
let recordingStartPos = 0;
// Round-trip latency (output + input) measured at rec.start(); applied in stopRecording.
let _recordingLatencyS = 0;

export function getEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}

function getRecorder(): VocalRecorder {
  if (!recorder) recorder = new VocalRecorder();
  return recorder;
}

function _loadOffsets(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem("songpracticestudio_recording_offsets") ?? "{}") as Record<string, number>;
  } catch (e) {
    console.warn("[settings] Could not load recording offsets:", e);
    return {};
  }
}

interface PlayerState {
  song: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  stemVolumes: Record<string, number>;
  mutedStems: Record<string, boolean>;
  soloedStem: string | null;
  // Punch-in / punch-out region
  punchIn: number | null;
  punchOut: number | null;
  punchLoop: boolean;
  // Recording state
  audioDevices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  // Playback output device
  outputDevices: MediaDeviceInfo[];
  selectedOutputDeviceId: string | null;
  isRecording: boolean;
  isSavingTake: boolean;
  takes: Take[];
  activeTakeId: string | null;
  takeVolume: number;
  // Per-device manual recording latency offset (ms), persisted to localStorage
  recordingOffsets: Record<string, number>;
}

interface PlayerActions {
  loadSong: (song: Song, containers: Record<string, HTMLElement>) => Promise<void>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  setStemVolume: (name: StemName | string, volume: number) => void;
  toggleMute: (name: string) => void;
  toggleSolo: (name: string) => void;
  cleanup: () => void;
  // Punch region actions
  setPunchIn: (t: number) => void;
  setPunchOut: (t: number) => void;
  clearPunch: () => void;
  setPunchLoop: (v: boolean) => void;
  // Recording device actions
  fetchAudioDevices: () => Promise<void>;
  setAudioDevice: (deviceId: string | null) => void;
  setRecordingOffset: (deviceId: string, offsetMs: number) => void;
  // Playback output device actions
  fetchOutputDevices: () => Promise<void>;
  setOutputDevice: (deviceId: string | null) => Promise<void>;
  // Recording actions
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  fetchTakes: () => Promise<void>;
  deleteTake: (takeId: string) => Promise<void>;
  renameTake: (takeId: string, name: string) => Promise<void>;
  setActiveTake: (takeId: string) => void;
  setTakeVolume: (v: number) => void;
}

// Reserved mute/solo key for the recorded take track (shares the same
// mutedStems/soloedStem mechanism as the stems, so soloing either silences
// the rest — no stem is ever actually named this).
export const TAKE_TRACK_KEY = "__take__";

// Soloing a track silences every other track; muting silences only that
// track. Neither ever overwrites the stored slider value.
export function effectiveStemGain(
  name: string,
  rawVolume: number,
  mutedStems: Record<string, boolean>,
  soloedStem: string | null,
): number {
  if (soloedStem !== null) return name === soloedStem ? rawVolume : 0;
  if (mutedStems[name]) return 0;
  return rawVolume;
}

// Compute and push effective volume for every loaded stem, plus the take (if any).
function applyEffectiveVolumes(
  eng: AudioEngine,
  stems: readonly string[],
  stemVolumes: Record<string, number>,
  mutedStems: Record<string, boolean>,
  soloedStem: string | null,
  takeVolume: number,
) {
  for (const name of stems) {
    eng.setStemVolume(name, effectiveStemGain(name, stemVolumes[name] ?? 1.0, mutedStems, soloedStem));
  }
  eng.setTakeVolume(effectiveStemGain(TAKE_TRACK_KEY, takeVolume, mutedStems, soloedStem));
}

/**
 * Build the source list for an "export mix" render from the current store
 * state: one entry per stem/take with nonzero effective volume, resolved to
 * the underlying file path (and take alignment fields, if applicable).
 * Returns null if no track is currently audible.
 */
export function buildMixSources(state: PlayerState): {
  sources: import("../lib/tauri").MixSource[];
  startSec: number;
  endSec: number;
} | null {
  const { song, stemVolumes, mutedStems, soloedStem, takeVolume, activeTakeId, takes } = state;
  if (!song) return null;

  const sources: import("../lib/tauri").MixSource[] = [];

  for (const name of song.stems) {
    const gain = effectiveStemGain(name, stemVolumes[name] ?? 1.0, mutedStems, soloedStem);
    if (gain > 0) {
      sources.push({ path: `${song.directory}/${name}.wav`, gain, isTake: false });
    }
  }

  const takeGain = effectiveStemGain(TAKE_TRACK_KEY, takeVolume, mutedStems, soloedStem);
  if (takeGain > 0 && activeTakeId) {
    const take = takes.find((t) => t.id === activeTakeId);
    if (take) {
      sources.push({
        path: take.filepath,
        gain: takeGain,
        isTake: true,
        startPosition: take.startPosition,
        audioOffset: take.audioOffset ?? 0,
      });
    }
  }

  if (sources.length === 0) return null;

  return {
    sources,
    startSec: state.punchIn ?? 0,
    endSec: state.punchOut ?? state.duration,
  };
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  song: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1.0,
  stemVolumes: {},
  mutedStems: {},
  soloedStem: null,
  punchIn: null,
  punchOut: null,
  punchLoop: false,
  audioDevices: [],
  selectedDeviceId: null,
  outputDevices: [],
  selectedOutputDeviceId: null,
  isRecording: false,
  isSavingTake: false,
  takes: [],
  activeTakeId: null,
  takeVolume: 1.0,
  recordingOffsets: _loadOffsets(),

  loadSong: async (song, containers) => {
    const eng = getEngine();
    await eng.load(song.directory, song.stems, containers);
    eng.onTimeUpdate((time) => {
      set({ currentTime: time, isPlaying: eng.isPlaying });
      const s = get();
      if (s.punchOut !== null && time >= s.punchOut && s.isPlaying) {
        if (s.punchLoop && s.punchIn !== null) {
          eng.seekTo(s.punchIn);
          set({ currentTime: s.punchIn });
        } else {
          eng.pause();
          const backTo = s.punchIn ?? 0;
          eng.seekTo(backTo);
          set({ isPlaying: false, currentTime: backTo });
        }
      }
    });
    eng.onFinish(() => set({ isPlaying: false }));
    const initialVolumes = Object.fromEntries(song.stems.map((n) => [n, 1.0]));
    set({
      song,
      duration: eng.getDuration(),
      currentTime: 0,
      isPlaying: false,
      playbackRate: 1.0,
      stemVolumes: initialVolumes,
      mutedStems: {},
      soloedStem: null,
      takes: [],
      activeTakeId: null,
      takeVolume: 1.0,
      isRecording: false,
      isSavingTake: false,
    });
    get().fetchTakes();
  },

  play: () => {
    const eng = getEngine();
    const { punchIn } = get();
    if (punchIn !== null) {
      eng.seekTo(punchIn);
      set({ currentTime: punchIn });
    }
    eng.play();
    set({ isPlaying: true });
  },

  pause: () => {
    getEngine().pause();
    set({ isPlaying: false });
  },

  togglePlay: () => {
    if (get().isPlaying) get().pause();
    else get().play();
  },

  stop: () => {
    getEngine().stop();
    set({ isPlaying: false, currentTime: 0 });
  },

  seek: (time) => {
    getEngine().seekTo(time);
    set({ currentTime: time });
  },

  setPlaybackRate: (rate) => {
    getEngine().setPlaybackRate(rate);
    set({ playbackRate: rate });
  },

  setStemVolume: (name, volume) => {
    const { mutedStems, soloedStem, stemVolumes, song, takeVolume } = get();
    const newVolumes = { ...stemVolumes, [name]: volume };
    set({ stemVolumes: newVolumes });
    if (song) {
      applyEffectiveVolumes(getEngine(), song.stems, newVolumes, mutedStems, soloedStem, takeVolume);
    }
  },

  toggleMute: (name) => {
    const { mutedStems, soloedStem, stemVolumes, song, takeVolume } = get();
    const newMuted = { ...mutedStems, [name]: !mutedStems[name] };
    set({ mutedStems: newMuted });
    if (song) {
      applyEffectiveVolumes(getEngine(), song.stems, stemVolumes, newMuted, soloedStem, takeVolume);
    }
  },

  toggleSolo: (name) => {
    const { soloedStem, mutedStems, stemVolumes, song, takeVolume } = get();
    const newSolo = soloedStem === name ? null : name;
    set({ soloedStem: newSolo });
    if (song) {
      applyEffectiveVolumes(getEngine(), song.stems, stemVolumes, mutedStems, newSolo, takeVolume);
    }
  },

  cleanup: () => {
    getEngine().destroy();
    recorder?.dispose();
    set({
      song: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      stemVolumes: {},
      mutedStems: {},
      soloedStem: null,
      isRecording: false,
      isSavingTake: false,
      takes: [],
      activeTakeId: null,
      takeVolume: 1.0,
    });
  },

  setPunchIn:   (t) => set({ punchIn: t }),
  setPunchOut:  (t) => set({ punchOut: t }),
  clearPunch:   ()  => set({ punchIn: null, punchOut: null, punchLoop: false }),
  setPunchLoop: (v) => set({ punchLoop: v }),

  fetchAudioDevices: async () => {
    // WebView2 on the installed tauri:// origin returns empty device labels until mic
    // permission has been granted for this session. A brief probe unlocks the full list.
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      probe.getTracks().forEach((t) => t.stop());
    } catch (e) {
      console.warn("Mic permission probe failed — device list may be incomplete:", e);
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    set({ audioDevices: devices.filter((d) => d.kind === "audioinput") });
  },

  setAudioDevice: (deviceId) => {
    set({ selectedDeviceId: deviceId });
  },

  setRecordingOffset: (deviceId, offsetMs) => {
    const offsets = { ...get().recordingOffsets, [deviceId]: offsetMs };
    set({ recordingOffsets: offsets });
    try {
      localStorage.setItem("songpracticestudio_recording_offsets", JSON.stringify(offsets));
    } catch (e) {
      console.warn("[settings] Could not persist recording offsets:", e);
    }
  },

  fetchOutputDevices: async () => {
    // Same WebView2 permission issue as fetchAudioDevices — probe before enumerating.
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      probe.getTracks().forEach((t) => t.stop());
    } catch (e) {
      console.warn("Mic permission probe failed — output device list may be incomplete:", e);
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    set({ outputDevices: devices.filter((d) => d.kind === "audiooutput") });
  },

  setOutputDevice: async (deviceId) => {
    await getEngine().setOutputDevice(deviceId ?? "");
    set({ selectedOutputDeviceId: deviceId });
  },

  startRecording: async () => {
    const { song } = get();
    if (!song) return;

    const eng = getEngine();
    // Honour punch-in: start recording from the punch point, not the playhead
    recordingStartPos = get().punchIn ?? eng.getCurrentTime();
    eng.pause();

    const rec = getRecorder();
    let inputLatencyS = 0;
    try {
      await rec.init(get().selectedDeviceId);
      // Re-enumerate after getUserMedia succeeds — browser now populates device labels
      const devices = await navigator.mediaDevices.enumerateDevices();
      set({ audioDevices: devices.filter((d) => d.kind === "audioinput") });
      inputLatencyS = (rec.getStream()?.getAudioTracks()[0].getSettings() as MediaTrackSettings & { latency?: number })?.latency ?? 0;
    } catch (e) {
      eng.setInteract(true);
      throw new Error("Microphone unavailable: " + (e instanceof Error ? e.message : String(e)));
    }

    eng.setInteract(false);
    eng.seekTo(recordingStartPos);
    eng.play();
    rec.start();

    // Calibrated value takes full priority — skip AudioContext measurement when present.
    const deviceOffsetMs = get().recordingOffsets[get().selectedDeviceId ?? ""] ?? 0;
    if (deviceOffsetMs > 0) {
      _recordingLatencyS = deviceOffsetMs / 1000;
      console.log("[recording] using calibrated compensation:", deviceOffsetMs, "ms");
    } else {
      // No calibration: fall back to AudioContext round-trip estimate.
      try {
        const latencyCtx = new AudioContext();
        const outputLatencyS = (latencyCtx.outputLatency ?? 0) + (latencyCtx.baseLatency ?? 0);
        latencyCtx.close().catch((e: unknown) => console.warn("[latency] ctx close:", e));
        _recordingLatencyS = outputLatencyS + inputLatencyS;
        console.log("[recording] latency — output:", outputLatencyS, "input:", inputLatencyS, "total:", _recordingLatencyS);
      } catch (e) {
        console.warn("[recording] latency measurement failed, compensation disabled:", e);
        _recordingLatencyS = 0;
      }
    }

    set({ isRecording: true, isPlaying: true });
  },

  stopRecording: async () => {
    const { song } = get();
    if (!song) return;

    const rec = getRecorder();
    const eng = getEngine();
    eng.stop();
    eng.setInteract(true);

    // Immediately flip recording off so the button stops pulsing,
    // then show a saving indicator while the blob is flushed to disk.
    set({ isRecording: false, isPlaying: false, isSavingTake: true });

    try {
      const blob = await rec.stop();
      rec.releaseStream();

      // Convert blob to byte array for Tauri
      const arrayBuffer = await blob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      // Shift startPosition back by round-trip latency.
      // When that pushes startPos below 0 (recording from song start), keep startPos at 0
      // and store the remainder as audioOffset so a future consumer can skip that many
      // seconds into the audio file to align take[audioOffset] with song position 0.
      const rawCompensated = recordingStartPos - _recordingLatencyS;
      const compensatedStartPos = Math.max(0, rawCompensated);
      const audioOffset = rawCompensated < 0 ? -rawCompensated : 0;
      const take = await saveTake(song.id, audioData, compensatedStartPos, audioOffset);

      set((state) => ({
        isSavingTake: false,
        currentTime: 0,
        takes: [...state.takes, take],
        activeTakeId: take.id,
      }));
    } catch (e) {
      rec.releaseStream();
      set({ isSavingTake: false, currentTime: 0 });
      throw e;
    }
  },

  fetchTakes: async () => {
    const { song } = get();
    if (!song) return;
    const takes = await listTakes(song.id);
    set({ takes });
  },

  deleteTake: async (takeId) => {
    const { song } = get();
    if (!song) return;
    await deleteTakeApi(song.id, takeId);
    set((state) => ({
      takes: state.takes.filter((t) => t.id !== takeId),
      activeTakeId: state.activeTakeId === takeId ? null : state.activeTakeId,
    }));
  },

  renameTake: async (takeId, name) => {
    const { song } = get();
    if (!song) return;
    const updated = await renameTakeApi(song.id, takeId, name);
    set((state) => ({
      takes: state.takes.map((t) => (t.id === takeId ? updated : t)),
    }));
  },

  setActiveTake: (takeId) => set({ activeTakeId: takeId }),

  setTakeVolume: (v) => {
    set({ takeVolume: v });
    const { mutedStems, soloedStem } = get();
    let vol = v;
    if (soloedStem !== null) {
      vol = soloedStem === TAKE_TRACK_KEY ? vol : 0;
    } else if (mutedStems[TAKE_TRACK_KEY]) {
      vol = 0;
    }
    getEngine().setTakeVolume(vol);
  },
}));
