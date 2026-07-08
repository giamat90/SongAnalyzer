import { useState } from "react";
import { usePlayerStore } from "../../stores/player";
import { exportAll, type ZipExportEntry } from "../../lib/tauri";
import type { Song } from "../../lib/types";

function DownloadAllButton({ song }: { song: Song }) {
  const takes = usePlayerStore((s) => s.takes);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const dir = song.directory.replace(/\\/g, "/");
      const entries: ZipExportEntry[] = song.stems.map((name) => ({
        path: `${dir}/${name}.wav`,
        archiveName: `${name.charAt(0).toUpperCase() + name.slice(1)}.wav`,
      }));

      const usedNames = new Set(entries.map((e) => e.archiveName));
      takes.forEach((take, i) => {
        const base = take.name || `Take ${i + 1}`;
        let archiveName = `${base}.wav`;
        let n = 2;
        while (usedNames.has(archiveName)) {
          archiveName = `${base} (${n++}).wav`;
        }
        usedNames.add(archiveName);
        entries.push({ path: take.filepath, archiveName });
      });

      await exportAll(entries, `${song.title}.zip`);
    } catch (e) {
      console.error("[DownloadAllButton] exportAll failed:", e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      className="analyzer-page__download-all"
      onClick={() => void handleExport()}
      disabled={isExporting}
      title="Download all stems and takes as a zip archive"
    >
      {isExporting ? "Zipping…" : "Download All"}
    </button>
  );
}

export default DownloadAllButton;
