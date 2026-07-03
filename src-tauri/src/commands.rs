use crate::library::{self, ChordSegment, Song};
use crate::sidecar::{SidecarManager, SidecarMessage};
use crate::storage;
use crate::takes::{self, Take};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Shared sidecar state — lazy-initialized on first use.
pub struct SidecarState(pub std::sync::Mutex<Option<SidecarManager>>);

/// Processing progress event payload (emitted to frontend).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingStatus {
    pub song_id: String,
    pub progress: f32,
    pub stage: String,
    pub is_complete: bool,
    pub error: Option<String>,
}

/// Ensure sidecar is running, spawning if needed. Returns a lock guard.
fn ensure_sidecar(
    state: &SidecarState,
) -> Result<std::sync::MutexGuard<'_, Option<SidecarManager>>, String> {
    let mut guard = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    if guard.is_none() {
        log::info!("Spawning sidecar for first use");
        *guard = Some(SidecarManager::spawn()?);
    }
    Ok(guard)
}

#[tauri::command]
pub async fn process_song(
    app: AppHandle,
    state: State<'_, SidecarState>,
    file_path: String,
    stems_to_extract: Option<Vec<String>>,
    high_quality: Option<bool>,
) -> Result<Song, String> {
    let song_id = uuid::Uuid::new_v4().to_string();
    let output_dir = storage::song_dir(&song_id);

    let src = std::path::Path::new(&file_path);
    if !src.exists() {
        return Err(format!("File not found: {file_path}"));
    }
    let file_name = src
        .file_name()
        .ok_or("Invalid file name")?
        .to_string_lossy();
    let title = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let dest = output_dir.join(file_name.as_ref());
    std::fs::copy(src, &dest).map_err(|e| format!("Copy failed: {e}"))?;

    let output_dir_str = output_dir.to_string_lossy().to_string();
    let dest_str = dest.to_string_lossy().to_string();

    let mut cmd = serde_json::json!({
        "cmd": "process",
        "filePath": dest_str,
        "outputDir": output_dir_str,
    });
    if let Some(ref stems) = stems_to_extract {
        cmd["stemsToExtract"] = serde_json::json!(stems);
    }
    if let Some(hq) = high_quality {
        cmd["highQuality"] = serde_json::json!(hq);
    }

    let guard = ensure_sidecar(&state)?;
    let sidecar = guard.as_ref().ok_or("Sidecar not available")?;
    sidecar.send_command(&cmd)?;

    let timeout = Duration::from_secs(600);
    loop {
        let msg = sidecar.recv_timeout(timeout)?;
        match msg {
            SidecarMessage::Progress { value, stage, .. } => {
                let _ = app.emit(
                    "processing-progress",
                    ProcessingStatus {
                        song_id: song_id.clone(),
                        progress: value,
                        stage,
                        is_complete: false,
                        error: None,
                    },
                );
            }
            SidecarMessage::Result { data, .. } => {
                let _ = app.emit(
                    "processing-progress",
                    ProcessingStatus {
                        song_id: song_id.clone(),
                        progress: 1.0,
                        stage: "complete".to_string(),
                        is_complete: true,
                        error: None,
                    },
                );

                let detected_bpm = data.get("detectedBpm").and_then(|v| v.as_f64());
                let detected_key = data
                    .get("detectedKey")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let duration = data
                    .get("duration")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let stems: Vec<String> = data
                    .get("stems")
                    .and_then(|v| v.as_object())
                    .map(|o| o.keys().cloned().collect())
                    .unwrap_or_default();
                let has_chords = data.get("chords").and_then(|v| v.as_bool()).unwrap_or(false);

                let now = chrono::Utc::now().to_rfc3339();
                let song = Song {
                    id: song_id,
                    title,
                    duration,
                    detected_key,
                    detected_bpm,
                    processed_at: now,
                    directory: output_dir_str,
                    stems,
                    metronome_offset: None,
                    has_chords,
                };

                library::add(song.clone())?;
                return Ok(song);
            }
            SidecarMessage::Error {
                message, traceback, ..
            } => {
                let detail = traceback.unwrap_or_default();
                log::error!("Sidecar error: {message}\n{detail}");
                let _ = app.emit(
                    "processing-progress",
                    ProcessingStatus {
                        song_id: song_id.clone(),
                        progress: 0.0,
                        stage: "error".to_string(),
                        is_complete: true,
                        error: Some(message.clone()),
                    },
                );
                return Err(message);
            }
            _ => {}
        }
    }
}

#[tauri::command]
pub async fn list_songs() -> Result<Vec<Song>, String> {
    library::load()
}

#[tauri::command]
pub async fn delete_song(song_id: String) -> Result<(), String> {
    library::remove(&song_id)
}

#[tauri::command]
pub async fn set_metronome_offset(song_id: String, offset: Option<f64>) -> Result<Song, String> {
    library::update_metronome_offset(&song_id, offset)
}

#[tauri::command]
pub async fn import_youtube(
    app: AppHandle,
    state: State<'_, SidecarState>,
    url: String,
    stems_to_extract: Option<Vec<String>>,
    high_quality: Option<bool>,
) -> Result<Song, String> {
    if !url.contains("youtube.com/") && !url.contains("youtu.be/") {
        return Err("Not a valid YouTube URL".to_string());
    }

    let song_id = uuid::Uuid::new_v4().to_string();
    let output_dir = storage::song_dir(&song_id);
    let output_dir_str = output_dir.to_string_lossy().to_string();

    let mut cmd = serde_json::json!({
        "cmd": "import_yt",
        "url": url,
        "outputDir": output_dir_str,
    });
    if let Some(ref stems) = stems_to_extract {
        cmd["stemsToExtract"] = serde_json::json!(stems);
    }
    if let Some(hq) = high_quality {
        cmd["highQuality"] = serde_json::json!(hq);
    }

    let guard = ensure_sidecar(&state)?;
    let sidecar = guard.as_ref().ok_or("Sidecar not available")?;
    sidecar.send_command(&cmd)?;

    let timeout = Duration::from_secs(900);
    loop {
        let msg = sidecar.recv_timeout(timeout)?;
        match msg {
            SidecarMessage::Progress { value, stage, .. } => {
                let _ = app.emit(
                    "processing-progress",
                    ProcessingStatus {
                        song_id: song_id.clone(),
                        progress: value,
                        stage,
                        is_complete: false,
                        error: None,
                    },
                );
            }
            SidecarMessage::Result { data, .. } => {
                let _ = app.emit(
                    "processing-progress",
                    ProcessingStatus {
                        song_id: song_id.clone(),
                        progress: 1.0,
                        stage: "complete".to_string(),
                        is_complete: true,
                        error: None,
                    },
                );

                let title = data
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let detected_bpm = data.get("detectedBpm").and_then(|v| v.as_f64());
                let detected_key = data
                    .get("detectedKey")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let duration = data
                    .get("duration")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let stems: Vec<String> = data
                    .get("stems")
                    .and_then(|v| v.as_object())
                    .map(|o| o.keys().cloned().collect())
                    .unwrap_or_default();
                let has_chords = data.get("chords").and_then(|v| v.as_bool()).unwrap_or(false);

                let song = Song {
                    id: song_id,
                    title,
                    duration,
                    detected_key,
                    detected_bpm,
                    processed_at: chrono::Utc::now().to_rfc3339(),
                    directory: output_dir_str,
                    stems,
                    metronome_offset: None,
                    has_chords,
                };

                library::add(song.clone())?;
                return Ok(song);
            }
            SidecarMessage::Error {
                message, traceback, ..
            } => {
                let detail = traceback.unwrap_or_default();
                log::error!("YT import error: {message}\n{detail}");
                let _ = app.emit(
                    "processing-progress",
                    ProcessingStatus {
                        song_id: song_id.clone(),
                        progress: 0.0,
                        stage: "error".to_string(),
                        is_complete: true,
                        error: Some(message.clone()),
                    },
                );
                return Err(message);
            }
            _ => {}
        }
    }
}

#[tauri::command]
pub async fn read_song_chords(song_id: String) -> Result<Vec<ChordSegment>, String> {
    library::read_chords(&song_id)
}

#[tauri::command]
pub async fn export_stem(
    app: AppHandle,
    stem_path: String,
    suggested_name: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    let src = std::path::Path::new(&stem_path);
    if !src.exists() {
        return Err(format!("Stem not found: {stem_path}"));
    }

    let dest = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let suggested_name = suggested_name.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(&suggested_name)
                .add_filter("Audio", &["wav"])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| format!("Dialog task: {e}"))?;

    if let Some(path) = dest {
        std::fs::copy(src, path.as_path().ok_or("Invalid path")?)
            .map_err(|e| format!("Copy failed: {e}"))?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntry {
    pub path: String,
    pub archive_name: String,
}

#[tauri::command]
pub async fn export_all(
    app: AppHandle,
    entries: Vec<ZipEntry>,
    suggested_name: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    if entries.is_empty() {
        return Err("Nothing to export".to_string());
    }

    let dest = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let suggested_name = suggested_name.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(&suggested_name)
                .add_filter("Zip Archive", &["zip"])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| format!("Dialog task: {e}"))?;

    let Some(dest) = dest else { return Ok(()) };
    let dest_path = dest.as_path().ok_or("Invalid path")?.to_path_buf();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::create(&dest_path).map_err(|e| format!("Create zip: {e}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for entry in &entries {
            let mut src = std::fs::File::open(&entry.path)
                .map_err(|e| format!("Open {}: {e}", entry.path))?;
            zip.start_file(&entry.archive_name, options)
                .map_err(|e| format!("Zip entry {}: {e}", entry.archive_name))?;
            std::io::copy(&mut src, &mut zip)
                .map_err(|e| format!("Write {}: {e}", entry.archive_name))?;
        }
        zip.finish().map_err(|e| format!("Finish zip: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Zip task: {e}"))??;

    Ok(())
}

// --- Take (recorded track) commands ---

#[tauri::command]
pub async fn save_take(
    state: State<'_, SidecarState>,
    song_id: String,
    audio_data: Vec<u8>,
    start_position: f64,
    audio_offset: f64,
) -> Result<Take, String> {
    let take_id = uuid::Uuid::new_v4().to_string();
    let takes_dir = storage::song_dir(&song_id).join("takes");
    std::fs::create_dir_all(&takes_dir).map_err(|e| format!("Create takes dir: {e}"))?;

    let file_path = takes_dir.join(format!("{take_id}.webm"));
    std::fs::write(&file_path, &audio_data).map_err(|e| format!("Write take: {e}"))?;

    let file_path_str = file_path.to_string_lossy().to_string();
    let normalized_output_path = takes_dir.join(format!("{take_id}.wav"));
    let normalized_output_str = normalized_output_path.to_string_lossy().to_string();
    let vocals_path = storage::song_dir(&song_id).join("vocals.wav");
    let reference_path_str = vocals_path.exists().then(|| vocals_path.to_string_lossy().to_string());

    // RMS-normalize the take's loudness against the vocals stem via sidecar.
    let normalized_path: Option<String> = {
        let guard = ensure_sidecar(&state);
        if let Ok(guard) = guard {
            if let Some(sidecar) = guard.as_ref() {
                let mut cmd_obj = serde_json::json!({
                    "cmd": "normalize_take",
                    "recordingPath": file_path_str,
                    "outputPath": normalized_output_str,
                    "audioOffset": audio_offset,
                });
                if let Some(ref_path) = &reference_path_str {
                    cmd_obj["referencePath"] = serde_json::json!(ref_path);
                }
                let _ = sidecar.send_command(&cmd_obj);
                let timeout = std::time::Duration::from_secs(120);
                let mut result = None;
                loop {
                    match sidecar.recv_timeout(timeout) {
                        Ok(SidecarMessage::Result { data, .. }) => {
                            result = data.get("path").and_then(|v| v.as_str().map(|s| s.to_string()));
                            break;
                        }
                        Ok(SidecarMessage::Error { message, .. }) => {
                            log::warn!("Take normalization error: {message}");
                            break;
                        }
                        Ok(SidecarMessage::Progress { .. }) => continue,
                        _ => break,
                    }
                }
                result
            } else {
                None
            }
        } else {
            None
        }
    };

    // Prefer the loudness-normalized WAV; fall back to the raw webm if normalization failed.
    let final_file_path_str = match &normalized_path {
        Some(p) => {
            if let Err(e) = std::fs::remove_file(&file_path) {
                log::warn!("Could not remove raw take recording {file_path_str}: {e}");
            }
            p.clone()
        }
        None => file_path_str,
    };

    let take = Take {
        id: take_id,
        song_id: song_id.clone(),
        recorded_at: chrono::Utc::now().to_rfc3339(),
        filepath: final_file_path_str,
        name: None,
        start_position,
        audio_offset,
    };

    takes::add(&song_id, take.clone())?;
    Ok(take)
}

#[tauri::command]
pub async fn list_takes(song_id: String) -> Result<Vec<Take>, String> {
    takes::load(&song_id)
}

#[tauri::command]
pub async fn delete_take(song_id: String, take_id: String) -> Result<(), String> {
    takes::remove(&song_id, &take_id)
}

#[tauri::command]
pub async fn rename_take(song_id: String, take_id: String, name: String) -> Result<Take, String> {
    takes::rename(&song_id, &take_id, &name)
}

/// Deletes the wrapped temp file when dropped.
struct TempFile(std::path::PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_file(&self.0) {
            log::warn!("Failed to remove temp export file {:?}: {e}", self.0);
        }
    }
}

#[tauri::command]
pub async fn export_take(
    app: AppHandle,
    state: State<'_, SidecarState>,
    take_path: String,
    suggested_name: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    let src = std::path::Path::new(&take_path);
    if !src.exists() {
        return Err(format!("Take not found: {take_path}"));
    }

    // The take is webm/opus (whatever MediaRecorder produced); decode it via
    // the sidecar into a temp WAV file, then offer that through Save-As.
    let temp_path = std::env::temp_dir().join(format!("{}.wav", uuid::Uuid::new_v4()));
    let cmd = serde_json::json!({
        "cmd": "convert_take",
        "recordingPath": take_path,
        "outputPath": temp_path.to_string_lossy(),
    });
    {
        let guard = ensure_sidecar(&state)?;
        let sidecar = guard.as_ref().ok_or("Sidecar not available")?;
        sidecar.send_command(&cmd)?;

        let timeout = Duration::from_secs(120);
        loop {
            match sidecar.recv_timeout(timeout)? {
                SidecarMessage::Result { .. } => break,
                SidecarMessage::Error { message, .. } => return Err(message),
                _ => {}
            }
        }
    }
    let _temp_guard = TempFile(temp_path.clone());

    let dest = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let suggested_name = suggested_name.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(&suggested_name)
                .add_filter("Audio", &["wav"])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| format!("Dialog task: {e}"))?;

    if let Some(path) = dest {
        std::fs::copy(&temp_path, path.as_path().ok_or("Invalid path")?)
            .map_err(|e| format!("Copy failed: {e}"))?;
    }
    Ok(())
}

/// One track to include in an `export_mix` render. `gain` is the final
/// linear volume already resolved from mute/solo/volume by the frontend —
/// this command has no concept of mute/solo, only gains. `start_position`/
/// `audio_offset` are only meaningful for `is_take` sources (see the
/// `fileTime = projectTime - startPosition + audioOffset` mapping in
/// `player.ts`); omitted for plain stem sources.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixSource {
    pub path: String,
    pub gain: f64,
    pub is_take: bool,
    pub start_position: Option<f64>,
    pub audio_offset: Option<f64>,
}

#[tauri::command]
pub async fn export_mix(
    app: AppHandle,
    state: State<'_, SidecarState>,
    sources: Vec<MixSource>,
    start_sec: f64,
    end_sec: f64,
    suggested_name: String,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    if sources.is_empty() {
        return Err("No audible tracks to export".to_string());
    }

    let temp_path = std::env::temp_dir().join(format!("{}.wav", uuid::Uuid::new_v4()));
    let cmd = serde_json::json!({
        "cmd": "mix_export",
        "outputPath": temp_path.to_string_lossy(),
        "startSec": start_sec,
        "endSec": end_sec,
        "sources": sources,
    });
    {
        let guard = ensure_sidecar(&state)?;
        let sidecar = guard.as_ref().ok_or("Sidecar not available")?;
        sidecar.send_command(&cmd)?;

        let timeout = Duration::from_secs(120);
        loop {
            match sidecar.recv_timeout(timeout)? {
                SidecarMessage::Result { .. } => break,
                SidecarMessage::Error { message, .. } => return Err(message),
                _ => {}
            }
        }
    }
    let _temp_guard = TempFile(temp_path.clone());

    let dest = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let suggested_name = suggested_name.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(&suggested_name)
                .add_filter("Audio", &["wav"])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| format!("Dialog task: {e}"))?;

    if let Some(path) = dest {
        std::fs::copy(&temp_path, path.as_path().ok_or("Invalid path")?)
            .map_err(|e| format!("Copy failed: {e}"))?;
    }
    Ok(())
}
