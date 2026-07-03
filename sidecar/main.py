#!/usr/bin/env python3
"""
Song Practice Studio Python Sidecar
Communicates with Tauri shell via JSON lines on stdin/stdout.
Commands execute synchronously on the main thread to avoid GIL/numpy
deadlocks that occur with background threads on Windows.
"""

import os
import sys
import json
import traceback

# When frozen by PyInstaller (--onefile), any bundled ffmpeg binary is
# extracted to sys._MEIPASS on launch. Demucs shells out to a bare `ffmpeg`
# on PATH to decode audio, so without this the installed app fails on every
# file unless the end user happens to have ffmpeg on their system PATH.
if getattr(sys, "frozen", False):
    bundled_dir = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    os.environ["PATH"] = bundled_dir + os.pathsep + os.environ.get("PATH", "")

from processor import process
from recording import convert_take_to_wav


def send(msg: dict):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def make_progress_callback(cmd_name: str):
    def callback(value: float, stage: str):
        send({"type": "progress", "cmd": cmd_name, "stage": stage, "value": round(value, 3)})
    return callback


def main():
    send({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            send({"type": "error", "message": f"Invalid JSON: {line}"})
            continue

        try:
            if cmd.get("cmd") == "process":
                result = process(
                    cmd["filePath"],
                    cmd["outputDir"],
                    stems_to_extract=cmd.get("stemsToExtract"),
                    high_quality=bool(cmd.get("highQuality", False)),
                    on_progress=make_progress_callback("process"),
                )
                send({"type": "result", "cmd": "process", "data": result})

            elif cmd.get("cmd") == "import_yt":
                from yt_importer import import_yt
                result = import_yt(
                    cmd["url"],
                    cmd["outputDir"],
                    stems_to_extract=cmd.get("stemsToExtract"),
                    high_quality=bool(cmd.get("highQuality", False)),
                    on_progress=make_progress_callback("import_yt"),
                )
                send({"type": "result", "cmd": "import_yt", "data": result})

            elif cmd.get("cmd") == "convert_take":
                result = convert_take_to_wav(cmd["recordingPath"], cmd["outputPath"])
                send({"type": "result", "cmd": "convert_take", "data": result})

            elif cmd.get("cmd") == "ping":
                send({"type": "pong"})

            elif cmd.get("cmd") == "quit":
                send({"type": "bye"})
                break

            else:
                send({"type": "error", "message": f"Unknown command: {cmd.get('cmd')}"})

        except Exception as e:
            send({
                "type": "error",
                "cmd": cmd.get("cmd"),
                "message": str(e),
                "traceback": traceback.format_exc(),
            })


if __name__ == "__main__":
    main()
