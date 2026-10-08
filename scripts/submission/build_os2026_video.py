"""Encode the real Electron captures with Chinese system-voice narration.

Run only inside a Conda environment with imageio-ffmpeg installed.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / "tmp/os2026"
OUT = ROOT / "output/os2026"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def run(args):
    result = subprocess.run([FFMPEG, "-hide_banner", "-y", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stderr


def duration(path):
    result = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise ValueError(f"Cannot inspect duration: {path}")
    return float(match[1])*3600+float(match[2])*60+float(match[3])


def build():
    timeline = json.loads((TMP / "timeline.json").read_text())
    authored = json.loads((ROOT / "docs/os2026/demo-scenes.json").read_text())
    by_id = {scene["id"]:scene for scene in authored}
    OUT.mkdir(parents=True, exist_ok=True)
    audio = TMP / "audio"
    audio.mkdir(exist_ok=True)
    concat = []
    cursor = 0.0
    chapters = []
    for index, captured in enumerate(timeline["scenes"]):
        scene = by_id[captured["id"]]
        seconds = (captured["lastFrame"]-captured["firstFrame"])/timeline["fps"]
        if seconds < 5:
            raise ValueError("A full recording is required, not probe screenshots.")
        script = audio / f"{index:02d}.txt"
        source = audio / f"{index:02d}.aiff"
        padded = audio / f"{index:02d}.wav"
        script.write_text(scene["speech"], encoding="utf-8")
        subprocess.run(["say", "-v", "Tingting", "-r", "205", "-f", str(script), "-o", str(source)], check=True)
        original = duration(source)
        speed = max(1.0, original/max(1.0,seconds-1.4))
        if speed > 1.4:
            raise ValueError(f"Narration too long for {scene['id']}: {original:.2f}s / {seconds:.2f}s")
        run(["-i",str(source),"-af",f"atempo={speed:.6f},adelay=450:all=1,apad",
             "-t",f"{seconds:.6f}","-ar","48000","-ac","1",str(padded)])
        concat.append(f"file '{padded.as_posix()}'")
        chapters.append({"id":scene["id"],"title":scene["title"],"startSeconds":round(cursor,3),"durationSeconds":round(seconds,3),"narrationSpeed":round(speed,3)})
        cursor += seconds
    (audio / "concat.txt").write_text("\n".join(concat)+"\n")
    run(["-f","concat","-safe","0","-i",str(audio / "concat.txt"),"-c:a","pcm_s16le",str(audio / "narration.wav")])
    target = OUT / "Chroni_OS2026_Demo.mp4"
    run(["-framerate",str(timeline["fps"]),"-i",str(TMP / "frames/%06d.jpg"),
         "-i",str(audio / "narration.wav"),"-vf","fps=30","-c:v","libx264",
         "-preset","medium","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-b:a","160k",
         "-movflags","+faststart","-shortest","-metadata","title=Chroni - OS2026 core workflow demo",
         "-metadata","comment=Actual production UI and IPC; synthetic data; local rules; Chinese system-voice narration",str(target)])
    # Decode the whole video and audio streams before publishing.
    run(["-v","error","-i",str(target),"-f","null","-"])
    metadata = {"durationSeconds":duration(target),"width":1920,"height":1080,"fps":30,
                "videoCodec":"H.264","audioCodec":"AAC","syntheticData":True,
                "narration":"macOS Tingting system voice; Chinese","chapters":chapters}
    (OUT / "video-metadata.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(metadata,ensure_ascii=False))


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.parse_args()
    build()
