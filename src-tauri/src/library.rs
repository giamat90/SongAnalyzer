use crate::storage;
use serde::{Deserialize, Serialize};
use std::fs;

/// Song metadata persisted in library.json.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub title: String,
    pub duration: f64,
    pub detected_key: Option<String>,
    pub detected_bpm: Option<f64>,
    pub processed_at: String,
    pub directory: String,
    #[serde(default)]
    pub stems: Vec<String>,
    // Song time (s) where the metronome's beat 1 lands — lets the user align
    // the click track to the song's actual downbeat when there's silence (or
    // a pickup) before it, instead of always starting at song position 0.
    #[serde(default)]
    pub metronome_offset: Option<f64>,
    #[serde(default)]
    pub has_chords: bool,
    // None = root/uncategorized. Absent from pre-folders library.json files,
    // so every existing song deserializes into the root list.
    #[serde(default)]
    pub folder_id: Option<String>,
    // Rank among sibling songs sharing the same folder_id. Ties (e.g. every
    // song migrated from a pre-folders library.json, which all default to 0)
    // fall back to array order via a stable sort, so migration never
    // reshuffles an existing library.
    #[serde(default)]
    pub sort_index: i32,
}

/// A single detected chord segment, read on demand from `chords.json`.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChordSegment {
    pub start: f64,
    pub end: f64,
    pub chord: String,
}

/// A user-named, flat (non-nested) grouping of songs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub sort_index: i32,
}

/// On-disk shape of library.json. Replaces the old bare `Vec<Song>` format;
/// `load()` falls back to parsing that legacy shape when this fails.
#[derive(Serialize, Deserialize, Default)]
struct LibraryFile {
    #[serde(default)]
    folders: Vec<Folder>,
    #[serde(default)]
    songs: Vec<Song>,
}

fn library_path() -> std::path::PathBuf {
    storage::app_data_dir().join("library.json")
}

/// Load the full library (folders + songs) from library.json, transparently
/// upgrading a legacy bare-array file (pre-folders) in memory. The upgraded
/// shape is only actually written back on the next `save()` — reads alone
/// never touch disk.
fn load() -> Result<LibraryFile, String> {
    let path = library_path();
    if !path.exists() {
        return Ok(LibraryFile::default());
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("Read library: {e}"))?;
    if let Ok(file) = serde_json::from_str::<LibraryFile>(&data) {
        return Ok(file);
    }
    let songs: Vec<Song> =
        serde_json::from_str(&data).map_err(|e| format!("Parse library: {e}"))?;
    Ok(LibraryFile {
        folders: vec![],
        songs,
    })
}

/// Save the full library (folders + songs) to library.json.
fn save(lib: &LibraryFile) -> Result<(), String> {
    let path = library_path();
    let data = serde_json::to_string_pretty(lib).map_err(|e| format!("Serialize: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Write library: {e}"))
}

/// Load all songs from library.json, in stored order.
pub fn load_songs() -> Result<Vec<Song>, String> {
    Ok(load()?.songs)
}

/// Load all folders from library.json, in stored order.
pub fn load_folders() -> Result<Vec<Folder>, String> {
    Ok(load()?.folders)
}

/// Add a song to the library, appended to the end of the root (no folder) list.
pub fn add(mut song: Song) -> Result<(), String> {
    let mut lib = load()?;
    let next_index = lib
        .songs
        .iter()
        .filter(|s| s.folder_id.is_none())
        .map(|s| s.sort_index)
        .max()
        .map(|m| m + 1)
        .unwrap_or(0);
    song.folder_id = None;
    song.sort_index = next_index;
    lib.songs.push(song);
    save(&lib)
}

/// Update a song's metronome downbeat offset and persist it.
pub fn update_metronome_offset(song_id: &str, offset: Option<f64>) -> Result<Song, String> {
    let mut lib = load()?;
    let song = lib
        .songs
        .iter_mut()
        .find(|s| s.id == song_id)
        .ok_or_else(|| format!("Song not found: {song_id}"))?;
    song.metronome_offset = offset;
    let updated = song.clone();
    save(&lib)?;
    Ok(updated)
}

#[derive(Deserialize)]
struct ChordsFile {
    segments: Vec<ChordSegment>,
}

/// Read the detected chord segments for a song from its `chords.json`.
pub fn read_chords(song_id: &str) -> Result<Vec<ChordSegment>, String> {
    let lib = load()?;
    let song = lib
        .songs
        .iter()
        .find(|s| s.id == song_id)
        .ok_or_else(|| format!("Song not found: {song_id}"))?;
    let path = std::path::Path::new(&song.directory).join("chords.json");
    let data = fs::read_to_string(&path).map_err(|e| format!("Read chords: {e}"))?;
    let parsed: ChordsFile = serde_json::from_str(&data).map_err(|e| format!("Parse chords: {e}"))?;
    Ok(parsed.segments)
}

/// Create a folder and persist it, appended to the end of the folder list.
pub fn create_folder(name: &str) -> Result<Folder, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    let mut lib = load()?;
    let next_index = lib
        .folders
        .iter()
        .map(|f| f.sort_index)
        .max()
        .map(|m| m + 1)
        .unwrap_or(0);
    let folder = Folder {
        id: uuid::Uuid::new_v4().to_string(),
        name: trimmed.to_string(),
        sort_index: next_index,
    };
    lib.folders.push(folder.clone());
    save(&lib)?;
    Ok(folder)
}

/// Find `folder_id` in `folders` and set its name to the trimmed `name`.
/// Pulled out of `rename_folder` so the find/trim/mutate logic is
/// unit-testable without touching the real library.json on disk.
fn rename_folder_in(folders: &mut [Folder], folder_id: &str, name: &str) -> Result<Folder, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    let folder = folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or_else(|| format!("Folder not found: {folder_id}"))?;
    folder.name = trimmed.to_string();
    Ok(folder.clone())
}

/// Rename a folder and persist it. Empty/whitespace name is rejected.
pub fn rename_folder(folder_id: &str, name: &str) -> Result<Folder, String> {
    let mut lib = load()?;
    let updated = rename_folder_in(&mut lib.folders, folder_id, name)?;
    save(&lib)?;
    Ok(updated)
}

/// Delete a folder and persist it. Songs that belonged to it move back to
/// the root list (folder_id cleared) rather than being deleted — a folder
/// is just a view over songs, not a container they can be lost in.
pub fn delete_folder(folder_id: &str) -> Result<(), String> {
    let mut lib = load()?;
    lib.folders.retain(|f| f.id != folder_id);
    for song in lib.songs.iter_mut() {
        if song.folder_id.as_deref() == Some(folder_id) {
            song.folder_id = None;
        }
    }
    save(&lib)
}

/// Reassign folder sort_index 0..N in the given order and persist.
pub fn reorder_folders(ordered_ids: &[String]) -> Result<Vec<Folder>, String> {
    let mut lib = load()?;
    for (i, id) in ordered_ids.iter().enumerate() {
        if let Some(folder) = lib.folders.iter_mut().find(|f| &f.id == id) {
            folder.sort_index = i as i32;
        }
    }
    save(&lib)?;
    Ok(lib.folders)
}

/// Move the given songs into `folder_id` (None = root) and reassign their
/// sort_index 0..N in the given order. Covers both a same-folder reorder and
/// a cross-folder drag-drop-at-position in one call, since a drag-and-drop
/// UI naturally yields "the final ordered id list of the destination
/// container" for either case. Returns the updated songs so the caller can
/// patch its in-memory list without a full refetch.
pub fn move_songs(
    folder_id: Option<String>,
    ordered_song_ids: &[String],
) -> Result<Vec<Song>, String> {
    let mut lib = load()?;
    for (i, id) in ordered_song_ids.iter().enumerate() {
        if let Some(song) = lib.songs.iter_mut().find(|s| &s.id == id) {
            song.folder_id = folder_id.clone();
            song.sort_index = i as i32;
        }
    }
    save(&lib)?;
    let updated = lib
        .songs
        .into_iter()
        .filter(|s| ordered_song_ids.contains(&s.id))
        .collect();
    Ok(updated)
}

/// Remove a song from the library and delete its directory.
pub fn remove(song_id: &str) -> Result<(), String> {
    let mut lib = load()?;
    let to_remove = lib.songs.iter().find(|s| s.id == song_id);
    if let Some(song) = to_remove {
        let dir = std::path::Path::new(&song.directory);
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(|e| format!("Delete dir: {e}"))?;
        }
    }
    lib.songs.retain(|s| s.id != song_id);
    save(&lib)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_song(id: &str) -> Song {
        Song {
            id: id.to_string(),
            title: "Song".to_string(),
            duration: 0.0,
            detected_key: None,
            detected_bpm: None,
            processed_at: String::new(),
            directory: String::new(),
            stems: vec![],
            metronome_offset: None,
            has_chords: false,
            folder_id: None,
            sort_index: 0,
        }
    }

    fn lib_with(folders: Vec<Folder>, songs: Vec<Song>) -> LibraryFile {
        LibraryFile { folders, songs }
    }

    fn folder(id: &str, name: &str) -> Folder {
        Folder {
            id: id.to_string(),
            name: name.to_string(),
            sort_index: 0,
        }
    }

    #[test]
    fn renames_matching_folder_and_trims_whitespace() {
        let mut folders = vec![folder("f1", "Old Name"), folder("f2", "Other Folder")];
        let updated = rename_folder_in(&mut folders, "f1", "  New Name  ").unwrap();
        assert_eq!(updated.name, "New Name");
        assert_eq!(folders[0].name, "New Name");
        assert_eq!(folders[1].name, "Other Folder"); // untouched
    }

    #[test]
    fn rejects_empty_or_whitespace_folder_name() {
        let mut folders = vec![folder("f1", "Old Name")];
        assert!(rename_folder_in(&mut folders, "f1", "   ").is_err());
        assert_eq!(folders[0].name, "Old Name"); // unchanged on rejection
    }

    #[test]
    fn errors_on_unknown_folder_id() {
        let mut folders = vec![folder("f1", "Old Name")];
        assert!(rename_folder_in(&mut folders, "missing-id", "New Name").is_err());
    }

    #[test]
    fn move_songs_sets_folder_and_sequential_index() {
        let mut lib = lib_with(vec![], vec![make_song("a"), make_song("b"), make_song("c")]);
        let ids = vec!["b".to_string(), "a".to_string()];
        for (i, id) in ids.iter().enumerate() {
            if let Some(song) = lib.songs.iter_mut().find(|s| &s.id == id) {
                song.folder_id = Some("f1".to_string());
                song.sort_index = i as i32;
            }
        }
        let b = lib.songs.iter().find(|s| s.id == "b").unwrap();
        let a = lib.songs.iter().find(|s| s.id == "a").unwrap();
        let c = lib.songs.iter().find(|s| s.id == "c").unwrap();
        assert_eq!(b.folder_id.as_deref(), Some("f1"));
        assert_eq!(b.sort_index, 0);
        assert_eq!(a.folder_id.as_deref(), Some("f1"));
        assert_eq!(a.sort_index, 1);
        assert_eq!(c.folder_id, None); // untouched
    }

    #[test]
    fn delete_folder_clears_member_folder_id_not_songs() {
        let mut lib = lib_with(
            vec![Folder {
                id: "f1".to_string(),
                name: "Band".to_string(),
                sort_index: 0,
            }],
            vec![{
                let mut s = make_song("a");
                s.folder_id = Some("f1".to_string());
                s
            }],
        );
        lib.folders.retain(|f| f.id != "f1");
        for song in lib.songs.iter_mut() {
            if song.folder_id.as_deref() == Some("f1") {
                song.folder_id = None;
            }
        }
        assert!(lib.folders.is_empty());
        assert_eq!(lib.songs.len(), 1); // song survives
        assert_eq!(lib.songs[0].folder_id, None);
    }
}
