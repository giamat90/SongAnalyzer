export type StemName = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";

export interface Song {
  id: string;
  title: string;
  duration: number;
  detectedKey?: string;
  detectedBpm?: number;
  processedAt: string;
  directory: string;
  stems: StemName[];
  metronomeOffset?: number;
}

export interface ProcessingStatus {
  songId: string;
  progress: number;
  stage: string;
  isComplete: boolean;
  error?: string;
}

/** A recorded track (take) — no pitch/vocal analysis, just the raw recording. */
export interface Take {
  id: string;
  songId: string;
  recordedAt: string;
  filepath: string;
  /** User-assigned display name; falls back to "Take N" in the UI when absent. */
  name?: string;
  /** Song position (seconds) where recording started; 0 for full-song takes. */
  startPosition: number;
  /** Seconds into the audio file to skip on playback (non-zero when latency
   *  compensation exceeds startPosition). */
  audioOffset?: number;
}
