import WaveSurfer from "wavesurfer.js";
import { convertFileSrc } from "@tauri-apps/api/core";

export type TimeUpdateCallback = (currentTime: number) => void;
export type FinishCallback = () => void;

export const STEM_COLORS: Record<string, string> = {
  vocals: "rgba(74,158,255,0.85)",
  drums:  "rgba(180,80,220,0.85)",
  bass:   "rgba(60,200,100,0.85)",
  guitar: "rgba(255,140,30,0.85)",
  piano:  "rgba(255,220,50,0.85)",
  other:  "rgba(160,160,160,0.85)",
};

export class AudioEngine {
  private _stems: Map<string, WaveSurfer> = new Map();
  private _master: WaveSurfer | null = null;
  private _duration = 0;
  private _isPlaying = false;
  private _loopStart: number | null = null;
  private _loopEnd: number | null = null;
  private _timeUpdateCb: TimeUpdateCallback | null = null;
  private _finishCb: FinishCallback | null = null;
  private _rafId: number | null = null;
  private _lastNotifyTime = 0;

  // Recorded take — separate from the stems map since its duration/start
  // position can differ from the shared song timeline (e.g. punch-in takes).
  private _take: WaveSurfer | null = null;
  private _takeOffset = 0;
  private _takeDuration = 0;
  private _takeAudioOffset = 0;
  private _takeIsPlaying = false;

  async load(
    songDir: string,
    stemNames: string[],
    containers: Record<string, HTMLElement>,
  ): Promise<void> {
    this.destroy();

    const dir = songDir.replace(/\\/g, "/");

    const promises = stemNames.map((name) => {
      const container = containers[name];
      if (!container) return Promise.resolve();

      const color = STEM_COLORS[name] ?? "rgba(160,160,160,0.85)";
      const ws = WaveSurfer.create({
        container,
        url: convertFileSrc(`${dir}/${name}.wav`),
        height: 64,
        waveColor: color,
        progressColor: color,
        cursorColor: "#e94560",
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        interact: true,
      });
      this._stems.set(name, ws);

      return new Promise<void>((resolve, reject) => {
        ws.on("ready", () => resolve());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.on("error", (err: any) =>
          reject(new Error(`${name} failed to load: ${err?.message ?? err}`))
        );
      });
    });

    await Promise.all(promises);
    if (this._stems.size === 0) return;

    // Master clock: prefer vocals, otherwise use first available stem
    const masterName = this._stems.has("vocals") ? "vocals" : stemNames.find((n) => this._stems.has(n))!;
    this._master = this._stems.get(masterName)!;
    this._duration = this._master.getDuration();

    // Sync: clicking any stem waveform seeks all others (and the take, if loaded)
    for (const [name, ws] of this._stems) {
      ws.on("interaction", (time) => {
        const progress = Math.max(0, Math.min(1, time / this._duration));
        for (const [otherName, other] of this._stems) {
          if (otherName !== name) other.seekTo(progress);
        }
        this._seekTake(time);
      });
    }

    this._master.on("finish", () => {
      this._isPlaying = false;
      this._stopTimeUpdate();
      this._finishCb?.();
    });
  }

  play(): void {
    if (this._stems.size === 0) return;
    for (const ws of this._stems.values()) ws.play();
    if (this._take && this._takeDuration > 0) {
      const time = this.getCurrentTime();
      const takeEnd = this._takeOffset + this._takeDuration - this._takeAudioOffset;
      if (time >= this._takeOffset && time < takeEnd) {
        this._take.play();
        this._takeIsPlaying = true;
      }
    }
    this._isPlaying = true;
    this._startTimeUpdate();
  }

  pause(): void {
    for (const ws of this._stems.values()) ws.pause();
    this._take?.pause();
    this._takeIsPlaying = false;
    this._isPlaying = false;
    this._stopTimeUpdate();
  }

  togglePlay(): void {
    if (this._isPlaying) this.pause();
    else this.play();
  }

  stop(): void {
    this.pause();
    this.seekTo(0);
  }

  seekTo(time: number): void {
    const progress = Math.max(0, Math.min(1, time / this._duration));
    for (const ws of this._stems.values()) ws.seekTo(progress);
    this._seekTake(time);
  }

  setStemVolume(name: string, volume: number): void {
    this._stems.get(name)?.setVolume(volume);
  }

  setPlaybackRate(rate: number): void {
    for (const ws of this._stems.values()) ws.setPlaybackRate(rate);
    this._take?.setPlaybackRate(rate);
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    await Promise.all([
      ...[...this._stems.values()].map((ws) => ws.setSinkId(deviceId)),
      ...(this._take ? [this._take.setSinkId(deviceId)] : []),
    ]);
  }

  /** Enable/disable click-to-seek on stem waveforms (disabled while recording). */
  setInteract(enabled: boolean): void {
    for (const ws of this._stems.values()) ws.setOptions({ interact: enabled });
    this._take?.setOptions({ interact: enabled });
  }

  async loadTakeTrack(filePath: string, container: HTMLElement, startOffset = 0, audioOffset = 0): Promise<void> {
    this._take?.destroy();
    this._take = null;

    const wasPlaying = this._isPlaying;
    const url = convertFileSrc(filePath.replace(/\\/g, "/"));

    this._take = WaveSurfer.create({
      container,
      url,
      height: 64,
      waveColor: "#ff8c1e",
      progressColor: "#ff8c1e",
      cursorColor: "#ff8c1e",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
    });

    await new Promise<void>((resolve, reject) => {
      const unsubReady = this._take!.on("ready", () => { unsubReady(); unsubError(); resolve(); });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unsubError = this._take!.on("error", (err: any) => {
        unsubReady(); unsubError();
        console.error("[engine] WaveSurfer take load failed — url:", url, "raw err:", err);
        reject(new Error(err?.message || err?.toString?.() || "WaveSurfer load error"));
      });
    });

    this._takeOffset      = startOffset;
    this._takeDuration    = this._take.getDuration();
    this._takeAudioOffset = audioOffset;

    // Constrain the container to the correct time window so the waveform
    // lines up visually with the other tracks. Read railWidth BEFORE resizing
    // so the ratio calculation uses the full width. setOptions({ width })
    // forces WaveSurfer to redraw — more reliable than its ResizeObserver.
    if (this._duration > 0 && this._takeDuration > 0) {
      const railWidth   = container.offsetWidth;
      const playableDur = this._takeDuration - audioOffset;
      const widthPx     = Math.round((playableDur / this._duration) * railWidth);
      const marginPx    = Math.round((startOffset / this._duration) * railWidth);
      container.style.marginLeft = `${marginPx}px`;
      container.style.width      = `${widthPx}px`;
      this._take.setOptions({ width: widthPx });
    }

    this._take.on("interaction", (newTime) => {
      const songTime = newTime - this._takeAudioOffset + this._takeOffset;
      this.seekTo(songTime);
    });

    this._takeIsPlaying = false;
    const time = this.getCurrentTime();
    this._seekTake(time);
    const takeEnd = this._takeOffset + this._takeDuration - this._takeAudioOffset;
    if (wasPlaying && time >= this._takeOffset && time < takeEnd) {
      this._take.play();
      this._takeIsPlaying = true;
    }
  }

  setTakeVolume(volume: number): void {
    this._take?.setVolume(volume);
  }

  clearTakeTrack(): void {
    this._take?.destroy();
    this._take = null;
    this._takeOffset = 0;
    this._takeDuration = 0;
    this._takeAudioOffset = 0;
    this._takeIsPlaying = false;
  }

  // Seek the take to the position that corresponds to the given song time.
  private _seekTake(songTime: number): void {
    if (!this._take) return;
    const dur = this._takeDuration > 0 ? this._takeDuration : this._duration;
    const takeTime = this._takeAudioOffset + Math.max(0, songTime - this._takeOffset);
    this._take.seekTo(Math.min(1, takeTime / dur));
  }

  setLoop(start: number, end: number): void {
    this._loopStart = start;
    this._loopEnd = end;
  }

  clearLoop(): void {
    this._loopStart = null;
    this._loopEnd = null;
  }

  getCurrentTime(): number {
    return this._master?.getCurrentTime() ?? 0;
  }

  getDuration(): number {
    return this._duration;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  onTimeUpdate(cb: TimeUpdateCallback): void {
    this._timeUpdateCb = cb;
  }

  onFinish(cb: FinishCallback): void {
    this._finishCb = cb;
  }

  destroy(): void {
    this._stopTimeUpdate();
    for (const ws of this._stems.values()) ws.destroy();
    this._stems.clear();
    this._master = null;
    this._isPlaying = false;
    this._duration = 0;
    this._loopStart = null;
    this._loopEnd = null;
    this.clearTakeTrack();
  }

  private _startTimeUpdate(): void {
    this._stopTimeUpdate();
    const tick = () => {
      if (!this._isPlaying) return;

      const time = this.getCurrentTime();

      if (
        this._loopStart !== null &&
        this._loopEnd !== null &&
        time >= this._loopEnd
      ) {
        this.seekTo(this._loopStart);
      }

      // Take window sync: start/stop the take as the playhead enters/exits its time window
      if (this._take && this._takeDuration > 0) {
        const takeEnd = this._takeOffset + this._takeDuration - this._takeAudioOffset;
        const inWindow = time >= this._takeOffset && time < takeEnd;
        if (inWindow && !this._takeIsPlaying) {
          this._take.play();
          this._takeIsPlaying = true;
        } else if (!inWindow && this._takeIsPlaying) {
          this._take.pause();
          this._takeIsPlaying = false;
        }
      }

      const now = performance.now();
      if (now - this._lastNotifyTime >= 33) {
        this._lastNotifyTime = now;
        this._timeUpdateCb?.(time);
      }

      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _stopTimeUpdate(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
}
