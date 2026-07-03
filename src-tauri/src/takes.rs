use crate::storage;
use serde::{Deserialize, Serialize};
use std::fs;

/// A recorded track (take), no analysis data — just the raw recording and
/// where it sits on the song timeline.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Take {
    pub id: String,
    pub song_id: String,
    pub recorded_at: String,
    pub filepath: String,
    /// User-assigned display name; falls back to "Take N" in the UI when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Song position (seconds) where recording started; 0 for full-song takes.
    #[serde(default)]
    pub start_position: f64,
    /// Seconds into the audio file to skip on playback (non-zero when latency
    /// compensation exceeds start_position).
    #[serde(default, skip_serializing_if = "is_zero_f64")]
    pub audio_offset: f64,
}

fn is_zero_f64(v: &f64) -> bool {
    *v == 0.0
}

fn takes_json_path(song_id: &str) -> std::path::PathBuf {
    storage::song_dir(song_id).join("takes.json")
}

/// Load all takes recorded for a song.
pub fn load(song_id: &str) -> Result<Vec<Take>, String> {
    let path = takes_json_path(song_id);
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("Read takes: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("Parse takes: {e}"))
}

fn save(song_id: &str, takes: &[Take]) -> Result<(), String> {
    let path = takes_json_path(song_id);
    let data = serde_json::to_string_pretty(takes).map_err(|e| format!("Serialize: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Write takes: {e}"))
}

/// Append a newly recorded take to the song's take list.
pub fn add(song_id: &str, take: Take) -> Result<(), String> {
    let mut takes = load(song_id)?;
    takes.push(take);
    save(song_id, &takes)
}

/// Delete a take's audio file and remove it from the take list.
pub fn remove(song_id: &str, take_id: &str) -> Result<(), String> {
    let takes = load(song_id)?;
    if let Some(take) = takes.iter().find(|t| t.id == take_id) {
        let path = std::path::Path::new(&take.filepath);
        if path.exists() {
            fs::remove_file(path).map_err(|e| format!("Delete take file: {e}"))?;
        }
    }
    let filtered: Vec<Take> = takes.into_iter().filter(|t| t.id != take_id).collect();
    save(song_id, &filtered)
}

/// Rename a take (empty/whitespace name clears it back to the default "Take N" label).
pub fn rename(song_id: &str, take_id: &str, name: &str) -> Result<Take, String> {
    let mut takes = load(song_id)?;
    let trimmed = name.trim();
    let take = takes
        .iter_mut()
        .find(|t| t.id == take_id)
        .ok_or_else(|| format!("Take not found: {take_id}"))?;
    take.name = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
    let updated = take.clone();
    save(song_id, &takes)?;
    Ok(updated)
}
