"""
Build the Python sidecar into a standalone executable.
Run: python build.py
Output: dist/song-practice-studio-sidecar-{platform}
"""

import os
import PyInstaller.__main__
import platform

name = "song-practice-studio-sidecar"
system = platform.system().lower()

if system == "darwin":
    suffix = "aarch64-apple-darwin" if platform.machine() == "arm64" else "x86_64-apple-darwin"
elif system == "linux":
    suffix = "x86_64-unknown-linux-gnu"
elif system == "windows":
    suffix = "x86_64-pc-windows-msvc"
else:
    suffix = "unknown"

# Demucs shells out to a bare `ffmpeg` on PATH to decode every input format.
# If a static ffmpeg binary has been staged at vendor/ffmpeg/{suffix}/, bundle
# it into the onefile exe so the installed app doesn't depend on the end
# user having ffmpeg on their system PATH. See main.py for the runtime PATH
# injection that makes the bundled copy discoverable.
ffmpeg_name = "ffmpeg.exe" if system == "windows" else "ffmpeg"
vendored_ffmpeg = os.path.join("vendor", "ffmpeg", suffix, ffmpeg_name)
add_binary_sep = ";" if system == "windows" else ":"

args = [
    "main.py",
    "--onefile",
    f"--name={name}-{suffix}",
    "--hidden-import=demucs",
    "--hidden-import=demucs.api",
    "--hidden-import=demucs.pretrained",
    "--hidden-import=librosa",
    "--hidden-import=soundfile",
    "--hidden-import=numpy",
    "--collect-data=demucs",
    "--collect-all=yt_dlp",
    "--noconfirm",
    "--clean",
]

if os.path.isfile(vendored_ffmpeg):
    args.append(f"--add-binary={vendored_ffmpeg}{add_binary_sep}.")
else:
    print(f"WARNING: no vendored ffmpeg at {vendored_ffmpeg} — sidecar will "
          f"depend on ffmpeg being present on the end user's PATH.")

PyInstaller.__main__.run(args)

print(f"\nSidecar built: dist/{name}-{suffix}")
print("Copy this to src-tauri/binaries/ for Tauri to bundle it.")
