"""
Take (recorded track) file handling for Song Practice Studio.
No pitch/vocal analysis — recording is saved as-is; this module only
handles format conversion for export.
"""

import soundfile as sf
import librosa


def convert_take_to_wav(recording_path: str, output_path: str) -> dict:
    """
    Decode a take (typically .webm/opus) to PCM and write it out as WAV
    for export. Keeps the file's native sample rate and channel count.
    """
    audio, sr = librosa.load(recording_path, sr=None, mono=False)
    data = audio.T if audio.ndim > 1 else audio
    sf.write(output_path, data, sr)
    return {"path": output_path}
