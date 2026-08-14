import { create } from "zustand";

interface SettingsState {
  youtubeCookiesPath: string | null;
  setYoutubeCookiesPath: (path: string | null) => void;
}

type PersistedSettings = { youtubeCookiesPath: string | null };

function _loadSettings(): PersistedSettings {
  try {
    const raw = JSON.parse(localStorage.getItem("sps_settings") ?? "{}") as Record<string, unknown>;
    const cookiesPath = raw.youtubeCookiesPath;
    return { youtubeCookiesPath: typeof cookiesPath === "string" ? cookiesPath : null };
  } catch (e) {
    console.warn("[settings] Could not load settings:", e);
    return { youtubeCookiesPath: null };
  }
}

function _persistSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem("sps_settings", JSON.stringify(settings));
  } catch (e) {
    console.warn("[settings] Could not persist settings:", e);
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ..._loadSettings(),

  setYoutubeCookiesPath: (path) => {
    set({ youtubeCookiesPath: path });
    _persistSettings({ youtubeCookiesPath: get().youtubeCookiesPath });
  },
}));
