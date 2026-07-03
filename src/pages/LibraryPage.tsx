import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import DropZone from "../components/upload/DropZone";
import YouTubeImport from "../components/upload/YouTubeImport";
import RecordingOffsetControl from "../components/recording/RecordingOffsetControl";
import type { Song } from "../lib/types";
import { useLibraryStore } from "../stores/library";

interface LibraryPageProps {
  onSelectSong: (songId: string) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface SongCardProps {
  song: Song;
  onSelect: () => void;
  onDelete: () => void;
}

function SongCard({ song, onSelect, onDelete }: SongCardProps) {
  return (
    <div className="song-card" onClick={onSelect}>
      <div className="song-card__info">
        <div className="song-card__title">{song.title}</div>
        <div className="song-card__meta">
          {song.detectedBpm && <span>{Math.round(song.detectedBpm)} BPM</span>}
          {song.detectedKey && <span>{song.detectedKey}</span>}
          <span>{formatDuration(song.duration)}</span>
          {song.stems.length > 0 && (
            <span>{song.stems.length} stems</span>
          )}
        </div>
      </div>
      <div
        className="song-card__actions"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="song-card__delete"
          onClick={onDelete}
          title="Delete song"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

function LibraryPage({ onSelectSong }: LibraryPageProps) {
  const songs               = useLibraryStore((s) => s.songs);
  const isLoading           = useLibraryStore((s) => s.isLoading);
  const error               = useLibraryStore((s) => s.error);
  const fetchSongs          = useLibraryStore((s) => s.fetchSongs);
  const deleteSong          = useLibraryStore((s) => s.deleteSong);
  const clearError          = useLibraryStore((s) => s.clearError);
  const initProgressListener = useLibraryStore((s) => s.initProgressListener);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    fetchSongs();
    const cleanupPromise = initProgressListener();
    getVersion()
      .then(setAppVersion)
      .catch((e: unknown) => console.warn("[About] getVersion failed:", e));
    return () => {
      cleanupPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div className="library-page">
      <header className="library-page__header">
        <h1>Song Practice Studio</h1>
        <div className="library-page__header-actions">
          <button
            className={`library-page__settings-btn${showSettings ? " library-page__settings-btn--active" : ""}`}
            onClick={() => setShowSettings((v) => !v)}
            title="Recording settings"
          >
            ⚙
          </button>
          <button
            className="library-page__about-btn"
            onClick={() => setShowAbout(true)}
            title="About"
          >
            ⓘ
          </button>
        </div>
      </header>

      {showAbout && (
        <div className="about-overlay" onClick={() => setShowAbout(false)}>
          <div className="about-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="about-modal__title">Song Practice Studio</h2>
            {appVersion && <p className="about-modal__version">v{appVersion}</p>}
            <p className="about-modal__desc">
              Desktop app for musicians: drop any audio file or paste a YouTube URL,
              split it into up to six instrument stems with Demucs, then mix, loop,
              slow down, and record a take alongside the separated tracks.
            </p>
            <button className="about-modal__close" onClick={() => setShowAbout(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      <div className="library-page__import">
        <DropZone />
        <YouTubeImport />
      </div>

      {showSettings && (
        <div className="library-page__settings">
          <RecordingOffsetControl />
        </div>
      )}

      {error && (
        <div className="library-page__error" role="alert">
          <span className="library-page__error-msg">{error}</span>
          <button
            className="library-page__error-close"
            onClick={clearError}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      <section className="library-page__list">
        {isLoading && <p className="library-page__loading">Loading...</p>}

        {!isLoading && songs.length === 0 && (
          <p className="library-page__empty">
            No songs yet. Drop an audio file or paste a YouTube URL to get started.
          </p>
        )}

        {songs.map((song) => (
          <SongCard
            key={song.id}
            song={song}
            onSelect={() => onSelectSong(song.id)}
            onDelete={() => deleteSong(song.id)}
          />
        ))}
      </section>
    </div>
  );
}

export default LibraryPage;
