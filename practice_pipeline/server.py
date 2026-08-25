from __future__ import annotations

import json
import ctypes
import hashlib
import html
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave
import uuid
from array import array
from argparse import Namespace
from datetime import datetime
from pathlib import Path
from statistics import median
from typing import Any

from flask import Flask, jsonify, request, send_from_directory
import azure.cognitiveservices.speech as speechsdk

ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = Path(__file__).resolve().parent / "static"
SENTENCES_PATH = Path(__file__).resolve().parent / "sentences.txt"
WORD_ITEMS_PATH = Path(__file__).resolve().parent / "word_items.txt"
SPEAKING_SCRIPTS_PATH = Path(__file__).resolve().parent / "speaking_scripts.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "outputs"
LATEST_OUTPUT_DIR = OUTPUT_DIR / "latest"
TTS_CACHE_DIR = Path(__file__).resolve().parent / "tts_cache"
STT_USD_PER_HOUR = 1.00
PROSODY_USD_PER_HOUR = 0.30
DEFAULT_TTS_VOICE = "en-US-JennyNeural"
DEFAULT_FLAT_TTS_VOICE = "Microsoft Zira Desktop"
FLAT_TTS_PROFILE = "sapi-flat"
REWARD_AUDIO_TEXT = {
    "great": "Great!",
    "unbelievable": "Unbelievable!",
}
XINPUT_DLL = None
XINPUT_LOAD_ERROR = None
XINPUT_BUTTONS = {
    "DPAD_UP": 0x0001,
    "DPAD_DOWN": 0x0002,
    "DPAD_LEFT": 0x0004,
    "DPAD_RIGHT": 0x0008,
    "START": 0x0010,
    "BACK": 0x0020,
    "LEFT_SHOULDER": 0x0100,
    "RIGHT_SHOULDER": 0x0200,
    "A": 0x1000,
    "B": 0x2000,
    "X": 0x4000,
    "Y": 0x8000,
}
FFMPEG_CANDIDATES = [
    ROOT_DIR.parent / "tools" / "ffmpeg.exe",
    ROOT_DIR / "tools" / "ffmpeg.exe",
    ROOT_DIR.parent
    / "bilibili-fav-research"
    / "tools"
    / "ffmpeg"
    / "ffmpeg-8.1-essentials_build"
    / "bin"
    / "ffmpeg.exe",
    Path("ffmpeg"),
]

sys.path.insert(0, str(ROOT_DIR))

from assess_pronunciation import (  # noqa: E402
    build_summary,
    flatten_phonemes,
    flatten_syllables,
    flatten_words,
    load_env_file,
    recognize_continuous,
    recognize_once,
    write_csv,
)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")


class XInputGamepad(ctypes.Structure):
    _fields_ = [
        ("wButtons", ctypes.c_ushort),
        ("bLeftTrigger", ctypes.c_ubyte),
        ("bRightTrigger", ctypes.c_ubyte),
        ("sThumbLX", ctypes.c_short),
        ("sThumbLY", ctypes.c_short),
        ("sThumbRX", ctypes.c_short),
        ("sThumbRY", ctypes.c_short),
    ]


class XInputState(ctypes.Structure):
    _fields_ = [
        ("dwPacketNumber", ctypes.c_ulong),
        ("Gamepad", XInputGamepad),
    ]


def load_xinput():
    global XINPUT_DLL, XINPUT_LOAD_ERROR
    if XINPUT_DLL is not None:
        return XINPUT_DLL
    if XINPUT_LOAD_ERROR is not None:
        return None

    for dll_name in ("xinput1_4.dll", "xinput9_1_0.dll", "xinput1_3.dll"):
        try:
            dll = ctypes.windll.LoadLibrary(dll_name)
            dll.XInputGetState.argtypes = [ctypes.c_uint, ctypes.POINTER(XInputState)]
            dll.XInputGetState.restype = ctypes.c_uint
            XINPUT_DLL = dll
            return XINPUT_DLL
        except Exception as exc:
            XINPUT_LOAD_ERROR = str(exc)
    return None


def read_xinput_controllers() -> dict[str, Any]:
    dll = load_xinput()
    if dll is None:
        return {
            "available": False,
            "error": XINPUT_LOAD_ERROR or "XInput DLL not available",
            "controllers": [],
        }

    controllers = []
    for index in range(4):
        state = XInputState()
        result = dll.XInputGetState(index, ctypes.byref(state))
        if result != 0:
            continue

        buttons = [
            name for name, mask in XINPUT_BUTTONS.items() if state.Gamepad.wButtons & mask
        ]
        controllers.append(
            {
                "index": index,
                "packet": int(state.dwPacketNumber),
                "buttons": buttons,
                "buttonMask": int(state.Gamepad.wButtons),
                "leftTrigger": int(state.Gamepad.bLeftTrigger),
                "rightTrigger": int(state.Gamepad.bRightTrigger),
                "thumbs": {
                    "lx": int(state.Gamepad.sThumbLX),
                    "ly": int(state.Gamepad.sThumbLY),
                    "rx": int(state.Gamepad.sThumbRX),
                    "ry": int(state.Gamepad.sThumbRY),
                },
            }
        )

    return {
        "available": True,
        "controllers": controllers,
    }


def find_ffmpeg() -> Path | str:
    for candidate in FFMPEG_CANDIDATES:
        if candidate == Path("ffmpeg"):
            found = shutil.which("ffmpeg")
            if found:
                return found
            continue
        if candidate.exists():
            return candidate
    raise RuntimeError("ffmpeg not found. Put ffmpeg in PATH or keep the bundled copy available.")


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def read_sentences() -> list[str]:
    return read_lines(SENTENCES_PATH)


def read_word_items() -> list[str]:
    return read_lines(WORD_ITEMS_PATH)


def write_item_lines(path: Path, items: list[Any]) -> list[str]:
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    path.write_text("\n".join(cleaned) + ("\n" if cleaned else ""), encoding="utf-8")
    return cleaned


def read_speaking_scripts() -> list[dict[str, Any]]:
    if not SPEAKING_SCRIPTS_PATH.exists():
        return []
    try:
        payload = json.loads(SPEAKING_SCRIPTS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

    raw_scripts = payload if isinstance(payload, list) else payload.get("scripts", [])
    scripts = []
    for item in raw_scripts:
        if not isinstance(item, dict):
            continue
        script_id = str(item.get("id") or "").strip()
        text = str(item.get("text") or "")
        if not script_id or not text.strip():
            continue
        title = str(item.get("title") or "Untitled script").strip() or "Untitled script"
        scripts.append(
            {
                "id": script_id,
                "title": title[:120],
                "text": text,
                "createdAt": item.get("createdAt"),
                "updatedAt": item.get("updatedAt"),
            }
        )
    return scripts


def write_speaking_scripts(scripts: list[dict[str, Any]]) -> None:
    SPEAKING_SCRIPTS_PATH.write_text(
        json.dumps({"scripts": scripts}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def normalize_script_payload(payload: dict[str, Any]) -> tuple[str | None, str, str]:
    script_id = str(payload.get("id") or "").strip() or None
    title = str(payload.get("title") or "").strip() or "Untitled script"
    text = str(payload.get("text") or "").strip()
    if not text:
        raise ValueError("script text is required")
    if len(text) > 100_000:
        raise ValueError("script text is too long")
    return script_id, title[:120], text


def sentence_cache_key(text: str, voice: str, profile: str = "default") -> str:
    if profile == "default":
        payload = f"{voice}\n{text}".encode("utf-8")
    else:
        payload = f"{voice}\n{profile}\n{text}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:24]


def tts_cache_paths(text: str, voice: str, profile: str = "default") -> tuple[Path, Path]:
    cache_dir = TTS_CACHE_DIR / safe_label(voice, "voice")
    if profile != "default":
        cache_dir = cache_dir / safe_label(profile, "profile")
    cache_key = sentence_cache_key(text, voice, profile)
    return cache_dir / f"{cache_key}.wav", cache_dir / f"{cache_key}.json"


def safe_label(text: str, fallback: str = "recording") -> str:
    value = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in text)
    value = value.strip("_")[:80]
    return value or fallback


def reset_latest_output_dir() -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if LATEST_OUTPUT_DIR.exists():
        resolved = LATEST_OUTPUT_DIR.resolve()
        expected_parent = OUTPUT_DIR.resolve()
        if resolved.parent != expected_parent or resolved.name != "latest":
            raise RuntimeError(f"Refusing to clear unexpected output path: {resolved}")
        shutil.rmtree(resolved)
    LATEST_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return LATEST_OUTPUT_DIR


def monotone_ssml(text: str, voice: str) -> str:
    escaped_text = html.escape(text, quote=False)
    escaped_voice = html.escape(voice, quote=True)
    return f"""<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="{escaped_voice}">
    <prosody rate="medium" pitch="medium" range="x-low">{escaped_text}</prosody>
  </voice>
</speak>"""


def synthesize_sentence_audio(
    text: str,
    voice: str = DEFAULT_TTS_VOICE,
    profile: str = "default",
) -> tuple[Path, bool]:
    load_env_file(ROOT_DIR / ".env")
    speech_key = os.environ.get("SPEECH_KEY")
    speech_region = os.environ.get("SPEECH_REGION")
    if not speech_key or not speech_region:
        raise RuntimeError("SPEECH_KEY and SPEECH_REGION must be set in .env.")

    profile = profile.strip().lower() or "default"
    if profile not in {"default", "monotone"}:
        raise RuntimeError(f"Unsupported TTS profile: {profile}")

    cache_key = sentence_cache_key(text, voice, profile)
    wav_path, meta_path = tts_cache_paths(text, voice, profile)
    wav_path.parent.mkdir(parents=True, exist_ok=True)

    if wav_path.exists():
        return wav_path, True

    speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
    speech_config.speech_synthesis_voice_name = voice
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm
    )

    audio_config = speechsdk.audio.AudioOutputConfig(filename=str(wav_path))
    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config,
    )

    word_boundaries: list[dict[str, Any]] = []

    def collect_word_boundary(evt: Any) -> None:
        duration = getattr(evt, "duration", None)
        duration_ticks = None
        if duration is not None:
            duration_ticks = int(duration.total_seconds() * 10_000_000) if hasattr(duration, "total_seconds") else None
        word_boundaries.append(
            {
                "text": getattr(evt, "text", ""),
                "textOffset": getattr(evt, "text_offset", None),
                "wordLength": getattr(evt, "word_length", None),
                "audioOffsetTicks": getattr(evt, "audio_offset", None),
                "durationTicks": duration_ticks,
                "boundaryType": str(getattr(evt, "boundary_type", "")),
            }
        )

    synthesizer.synthesis_word_boundary.connect(collect_word_boundary)
    if profile == "monotone":
        result = synthesizer.speak_ssml_async(monotone_ssml(text, voice)).get()
    else:
        result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        meta_path.write_text(
            json.dumps(
                {
                    "text": text,
                    "voice": voice,
                    "profile": profile,
                    "cacheKey": cache_key,
                    "createdAt": datetime.now().isoformat(timespec="seconds"),
                    "wordBoundaries": word_boundaries,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return wav_path, False

    if result.reason == speechsdk.ResultReason.Canceled:
        details = speechsdk.SpeechSynthesisCancellationDetails.from_result(result)
        raise RuntimeError(
            f"Speech synthesis canceled: {details.reason}; details: {details.error_details}"
        )

    raise RuntimeError(f"Unexpected synthesis result: {result.reason}")


def synthesize_flat_sapi_audio(
    text: str,
    voice: str = DEFAULT_FLAT_TTS_VOICE,
) -> tuple[Path, bool]:
    profile = FLAT_TTS_PROFILE
    cache_key = sentence_cache_key(text, voice, profile)
    wav_path, meta_path = tts_cache_paths(text, voice, profile)
    wav_path.parent.mkdir(parents=True, exist_ok=True)

    if wav_path.exists():
        return wav_path, True

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as text_file:
        text_file.write(text)
        text_path = Path(text_file.name)

    script = r"""
param(
    [string]$TextPath,
    [string]$OutputPath,
    [string]$VoiceName
)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($VoiceName)
$synth.Rate = 0
$synth.Volume = 100
$synth.SetOutputToWaveFile($OutputPath)
$synth.Speak([System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8))
$synth.Dispose()
"""

    with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8") as script_file:
        script_file.write(script)
        script_path = Path(script_file.name)

    try:
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
                str(text_path),
                str(wav_path),
                voice,
            ],
            text=True,
            capture_output=True,
            timeout=45,
        )
    finally:
        try:
            text_path.unlink(missing_ok=True)
        except OSError:
            pass
        try:
            script_path.unlink(missing_ok=True)
        except OSError:
            pass

    if completed.returncode != 0:
        if wav_path.exists():
            wav_path.unlink(missing_ok=True)
        details = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(f"Local flat voice synthesis failed: {details}")

    if not wav_path.exists():
        raise RuntimeError("Local flat voice synthesis did not create an audio file.")

    meta_path.write_text(
        json.dumps(
            {
                "text": text,
                "voice": voice,
                "profile": profile,
                "source": "windows-sapi",
                "cacheKey": cache_key,
                "createdAt": datetime.now().isoformat(timespec="seconds"),
                "wordBoundaries": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return wav_path, False


def convert_to_wav(input_path: Path, output_path: Path) -> None:
    ffmpeg = find_ffmpeg()
    subprocess.run(
        [
            str(ffmpeg),
            "-y",
            "-i",
            str(input_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-sample_fmt",
            "s16",
            str(output_path),
        ],
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )


def wav_duration_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as wav_file:
        frames = wav_file.getnframes()
        rate = wav_file.getframerate()
    if rate <= 0:
        return 0.0
    return round(frames / float(rate), 3)


def read_wav_samples(path: Path) -> tuple[int, list[float]]:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())

    if sample_width != 2:
        raise RuntimeError(f"Pitch comparison expects 16-bit PCM WAV, got {sample_width * 8}-bit.")

    raw = array("h")
    raw.frombytes(frames)
    if sys.byteorder == "big":
        raw.byteswap()

    if channels > 1:
        samples = [
            sum(raw[index : index + channels]) / (channels * 32768.0)
            for index in range(0, len(raw), channels)
        ]
    else:
        samples = [sample / 32768.0 for sample in raw]
    return rate, samples


def extract_pitch_contour(path: Path) -> dict[str, Any]:
    rate, samples = read_wav_samples(path)
    duration = len(samples) / rate if rate else 0
    frame_size = max(1, int(rate * 0.04))
    hop_size = max(1, int(rate * 0.02))
    min_lag = max(1, int(rate / 450))
    max_lag = max(min_lag + 1, int(rate / 70))
    points: list[dict[str, Any]] = []

    if len(samples) < frame_size:
        return {"duration": duration, "points": points, "medianHz": None}

    for start in range(0, len(samples) - frame_size + 1, hop_size):
        frame = samples[start : start + frame_size]
        energy = sum(value * value for value in frame) / frame_size
        rms = math.sqrt(energy)
        hz = None
        clarity = 0.0

        if rms >= 0.008:
            best_lag = None
            best_corr = -1.0
            lag_limit = min(max_lag, frame_size - 2)
            for lag in range(min_lag, lag_limit + 1):
                count = frame_size - lag
                left_energy = 0.0
                right_energy = 0.0
                corr = 0.0
                for index in range(count):
                    left = frame[index]
                    right = frame[index + lag]
                    corr += left * right
                    left_energy += left * left
                    right_energy += right * right
                denom = math.sqrt(left_energy * right_energy)
                if denom <= 0:
                    continue
                normalized = corr / denom
                if normalized > best_corr:
                    best_corr = normalized
                    best_lag = lag

            if best_lag and best_corr >= 0.32:
                hz = rate / best_lag
                clarity = best_corr

        points.append(
            {
                "time": round((start + frame_size / 2) / rate, 4),
                "hz": round(hz, 2) if hz else None,
                "clarity": round(clarity, 3),
                "rms": round(rms, 5),
            }
        )

    voiced = [point["hz"] for point in points if point["hz"]]
    median_hz = median(voiced) if voiced else None
    if median_hz:
        for point in points:
            point["semitone"] = (
                round(12 * math.log2(point["hz"] / median_hz), 3)
                if point["hz"]
                else None
            )
    else:
        for point in points:
            point["semitone"] = None

    return {
        "duration": round(duration, 3),
        "points": points,
        "medianHz": round(median_hz, 2) if median_hz else None,
    }


def tokenize_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)


def read_tts_meta(meta_path: Path) -> dict[str, Any]:
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def reference_assessment_path(wav_path: Path) -> Path:
    return wav_path.with_suffix(".assessment.json")


def assess_reference_audio_cached(
    reference_text: str,
    wav_path: Path,
    assessment_path: Path,
) -> tuple[dict[str, Any], bool]:
    if assessment_path.exists():
        try:
            return json.loads(assessment_path.read_text(encoding="utf-8")), True
        except json.JSONDecodeError:
            assessment_path.unlink(missing_ok=True)

    load_env_file(ROOT_DIR / ".env")
    args = Namespace(
        audio_file=str(wav_path),
        reference_text=reference_text,
        language="en-US",
        phoneme_alphabet="IPA",
        nbest_phoneme_count=5,
        enable_prosody=False,
        enable_miscue=False,
        output_dir=str(wav_path.parent),
        output_label="flat_reference",
    )
    result_json = recognize_once(args)
    assessment_path.write_text(
        json.dumps(result_json, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result_json, False


def phoneme_timing_rows(result_json: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    words = result_json.get("NBest", [{}])[0].get("Words", [])
    for word_index, word in enumerate(words):
        word_text = word.get("Word", "")
        for phoneme_index, phoneme in enumerate(word.get("Phonemes") or []):
            assessment = phoneme.get("PronunciationAssessment") or {}
            rows.append(
                {
                    "wordIndex": word_index,
                    "phonemeIndex": phoneme_index,
                    "word": word_text,
                    "expected": phoneme.get("Phoneme"),
                    "offset": (phoneme.get("Offset") or 0) / 10_000_000,
                    "duration": (phoneme.get("Duration") or 0) / 10_000_000,
                    "accuracy": assessment.get("AccuracyScore"),
                }
            )
    return rows


def build_phoneme_speed_comparison(
    reference_json: dict[str, Any],
    user_json: dict[str, Any],
) -> dict[str, Any]:
    reference_rows = phoneme_timing_rows(reference_json)
    user_rows = phoneme_timing_rows(user_json)
    reference_by_key = {
        (row["wordIndex"], row["phonemeIndex"]): row
        for row in reference_rows
    }

    rows = []
    fast_count = 0
    slow_count = 0
    matched_count = 0
    ratio_values = []

    for user in user_rows:
        key = (user["wordIndex"], user["phonemeIndex"])
        reference = reference_by_key.get(key)
        ref_duration = reference.get("duration") if reference else None
        user_duration = user.get("duration")
        ratio = None
        status = "missing-reference"
        severity = 0.0
        if (
            isinstance(ref_duration, (int, float))
            and isinstance(user_duration, (int, float))
            and ref_duration > 0.015
            and user_duration > 0
        ):
            matched_count += 1
            ratio = user_duration / ref_duration
            ratio_values.append(ratio)
            if ratio < 0.72:
                status = "too-fast"
                fast_count += 1
                severity = min(1.0, (0.72 - ratio) / 0.42)
            elif ratio > 1.42:
                status = "too-slow"
                slow_count += 1
                severity = min(1.0, (ratio - 1.42) / 0.8)
            else:
                status = "ok"
        rows.append(
            {
                "wordIndex": user["wordIndex"],
                "phonemeIndex": user["phonemeIndex"],
                "word": user.get("word"),
                "expected": user.get("expected"),
                "userDuration": round(user_duration, 3) if isinstance(user_duration, (int, float)) else None,
                "referenceDuration": round(ref_duration, 3) if isinstance(ref_duration, (int, float)) else None,
                "ratio": round(ratio, 2) if isinstance(ratio, (int, float)) else None,
                "status": status,
                "severity": round(severity, 2),
                "accuracy": user.get("accuracy"),
            }
        )

    worst = sorted(
        [row for row in rows if isinstance(row.get("ratio"), (int, float)) and row["status"] != "ok"],
        key=lambda row: (row.get("severity") or 0),
        reverse=True,
    )[:12]
    avg_ratio = sum(ratio_values) / len(ratio_values) if ratio_values else None

    return {
        "summary": {
            "matchedCount": matched_count,
            "fastCount": fast_count,
            "slowCount": slow_count,
            "avgRatio": round(avg_ratio, 2) if avg_ratio is not None else None,
            "referencePhonemeCount": len(reference_rows),
            "userPhonemeCount": len(user_rows),
        },
        "rows": rows,
        "worst": worst,
    }


def boundary_duration_ticks(boundary: dict[str, Any]) -> int | None:
    value = boundary.get("durationTicks")
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    return None


def reference_word_segments(text: str, wav_path: Path, meta_path: Path) -> tuple[list[dict[str, Any]], str]:
    tokens = tokenize_words(text)
    duration = wav_duration_seconds(wav_path)
    meta = read_tts_meta(meta_path)
    boundaries = [
        item
        for item in meta.get("wordBoundaries", [])
        if isinstance(item, dict) and isinstance(item.get("audioOffsetTicks"), (int, float))
    ]

    if boundaries and len(boundaries) >= max(1, len(tokens) - 1):
        segments = []
        for index, token in enumerate(tokens):
            boundary = boundaries[index] if index < len(boundaries) else None
            next_boundary = boundaries[index + 1] if index + 1 < len(boundaries) else None
            if not boundary:
                continue
            start = float(boundary["audioOffsetTicks"]) / 10_000_000
            own_duration = boundary_duration_ticks(boundary)
            if own_duration:
                end = start + own_duration / 10_000_000
            elif next_boundary:
                end = float(next_boundary["audioOffsetTicks"]) / 10_000_000
            else:
                end = duration
            segments.append(
                {
                    "word": boundary.get("text") or token,
                    "start": round(max(0, start), 3),
                    "end": round(max(start + 0.04, min(duration, end)), 3),
                    "duration": round(max(0.04, min(duration, end) - start), 3),
                }
            )
        if segments:
            return segments, "tts-word-boundary"

    weights = [max(1, len(token)) for token in tokens]
    total_weight = sum(weights) or 1
    usable_duration = max(0.2, duration)
    cursor = 0.0
    segments = []
    for index, token in enumerate(tokens):
        word_duration = usable_duration * (weights[index] / total_weight)
        start = cursor
        end = duration if index == len(tokens) - 1 else min(duration, cursor + word_duration)
        segments.append(
            {
                "word": token,
                "start": round(start, 3),
                "end": round(max(start + 0.04, end), 3),
                "duration": round(max(0.04, end - start), 3),
            }
        )
        cursor = end
    return segments, "estimated-from-text-length"


def user_word_segments(result_json: dict[str, Any]) -> list[dict[str, Any]]:
    words = result_json.get("NBest", [{}])[0].get("Words", [])
    segments = []
    for word in words:
        start = (word.get("Offset") or 0) / 10_000_000
        duration = (word.get("Duration") or 0) / 10_000_000
        segments.append(
            {
                "word": word.get("Word", ""),
                "start": round(start, 3),
                "end": round(start + duration, 3),
                "duration": round(duration, 3),
            }
        )
    return segments


def annotate_pitch_points(points: list[dict[str, Any]], segments: list[dict[str, Any]]) -> None:
    for point in points:
        point["wordIndex"] = None
        point["wordPosition"] = None
        time_value = point["time"]
        for index, segment in enumerate(segments):
            if segment["start"] <= time_value <= segment["end"]:
                duration = max(0.001, segment["end"] - segment["start"])
                point["wordIndex"] = index
                point["wordPosition"] = round((time_value - segment["start"]) / duration, 3)
                break


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = max(0.0, min(1.0, q)) * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[int(position)]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def segment_pitch_stats(points: list[dict[str, Any]], segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stats = []
    for index, segment in enumerate(segments):
        segment_points = [
            point
            for point in points
            if point.get("wordIndex") == index and point.get("semitone") is not None
        ]
        semitones = [float(point["semitone"]) for point in segment_points]
        voiced_ratio = len(segment_points) / max(
            1,
            len([point for point in points if segment["start"] <= point["time"] <= segment["end"]]),
        )
        if semitones:
            low = percentile(semitones, 0.1)
            high = percentile(semitones, 0.9)
            range_low = percentile(semitones, 0.2)
            range_high = percentile(semitones, 0.8)
            median_semitone = median(semitones)
            pitch_range = range_high - range_low
        else:
            low = high = median_semitone = pitch_range = None
        stats.append(
            {
                **segment,
                "medianSemitone": round(median_semitone, 2) if median_semitone is not None else None,
                "rangeSemitone": round(pitch_range, 2) if pitch_range is not None else None,
                "lowSemitone": round(low, 2) if low is not None else None,
                "highSemitone": round(high, 2) if high is not None else None,
                "voicedRatio": round(voiced_ratio, 2),
            }
        )
    return stats


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def lower_is_better_score(value: float | None, good: float, bad: float) -> float:
    if value is None or not math.isfinite(value):
        return 50.0
    if bad <= good:
        return 50.0
    return round(clamp((bad - value) / (bad - good), 0.0, 1.0) * 100, 1)


def higher_is_better_score(value: float | None, bad: float, good: float) -> float:
    if value is None or not math.isfinite(value):
        return 50.0
    if good <= bad:
        return 50.0
    return round(clamp((value - bad) / (good - bad), 0.0, 1.0) * 100, 1)


def rms_to_db(value: float | None) -> float | None:
    if value is None or value <= 0:
        return None
    return 20 * math.log10(max(value, 0.000001))


def spread(values: list[float], low_q: float = 0.1, high_q: float = 0.9) -> float | None:
    low = percentile(values, low_q)
    high = percentile(values, high_q)
    if low is None or high is None:
        return None
    return high - low


def pace_ratio(values: list[float]) -> float | None:
    low = percentile(values, 0.15)
    high = percentile(values, 0.85)
    if low is None or high is None or low <= 0:
        return None
    return high / low


def machine_word_stats(points: list[dict[str, Any]], segments: list[dict[str, Any]], global_energy_db: float | None) -> list[dict[str, Any]]:
    words = []
    previous_end = None
    for index, segment in enumerate(segments):
        segment_points = [
            point
            for point in points
            if point.get("wordIndex") == index
        ]
        semitones = [
            float(point["semitone"])
            for point in segment_points
            if point.get("semitone") is not None
        ]
        energies = [
            float(point["rmsDb"])
            for point in segment_points
            if point.get("rmsDb") is not None
        ]
        pitch_range = spread(semitones, 0.2, 0.8)
        energy_median = median(energies) if energies else None
        energy_lift = (
            energy_median - global_energy_db
            if energy_median is not None and global_energy_db is not None
            else None
        )
        gap_before = (
            max(0.0, float(segment["start"]) - previous_end)
            if previous_end is not None
            else None
        )
        previous_end = float(segment["end"])

        flags = []
        if pitch_range is not None and pitch_range > 3.2:
            flags.append("pitch swing")
        if energy_lift is not None and energy_lift > 4.0:
            flags.append("stress peak")
        if gap_before is not None and gap_before > 0.18:
            flags.append("pause")
        if segment.get("duration", 0) > 0.75 and len(str(segment.get("word", ""))) <= 4:
            flags.append("dragged")

        tone = "ok"
        if any(flag in flags for flag in ("pitch swing", "stress peak")) or (gap_before or 0) > 0.28:
            tone = "bad"
        elif flags:
            tone = "warn"

        words.append(
            {
                **segment,
                "index": index,
                "pitchRangeSemitone": round(pitch_range, 2) if pitch_range is not None else None,
                "energyMedianDb": round(energy_median, 1) if energy_median is not None else None,
                "energyLiftDb": round(energy_lift, 1) if energy_lift is not None else None,
                "gapBefore": round(gap_before, 3) if gap_before is not None else None,
                "voicedRatio": round(
                    len(semitones) / max(1, len(segment_points)),
                    2,
                ),
                "flags": flags,
                "tone": tone,
            }
        )
    return words


def build_machine_mode_analysis(user_wav: Path, result_json: dict[str, Any], run_id: str | None = None) -> dict[str, Any]:
    segments = user_word_segments(result_json)
    pitch = extract_pitch_contour(user_wav)
    annotate_pitch_points(pitch["points"], segments)

    for point in pitch["points"]:
        point["rmsDb"] = round(rms_to_db(point.get("rms")) or -90.0, 1)

    voiced_points = [
        point for point in pitch["points"] if point.get("semitone") is not None
    ]
    semitones = [float(point["semitone"]) for point in voiced_points]
    energy_values = [
        float(point["rmsDb"])
        for point in pitch["points"]
        if point.get("rmsDb") is not None and point.get("rms", 0) >= 0.004
    ]
    global_energy_db = median(energy_values) if energy_values else None
    word_stats = machine_word_stats(pitch["points"], segments, global_energy_db)

    if segments:
        active_start = float(segments[0]["start"])
        active_end = float(segments[-1]["end"])
    else:
        active_start = 0.0
        active_end = float(pitch["duration"] or 0.0)
    active_duration = max(0.001, active_end - active_start)

    gaps = [
        max(0.0, float(segments[index]["start"]) - float(segments[index - 1]["end"]))
        for index in range(1, len(segments))
    ]
    longest_gap = max(gaps) if gaps else 0.0
    pause_count = len([gap for gap in gaps if gap > 0.16])

    normalized_paces = [
        float(segment["duration"]) / max(1.0, len(str(segment.get("word", ""))) ** 0.65)
        for segment in segments
        if float(segment.get("duration") or 0) > 0
    ]
    pace_spread = pace_ratio(normalized_paces)
    pitch_range = spread(semitones, 0.1, 0.9)
    energy_range = spread(energy_values, 0.1, 0.9)
    voiced_ratio = len(voiced_points) / max(1, len(pitch["points"]))
    median_rms = median([float(point["rms"]) for point in pitch["points"]]) if pitch["points"] else None

    pitch_score = lower_is_better_score(pitch_range, 2.0, 8.0)
    stress_score = lower_is_better_score(energy_range, 7.0, 22.0)
    speed_score = lower_is_better_score(pace_spread, 1.45, 3.2)
    smooth_score = round(
        0.65 * lower_is_better_score(longest_gap, 0.08, 0.38)
        + 0.35 * lower_is_better_score(pause_count / max(1, len(segments) - 1), 0.0, 0.35),
        1,
    )
    clarity_score = round(
        0.65 * higher_is_better_score(voiced_ratio, 0.18, 0.45)
        + 0.35 * higher_is_better_score(median_rms, 0.004, 0.018),
        1,
    )
    machine_score = round(
        0.34 * pitch_score
        + 0.22 * stress_score
        + 0.20 * speed_score
        + 0.16 * smooth_score
        + 0.08 * clarity_score,
        1,
    )

    if semitones:
        y_min = max(-12, (percentile(semitones, 0.05) or min(semitones)) - 1)
        y_max = min(12, (percentile(semitones, 0.95) or max(semitones)) + 1)
        if y_max - y_min < 6:
            center = (y_min + y_max) / 2
            y_min, y_max = center - 3, center + 3
    else:
        y_min, y_max = -6, 6

    if energy_values:
        energy_min = (percentile(energy_values, 0.05) or min(energy_values)) - 2
        energy_max = (percentile(energy_values, 0.95) or max(energy_values)) + 2
        if energy_max - energy_min < 12:
            center = (energy_min + energy_max) / 2
            energy_min, energy_max = center - 6, center + 6
    else:
        energy_min, energy_max = -60, -20

    flagged_words = [word for word in word_stats if word["flags"]]

    return {
        "runId": run_id,
        "target": "PTE RS/RA monotone speech: minimal pitch movement, low stress peaks, fixed speed, smooth flow, enough clarity.",
        "summary": {
            "machineScore": machine_score,
            "pitchFlatnessScore": pitch_score,
            "lowStressScore": stress_score,
            "speedLockScore": speed_score,
            "smoothFlowScore": smooth_score,
            "clarityFloorScore": clarity_score,
            "pitchRangeSemitone": round(pitch_range, 2) if pitch_range is not None else None,
            "energyRangeDb": round(energy_range, 1) if energy_range is not None else None,
            "paceSpread": round(pace_spread, 2) if pace_spread is not None else None,
            "longestGap": round(longest_gap, 3),
            "pauseCount": pause_count,
            "wordsPerMinute": round(len(segments) / active_duration * 60, 1) if segments else None,
            "voicedRatio": round(voiced_ratio, 2),
            "medianHz": pitch["medianHz"],
            "duration": pitch["duration"],
            "flaggedWordCount": len(flagged_words),
        },
        "words": word_stats,
        "flaggedWords": flagged_words[:12],
        "contour": {
            "duration": pitch["duration"],
            "medianHz": pitch["medianHz"],
            "points": pitch["points"],
        },
        "yMin": round(y_min, 2),
        "yMax": round(y_max, 2),
        "energyMinDb": round(energy_min, 1),
        "energyMaxDb": round(energy_max, 1),
    }


def build_pitch_comparison(reference_text: str, reference_wav: Path, reference_meta: Path, user_wav: Path, result_json: dict[str, Any]) -> dict[str, Any]:
    reference_segments, boundary_source = reference_word_segments(reference_text, reference_wav, reference_meta)
    user_segments = user_word_segments(result_json)
    reference_pitch = extract_pitch_contour(reference_wav)
    user_pitch = extract_pitch_contour(user_wav)
    annotate_pitch_points(reference_pitch["points"], reference_segments)
    annotate_pitch_points(user_pitch["points"], user_segments)
    reference_words = segment_pitch_stats(reference_pitch["points"], reference_segments)
    user_words = segment_pitch_stats(user_pitch["points"], user_segments)

    comparison = []
    count = max(len(reference_words), len(user_words))
    for index in range(count):
        ref = reference_words[index] if index < len(reference_words) else None
        user = user_words[index] if index < len(user_words) else None
        ref_range = ref.get("rangeSemitone") if ref else None
        user_range = user.get("rangeSemitone") if user else None
        ref_median = ref.get("medianSemitone") if ref else None
        user_median = user.get("medianSemitone") if user else None
        range_gap = (
            round(user_range - ref_range, 2)
            if isinstance(ref_range, (int, float)) and isinstance(user_range, (int, float))
            else None
        )
        median_gap = (
            round(user_median - ref_median, 2)
            if isinstance(ref_median, (int, float)) and isinstance(user_median, (int, float))
            else None
        )
        note = "OK"
        if range_gap is not None and range_gap <= -1.5:
            note = "flatter than reference"
        elif median_gap is not None and abs(median_gap) >= 3:
            note = "pitch level differs"
        elif user and user.get("voicedRatio", 1) < 0.35:
            note = "weak pitch detection"
        comparison.append(
            {
                "index": index,
                "word": (user or ref or {}).get("word", ""),
                "referenceWord": ref,
                "userWord": user,
                "rangeGapSemitone": range_gap,
                "medianGapSemitone": median_gap,
                "note": note,
            }
        )

    all_semitones = [
        point["semitone"]
        for point in [*reference_pitch["points"], *user_pitch["points"]]
        if point.get("wordIndex") is not None and point.get("semitone") is not None
    ]
    if all_semitones:
        low_bound = percentile([float(value) for value in all_semitones], 0.05)
        high_bound = percentile([float(value) for value in all_semitones], 0.95)
        y_min = max(-12, (low_bound if low_bound is not None else min(all_semitones)) - 1)
        y_max = min(12, (high_bound if high_bound is not None else max(all_semitones)) + 1)
        if y_max - y_min < 4:
            center = (y_min + y_max) / 2
            y_min, y_max = center - 2, center + 2
    else:
        y_min, y_max = -6, 6

    return {
        "reference": {
            "duration": reference_pitch["duration"],
            "medianHz": reference_pitch["medianHz"],
            "words": reference_words,
            "contour": reference_pitch["points"],
            "boundarySource": boundary_source,
        },
        "user": {
            "duration": user_pitch["duration"],
            "medianHz": user_pitch["medianHz"],
            "words": user_words,
            "contour": user_pitch["points"],
        },
        "comparison": comparison,
        "yMin": round(y_min, 2),
        "yMax": round(y_max, 2),
    }


def estimate_cost(audio_seconds: float, prosody_enabled: bool) -> dict[str, float]:
    hours = audio_seconds / 3600.0
    stt_cost = hours * STT_USD_PER_HOUR
    prosody_cost = hours * PROSODY_USD_PER_HOUR if prosody_enabled else 0.0
    return {
        "audioSeconds": round(audio_seconds, 3),
        "billableHours": round(hours, 6),
        "speechToTextUsd": round(stt_cost, 6),
        "prosodyUsd": round(prosody_cost, 6),
        "estimatedTotalUsd": round(stt_cost + prosody_cost, 6),
        "rates": {
            "speechToTextUsdPerHour": STT_USD_PER_HOUR,
            "prosodyUsdPerHour": PROSODY_USD_PER_HOUR,
        },
    }


def save_result_files(run_dir: Path, result_json: dict[str, Any]) -> dict[str, str]:
    raw_path = run_dir / "raw.json"
    summary_path = run_dir / "summary.json"
    words_path = run_dir / "words.csv"
    phonemes_path = run_dir / "phonemes.csv"
    syllables_path = run_dir / "syllables.csv"

    raw_path.write_text(json.dumps(result_json, ensure_ascii=False, indent=2), encoding="utf-8")
    summary_path.write_text(
        json.dumps(build_summary(result_json), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(words_path, flatten_words(result_json))
    write_csv(phonemes_path, flatten_phonemes(result_json))
    write_csv(syllables_path, flatten_syllables(result_json))

    return {
        "rawJson": "raw.json",
        "summaryJson": "summary.json",
        "wordsCsv": "words.csv",
        "phonemesCsv": "phonemes.csv",
        "syllablesCsv": "syllables.csv",
    }


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/read")
def read_aloud():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/repeat")
def repeat_sentence():
    return send_from_directory(STATIC_DIR, "repeat.html")


@app.get("/words")
def word_practice():
    return send_from_directory(STATIC_DIR, "words.html")


@app.get("/speaking")
def free_speaking_practice():
    return send_from_directory(STATIC_DIR, "speaking.html")


@app.get("/api/health")
def health():
    load_env_file(ROOT_DIR / ".env")
    return jsonify(
        {
            "ok": True,
            "sentenceCount": len(read_sentences()),
            "wordItemCount": len(read_word_items()),
            "hasSpeechKey": bool(os.environ.get("SPEECH_KEY")),
            "ffmpeg": str(find_ffmpeg()),
            "ttsCacheCount": len(list(TTS_CACHE_DIR.glob("**/*.wav"))) if TTS_CACHE_DIR.exists() else 0,
        }
    )


@app.get("/api/sentences")
def sentences():
    return jsonify({"sentences": read_sentences()})


@app.post("/api/sentences")
def update_sentences():
    payload = request.get_json(force=True, silent=True) or {}
    incoming = payload.get("sentences")
    if not isinstance(incoming, list):
        return jsonify({"error": "sentences must be a list"}), 400

    cleaned = write_item_lines(SENTENCES_PATH, incoming)
    return jsonify({"sentences": cleaned})


@app.get("/api/word-items")
def word_items():
    return jsonify({"items": read_word_items()})


@app.get("/api/xinput-state")
def xinput_state():
    return jsonify(read_xinput_controllers())


@app.post("/api/word-items")
def update_word_items():
    payload = request.get_json(force=True, silent=True) or {}
    incoming = payload.get("items")
    if incoming is None:
        incoming = payload.get("sentences")
    if not isinstance(incoming, list):
        return jsonify({"error": "items must be a list"}), 400

    cleaned = write_item_lines(WORD_ITEMS_PATH, incoming)
    return jsonify({"items": cleaned})


@app.get("/api/speaking-scripts")
def speaking_scripts():
    return jsonify({"scripts": read_speaking_scripts()})


@app.post("/api/speaking-scripts")
def save_speaking_script():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        script_id, title, text = normalize_script_payload(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    scripts = read_speaking_scripts()
    now = datetime.now().isoformat(timespec="seconds")
    saved_script = None
    for index, item in enumerate(scripts):
        if script_id and item.get("id") == script_id:
            saved_script = {
                **item,
                "title": title,
                "text": text,
                "updatedAt": now,
            }
            scripts[index] = saved_script
            break

    if saved_script is None:
        saved_script = {
            "id": script_id or uuid.uuid4().hex,
            "title": title,
            "text": text,
            "createdAt": now,
            "updatedAt": now,
        }
        scripts.insert(0, saved_script)

    write_speaking_scripts(scripts)
    return jsonify({"script": saved_script, "scripts": scripts})


@app.delete("/api/speaking-scripts/<script_id>")
def delete_speaking_script(script_id: str):
    scripts = read_speaking_scripts()
    remaining = [item for item in scripts if item.get("id") != script_id]
    if len(remaining) == len(scripts):
        return jsonify({"error": "script not found"}), 404
    write_speaking_scripts(remaining)
    return jsonify({"scripts": remaining})


@app.get("/api/tts/<int:sentence_index>")
def tts(sentence_index: int):
    sentences_list = read_sentences()
    if sentence_index < 0 or sentence_index >= len(sentences_list):
        return jsonify({"error": "sentence index out of range"}), 404

    voice = (request.args.get("voice") or DEFAULT_TTS_VOICE).strip()
    try:
        wav_path, cached = synthesize_sentence_audio(sentences_list[sentence_index], voice)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    relative = wav_path.relative_to(TTS_CACHE_DIR).as_posix()
    return jsonify(
        {
            "audioUrl": f"/tts-cache/{relative}",
            "cached": cached,
            "voice": voice,
            "sentenceIndex": sentence_index,
        }
    )


@app.get("/api/tts-monotone/<int:sentence_index>")
def tts_monotone(sentence_index: int):
    sentences_list = read_sentences()
    if sentence_index < 0 or sentence_index >= len(sentences_list):
        return jsonify({"error": "sentence index out of range"}), 404

    voice = (request.args.get("voice") or DEFAULT_FLAT_TTS_VOICE).strip()
    try:
        wav_path, cached = synthesize_flat_sapi_audio(sentences_list[sentence_index], voice)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    relative = wav_path.relative_to(TTS_CACHE_DIR).as_posix()
    return jsonify(
        {
            "audioUrl": f"/tts-cache/{relative}",
            "cached": cached,
            "voice": voice,
            "profile": FLAT_TTS_PROFILE,
            "source": "windows-sapi",
            "sentenceIndex": sentence_index,
        }
    )


@app.get("/api/word-tts/<int:item_index>")
def word_tts(item_index: int):
    items = read_word_items()
    if item_index < 0 or item_index >= len(items):
        return jsonify({"error": "word item index out of range"}), 404

    voice = (request.args.get("voice") or DEFAULT_TTS_VOICE).strip()
    try:
        wav_path, cached = synthesize_sentence_audio(items[item_index], voice)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    relative = wav_path.relative_to(TTS_CACHE_DIR).as_posix()
    return jsonify(
        {
            "audioUrl": f"/tts-cache/{relative}",
            "cached": cached,
            "voice": voice,
            "itemIndex": item_index,
        }
    )


@app.get("/api/reward-audio/<reward_name>")
def reward_audio(reward_name: str):
    reward_key = reward_name.strip().lower()
    reward_text = REWARD_AUDIO_TEXT.get(reward_key)
    if reward_text is None:
        return jsonify({"error": "reward must be great or unbelievable"}), 404

    voice = (request.args.get("voice") or DEFAULT_TTS_VOICE).strip()
    try:
        wav_path, cached = synthesize_sentence_audio(reward_text, voice)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    relative = wav_path.relative_to(TTS_CACHE_DIR).as_posix()
    return jsonify(
        {
            "audioUrl": f"/tts-cache/{relative}",
            "cached": cached,
            "reward": reward_key,
            "text": reward_text,
            "voice": voice,
        }
    )


@app.post("/api/tts-text")
def tts_text():
    payload = request.get_json(force=True, silent=True) or {}
    text = (payload.get("text") or request.form.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400
    if len(text) > 500:
        return jsonify({"error": "text is too long for a single sentence TTS request"}), 400

    voice = (payload.get("voice") or request.form.get("voice") or DEFAULT_TTS_VOICE).strip()
    try:
        wav_path, cached = synthesize_sentence_audio(text, voice)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    relative = wav_path.relative_to(TTS_CACHE_DIR).as_posix()
    return jsonify(
        {
            "audioUrl": f"/tts-cache/{relative}",
            "cached": cached,
            "voice": voice,
            "text": text,
        }
    )


@app.get("/api/prosody-compare/latest")
def prosody_compare_latest():
    voice = (request.args.get("voice") or DEFAULT_TTS_VOICE).strip()
    raw_path = LATEST_OUTPUT_DIR / "raw.json"
    run_info_path = LATEST_OUTPUT_DIR / "run_info.json"
    user_wav = LATEST_OUTPUT_DIR / "recording_16k_mono.wav"

    if not raw_path.exists() or not run_info_path.exists() or not user_wav.exists():
        return jsonify({"error": "No latest assessment run is available yet."}), 404

    try:
        result_json = json.loads(raw_path.read_text(encoding="utf-8"))
        run_info = json.loads(run_info_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return jsonify({"error": f"Latest run JSON is invalid: {exc}"}), 500

    reference_text = (run_info.get("referenceText") or "").strip()
    if not reference_text:
        return jsonify({"error": "Latest run is missing reference text."}), 400

    reference_wav, reference_meta = tts_cache_paths(reference_text, voice)
    if not reference_wav.exists():
        return (
            jsonify(
                {
                    "error": "Reference Azure audio is not cached yet. Play the prompt audio once, then build pitch comparison again.",
                    "needsPromptAudio": True,
                    "voice": voice,
                }
            ),
            404,
        )

    try:
        comparison = build_pitch_comparison(reference_text, reference_wav, reference_meta, user_wav, result_json)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    relative = reference_wav.relative_to(TTS_CACHE_DIR).as_posix()
    comparison.update(
        {
            "referenceText": reference_text,
            "voice": voice,
            "referenceAudioUrl": f"/tts-cache/{relative}",
            "userAudioUrl": "/runs/latest/recording_16k_mono.wav",
            "runId": run_info.get("runId"),
        }
    )
    return jsonify(comparison)


@app.get("/api/machine-mode/latest")
def machine_mode_latest():
    raw_path = LATEST_OUTPUT_DIR / "raw.json"
    run_info_path = LATEST_OUTPUT_DIR / "run_info.json"
    user_wav = LATEST_OUTPUT_DIR / "recording_16k_mono.wav"

    if not raw_path.exists() or not run_info_path.exists() or not user_wav.exists():
        return jsonify({"error": "No latest assessment run is available yet."}), 404

    try:
        result_json = json.loads(raw_path.read_text(encoding="utf-8"))
        run_info = json.loads(run_info_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return jsonify({"error": f"Latest run JSON is invalid: {exc}"}), 500

    if run_info.get("mode") != "scripted":
        return jsonify({"error": "Monotone Speech analysis is currently for Read Aloud and Repeat Sentence scripted runs only."}), 400

    try:
        analysis = build_machine_mode_analysis(user_wav, result_json, run_info.get("runId"))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    analysis.update(
        {
            "referenceText": run_info.get("referenceText", ""),
            "sentenceIndex": run_info.get("sentenceIndex"),
            "userAudioUrl": "/runs/latest/recording_16k_mono.wav",
        }
    )
    return jsonify(analysis)


@app.get("/api/phoneme-speed/latest")
def phoneme_speed_latest():
    raw_path = LATEST_OUTPUT_DIR / "raw.json"
    run_info_path = LATEST_OUTPUT_DIR / "run_info.json"
    if not raw_path.exists() or not run_info_path.exists():
        return jsonify({"error": "No latest assessment run is available yet."}), 404

    try:
        user_json = json.loads(raw_path.read_text(encoding="utf-8"))
        run_info = json.loads(run_info_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return jsonify({"error": f"Latest run JSON is invalid: {exc}"}), 500

    if run_info.get("mode") != "scripted":
        return jsonify({"error": "Phoneme speed comparison is only available for scripted Repeat Sentence runs."}), 400

    reference_text = (run_info.get("referenceText") or "").strip()
    if not reference_text:
        return jsonify({"error": "Latest run is missing reference text."}), 400

    voice = (request.args.get("voice") or DEFAULT_FLAT_TTS_VOICE).strip()
    try:
        reference_wav, reference_audio_cached = synthesize_flat_sapi_audio(reference_text, voice)
        assessment_path = reference_assessment_path(reference_wav)
        reference_json, reference_assessment_cached = assess_reference_audio_cached(
            reference_text,
            reference_wav,
            assessment_path,
        )
        comparison = build_phoneme_speed_comparison(reference_json, user_json)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    relative = reference_wav.relative_to(TTS_CACHE_DIR).as_posix()
    comparison.update(
        {
            "runId": run_info.get("runId"),
            "referenceText": reference_text,
            "sentenceIndex": run_info.get("sentenceIndex"),
            "voice": voice,
            "source": "windows-sapi",
            "profile": FLAT_TTS_PROFILE,
            "referenceAudioUrl": f"/tts-cache/{relative}",
            "referenceAudioCached": reference_audio_cached,
            "referenceAssessmentCached": reference_assessment_cached,
        }
    )
    return jsonify(comparison)


@app.get("/api/latest-result")
def latest_result():
    raw_path = LATEST_OUTPUT_DIR / "raw.json"
    run_info_path = LATEST_OUTPUT_DIR / "run_info.json"
    user_wav = LATEST_OUTPUT_DIR / "recording_16k_mono.wav"
    if not raw_path.exists() or not run_info_path.exists() or not user_wav.exists():
        return jsonify({"error": "No latest assessment run is available yet."}), 404

    try:
        result_json = json.loads(raw_path.read_text(encoding="utf-8"))
        run_info = json.loads(run_info_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return jsonify({"error": f"Latest run JSON is invalid: {exc}"}), 500

    audio_seconds = wav_duration_seconds(user_wav)
    files = {
        "rawJson": "/runs/latest/raw.json",
        "summaryJson": "/runs/latest/summary.json",
        "wordsCsv": "/runs/latest/words.csv",
        "phonemesCsv": "/runs/latest/phonemes.csv",
        "syllablesCsv": "/runs/latest/syllables.csv",
    }
    return jsonify(
        {
            "runId": run_info.get("runId", "latest"),
            "mode": run_info.get("mode", "scripted"),
            "sentenceIndex": run_info.get("sentenceIndex"),
            "referenceText": run_info.get("referenceText", ""),
            "audioUrl": "/runs/latest/recording_16k_mono.wav",
            "uploadedAudioUrl": "/runs/latest/recording.weba",
            "files": files,
            "storagePolicy": "latest-only",
            "cost": estimate_cost(audio_seconds, True),
            "summary": build_summary(result_json),
            "raw": result_json,
            "words": flatten_words(result_json),
            "phonemes": flatten_phonemes(result_json),
            "syllables": flatten_syllables(result_json),
        }
    )


@app.post("/api/assess")
def assess():
    load_env_file(ROOT_DIR / ".env")

    reference_text = (request.form.get("referenceText") or "").strip()
    if not reference_text:
        return jsonify({"error": "referenceText is required"}), 400

    audio = request.files.get("audio")
    if audio is None:
        return jsonify({"error": "audio file is required"}), 400

    sentence_index = request.form.get("sentenceIndex", "0")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"latest_{timestamp}_{safe_label(sentence_index, 'sentence')}_{uuid.uuid4().hex[:8]}"
    run_dir = reset_latest_output_dir()
    (run_dir / "run_info.json").write_text(
        json.dumps(
            {
                "runId": run_id,
                "mode": "scripted",
                "sentenceIndex": sentence_index,
                "referenceText": reference_text,
                "createdAt": timestamp,
                "storagePolicy": "latest-only",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    uploaded_ext = mimetypes.guess_extension(audio.mimetype or "") or ".webm"
    uploaded_path = run_dir / f"recording{uploaded_ext}"
    wav_path = run_dir / "recording_16k_mono.wav"
    audio.save(uploaded_path)

    try:
        convert_to_wav(uploaded_path, wav_path)

        prosody_enabled = request.form.get("enableProsody", "true").lower() == "true"
        args = Namespace(
            audio_file=str(wav_path),
            reference_text=reference_text,
            language=request.form.get("language", "en-US"),
            phoneme_alphabet=request.form.get("phonemeAlphabet", "IPA"),
            nbest_phoneme_count=int(request.form.get("nbestPhonemeCount", "5")),
            enable_prosody=prosody_enabled,
            enable_miscue=request.form.get("enableMiscue", "true").lower() == "true",
            output_dir=str(run_dir),
            output_label="practice",
        )
        result_json = recognize_once(args)
        audio_seconds = wav_duration_seconds(wav_path)
        cost = estimate_cost(audio_seconds, prosody_enabled)
        files = save_result_files(run_dir, result_json)
    except subprocess.CalledProcessError as exc:
        return (
            jsonify(
                {
                    "error": "ffmpeg conversion failed",
                    "details": exc.stderr[-3000:],
                }
            ),
            500,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify(
        {
            "runId": run_id,
            "mode": "scripted",
            "referenceText": reference_text,
            "audioUrl": "/runs/latest/recording_16k_mono.wav",
            "uploadedAudioUrl": f"/runs/latest/{uploaded_path.name}",
            "files": {name: f"/runs/latest/{filename}" for name, filename in files.items()},
            "storagePolicy": "latest-only",
            "cost": cost,
            "summary": build_summary(result_json),
            "raw": result_json,
            "words": flatten_words(result_json),
            "phonemes": flatten_phonemes(result_json),
            "syllables": flatten_syllables(result_json),
        }
    )


@app.post("/api/assess-speaking")
def assess_speaking():
    load_env_file(ROOT_DIR / ".env")

    audio = request.files.get("audio")
    if audio is None:
        return jsonify({"error": "audio file is required"}), 400

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"latest_{timestamp}_speaking_{uuid.uuid4().hex[:8]}"
    run_dir = reset_latest_output_dir()
    topic_hint = (request.form.get("topicHint") or "").strip()
    (run_dir / "run_info.json").write_text(
        json.dumps(
            {
                "runId": run_id,
                "mode": "speaking",
                "sentenceIndex": "speaking",
                "referenceText": "",
                "topicHint": topic_hint,
                "createdAt": timestamp,
                "storagePolicy": "latest-only",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    uploaded_ext = mimetypes.guess_extension(audio.mimetype or "") or ".webm"
    uploaded_path = run_dir / f"recording{uploaded_ext}"
    wav_path = run_dir / "recording_16k_mono.wav"
    audio.save(uploaded_path)

    try:
        convert_to_wav(uploaded_path, wav_path)

        prosody_enabled = request.form.get("enableProsody", "true").lower() == "true"
        audio_seconds = wav_duration_seconds(wav_path)
        args = Namespace(
            audio_file=str(wav_path),
            reference_text="",
            language=request.form.get("language", "en-US"),
            phoneme_alphabet=request.form.get("phonemeAlphabet", "IPA"),
            nbest_phoneme_count=int(request.form.get("nbestPhonemeCount", "5")),
            enable_prosody=prosody_enabled,
            enable_miscue=False,
            max_wait_seconds=max(90, int(math.ceil(audio_seconds + 45))),
            output_dir=str(run_dir),
            output_label="speaking",
        )
        result_json = recognize_continuous(args)
        cost = estimate_cost(audio_seconds, prosody_enabled)
        files = save_result_files(run_dir, result_json)
    except subprocess.CalledProcessError as exc:
        return (
            jsonify(
                {
                    "error": "ffmpeg conversion failed",
                    "details": exc.stderr[-3000:],
                }
            ),
            500,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify(
        {
            "runId": run_id,
            "mode": "speaking",
            "referenceText": "",
            "topicHint": topic_hint,
            "audioUrl": "/runs/latest/recording_16k_mono.wav",
            "uploadedAudioUrl": f"/runs/latest/{uploaded_path.name}",
            "files": {name: f"/runs/latest/{filename}" for name, filename in files.items()},
            "storagePolicy": "latest-only",
            "cost": cost,
            "summary": build_summary(result_json),
            "raw": result_json,
            "words": flatten_words(result_json),
            "phonemes": flatten_phonemes(result_json),
            "syllables": flatten_syllables(result_json),
        }
    )


@app.get("/runs/<path:filename>")
def runs(filename: str):
    response = send_from_directory(OUTPUT_DIR, filename)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/tts-cache/<path:filename>")
def tts_cache(filename: str):
    return send_from_directory(TTS_CACHE_DIR, filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8765, debug=False)
