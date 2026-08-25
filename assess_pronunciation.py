from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import azure.cognitiveservices.speech as speechsdk
except ImportError:
    print(
        "Missing dependency: azure-cognitiveservices-speech. "
        "Run: pip install -r requirements.txt",
        file=sys.stderr,
    )
    raise


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


TICKS_PER_SECOND = 10_000_000


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def ticks_to_seconds(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value) / TICKS_PER_SECOND, 6)
    except (TypeError, ValueError):
        return None


def first_nbest(result_json: dict[str, Any]) -> dict[str, Any]:
    nbest = result_json.get("NBest") or []
    if not nbest:
        return {}
    return nbest[0] or {}


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_summary(result_json: dict[str, Any]) -> dict[str, Any]:
    nbest = first_nbest(result_json)
    return {
        "id": result_json.get("Id"),
        "recognition_status": result_json.get("RecognitionStatus"),
        "channel": result_json.get("Channel"),
        "display_text": result_json.get("DisplayText"),
        "offset_ticks": result_json.get("Offset"),
        "offset_seconds": ticks_to_seconds(result_json.get("Offset")),
        "duration_ticks": result_json.get("Duration"),
        "duration_seconds": ticks_to_seconds(result_json.get("Duration")),
        "snr": result_json.get("SNR"),
        "nbest_confidence": nbest.get("Confidence"),
        "lexical": nbest.get("Lexical"),
        "itn": nbest.get("ITN"),
        "masked_itn": nbest.get("MaskedITN"),
        "display": nbest.get("Display"),
        "pronunciation_assessment": nbest.get("PronunciationAssessment") or {},
    }


def flatten_words(result_json: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    nbest = first_nbest(result_json)

    for word_index, word in enumerate(nbest.get("Words") or []):
        assessment = word.get("PronunciationAssessment") or {}
        feedback = assessment.get("Feedback") or {}
        prosody = feedback.get("Prosody") or {}
        break_info = prosody.get("Break") or {}
        intonation = prosody.get("Intonation") or {}
        monotone = intonation.get("Monotone") or {}
        unexpected_break = break_info.get("UnexpectedBreak") or {}
        missing_break = break_info.get("MissingBreak") or {}

        rows.append(
            {
                "word_index": word_index,
                "word": word.get("Word"),
                "offset_ticks": word.get("Offset"),
                "offset_seconds": ticks_to_seconds(word.get("Offset")),
                "duration_ticks": word.get("Duration"),
                "duration_seconds": ticks_to_seconds(word.get("Duration")),
                "recognition_confidence": word.get("Confidence"),
                "accuracy": assessment.get("AccuracyScore"),
                "error_type": assessment.get("ErrorType"),
                "phoneme_count": len(word.get("Phonemes") or []),
                "syllable_count": len(word.get("Syllables") or []),
                "prosody_break_error_types": compact_json(
                    break_info.get("ErrorTypes") or []
                ),
                "prosody_break_length": break_info.get("BreakLength"),
                "unexpected_break_confidence": unexpected_break.get("Confidence"),
                "missing_break_confidence": missing_break.get("Confidence"),
                "intonation_error_types": compact_json(
                    intonation.get("ErrorTypes") or []
                ),
                "monotone_syllable_pitch_delta_confidence": monotone.get(
                    "SyllablePitchDeltaConfidence"
                ),
                "feedback_json": compact_json(feedback) if feedback else "",
            }
        )

    return rows


def flatten_phonemes(result_json: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    nbest = first_nbest(result_json)

    for word_index, word in enumerate(nbest.get("Words") or []):
        word_assessment = word.get("PronunciationAssessment") or {}
        for phoneme_index, phoneme in enumerate(word.get("Phonemes") or []):
            phoneme_assessment = phoneme.get("PronunciationAssessment") or {}
            candidates = phoneme_assessment.get("NBestPhonemes") or []
            best_candidate = candidates[0] if candidates else {}

            rows.append(
                {
                    "word_index": word_index,
                    "word": word.get("Word"),
                    "word_offset_ticks": word.get("Offset"),
                    "word_offset_seconds": ticks_to_seconds(word.get("Offset")),
                    "word_duration_ticks": word.get("Duration"),
                    "word_duration_seconds": ticks_to_seconds(word.get("Duration")),
                    "word_accuracy": word_assessment.get("AccuracyScore"),
                    "word_error_type": word_assessment.get("ErrorType"),
                    "phoneme_index": phoneme_index,
                    "expected_phoneme": phoneme.get("Phoneme"),
                    "phoneme_offset_ticks": phoneme.get("Offset"),
                    "phoneme_offset_seconds": ticks_to_seconds(phoneme.get("Offset")),
                    "phoneme_duration_ticks": phoneme.get("Duration"),
                    "phoneme_duration_seconds": ticks_to_seconds(phoneme.get("Duration")),
                    "phoneme_accuracy": phoneme_assessment.get("AccuracyScore"),
                    "best_spoken_phoneme": best_candidate.get("Phoneme"),
                    "best_spoken_score": best_candidate.get("Score"),
                    "nbest_phonemes_json": compact_json(candidates),
                }
            )

    return rows


def flatten_syllables(result_json: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    nbest = first_nbest(result_json)

    for word_index, word in enumerate(nbest.get("Words") or []):
        word_assessment = word.get("PronunciationAssessment") or {}
        for syllable_index, syllable in enumerate(word.get("Syllables") or []):
            syllable_assessment = syllable.get("PronunciationAssessment") or {}
            rows.append(
                {
                    "word_index": word_index,
                    "word": word.get("Word"),
                    "word_offset_ticks": word.get("Offset"),
                    "word_offset_seconds": ticks_to_seconds(word.get("Offset")),
                    "word_accuracy": word_assessment.get("AccuracyScore"),
                    "word_error_type": word_assessment.get("ErrorType"),
                    "syllable_index": syllable_index,
                    "syllable": syllable.get("Syllable"),
                    "grapheme": syllable.get("Grapheme"),
                    "syllable_offset_ticks": syllable.get("Offset"),
                    "syllable_offset_seconds": ticks_to_seconds(syllable.get("Offset")),
                    "syllable_duration_ticks": syllable.get("Duration"),
                    "syllable_duration_seconds": ticks_to_seconds(syllable.get("Duration")),
                    "syllable_accuracy": syllable_assessment.get("AccuracyScore"),
                }
            )

    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return

    with path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def print_summary(result_json: dict[str, Any], phoneme_rows: list[dict[str, Any]]) -> None:
    nbest = first_nbest(result_json)
    assessment = nbest.get("PronunciationAssessment") or {}

    print()
    print("Recognized display text:", result_json.get("DisplayText"))
    print("Lexical text:", nbest.get("Lexical"))
    print("Top-level offset ticks:", result_json.get("Offset"))
    print("Top-level offset seconds:", ticks_to_seconds(result_json.get("Offset")))
    print()
    print("Scores:")
    for key in (
        "PronScore",
        "AccuracyScore",
        "FluencyScore",
        "CompletenessScore",
        "ProsodyScore",
    ):
        if key in assessment:
            print(f"  {key}: {assessment[key]}")

    if phoneme_rows:
        print()
        print("First phoneme rows:")
        for row in phoneme_rows[:12]:
            print(
                "  "
                f"{row['word']} / {row['expected_phoneme']} "
                f"offset={row['phoneme_offset_seconds']}s "
                f"duration={row['phoneme_duration_seconds']}s "
                f"accuracy={row['phoneme_accuracy']} "
                f"best_spoken={row['best_spoken_phoneme']}"
            )


def build_pronunciation_config(args: argparse.Namespace) -> Any:
    config = speechsdk.PronunciationAssessmentConfig(
        reference_text=getattr(args, "reference_text", "") or "",
        grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
        granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
        enable_miscue=bool(getattr(args, "enable_miscue", False)),
    )
    config.phoneme_alphabet = args.phoneme_alphabet
    config.nbest_phoneme_count = args.nbest_phoneme_count

    if args.enable_prosody:
        config.enable_prosody_assessment()

    return config


def recognize_once(args: argparse.Namespace) -> dict[str, Any]:
    speech_key = os.environ.get("SPEECH_KEY")
    speech_region = os.environ.get("SPEECH_REGION")

    if not speech_key or not speech_region:
        raise RuntimeError(
            "SPEECH_KEY and SPEECH_REGION are required. "
            "Create .env from .env.example or set them in your shell."
        )

    audio_path = Path(args.audio_file).expanduser().resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
    speech_config.output_format = speechsdk.OutputFormat.Detailed
    audio_config = speechsdk.audio.AudioConfig(filename=str(audio_path))

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        language=args.language,
        audio_config=audio_config,
    )

    pronunciation_config = build_pronunciation_config(args)
    pronunciation_config.apply_to(recognizer)

    result = recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.Canceled:
        cancellation = result.cancellation_details
        raise RuntimeError(
            "Recognition canceled: "
            f"{cancellation.reason}; details: {cancellation.error_details}"
        )

    if result.reason == speechsdk.ResultReason.NoMatch:
        raise RuntimeError(f"No speech recognized: {result.no_match_details}")

    raw_json = result.properties.get(
        speechsdk.PropertyId.SpeechServiceResponse_JsonResult
    )
    if not raw_json:
        raise RuntimeError("Azure returned no SpeechServiceResponse_JsonResult payload.")

    return json.loads(raw_json)


def score_weight_for_segment(result_json: dict[str, Any]) -> float:
    nbest = first_nbest(result_json)
    words = nbest.get("Words") or []
    if words:
        return float(len(words))
    duration = result_json.get("Duration")
    try:
        return max(1.0, float(duration or 0) / TICKS_PER_SECOND)
    except (TypeError, ValueError):
        return 1.0


def weighted_score(
    results: list[dict[str, Any]],
    score_name: str,
) -> float | None:
    weighted_values: list[tuple[float, float]] = []
    for result_json in results:
        assessment = first_nbest(result_json).get("PronunciationAssessment") or {}
        value = assessment.get(score_name)
        if value is None:
            continue
        try:
            weighted_values.append((float(value), score_weight_for_segment(result_json)))
        except (TypeError, ValueError):
            continue

    total_weight = sum(weight for _, weight in weighted_values)
    if total_weight <= 0:
        return None
    return round(sum(value * weight for value, weight in weighted_values) / total_weight, 1)


def combine_continuous_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        raise RuntimeError("No speech recognized in the audio file.")

    all_words: list[dict[str, Any]] = []
    display_parts: list[str] = []
    lexical_parts: list[str] = []
    itn_parts: list[str] = []
    masked_itn_parts: list[str] = []
    confidence_values: list[float] = []

    for result_json in results:
        nbest = first_nbest(result_json)
        display = result_json.get("DisplayText") or nbest.get("Display")
        lexical = nbest.get("Lexical")
        itn = nbest.get("ITN")
        masked_itn = nbest.get("MaskedITN")
        confidence = nbest.get("Confidence")

        if display:
            display_parts.append(str(display).strip())
        if lexical:
            lexical_parts.append(str(lexical).strip())
        if itn:
            itn_parts.append(str(itn).strip())
        if masked_itn:
            masked_itn_parts.append(str(masked_itn).strip())
        if isinstance(confidence, (int, float)):
            confidence_values.append(float(confidence))

        all_words.extend(nbest.get("Words") or [])

    offsets = [
        (word.get("Offset"), word.get("Duration"))
        for word in all_words
        if isinstance(word.get("Offset"), (int, float))
    ]
    if offsets:
        start_tick = min(offset for offset, _ in offsets)
        end_tick = max(
            offset + (duration if isinstance(duration, (int, float)) else 0)
            for offset, duration in offsets
        )
    else:
        start_tick = min(
            (item.get("Offset") for item in results if isinstance(item.get("Offset"), (int, float))),
            default=0,
        )
        end_tick = max(
            (
                item.get("Offset", 0) + item.get("Duration", 0)
                for item in results
                if isinstance(item.get("Offset"), (int, float))
            ),
            default=start_tick,
        )

    assessment: dict[str, Any] = {}
    for score_name in ("AccuracyScore", "FluencyScore", "ProsodyScore", "PronScore"):
        value = weighted_score(results, score_name)
        if value is not None:
            assessment[score_name] = value

    display_text = " ".join(part for part in display_parts if part).strip()
    lexical_text = " ".join(part for part in lexical_parts if part).strip()
    itn_text = " ".join(part for part in itn_parts if part).strip()
    masked_itn_text = " ".join(part for part in masked_itn_parts if part).strip()

    return {
        "Id": f"continuous-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "RecognitionStatus": "Success",
        "Offset": int(start_tick),
        "Duration": int(max(0, end_tick - start_tick)),
        "DisplayText": display_text,
        "NBest": [
            {
                "Confidence": (
                    round(sum(confidence_values) / len(confidence_values), 6)
                    if confidence_values
                    else None
                ),
                "Lexical": lexical_text,
                "ITN": itn_text,
                "MaskedITN": masked_itn_text,
                "Display": display_text,
                "PronunciationAssessment": assessment,
                "Words": all_words,
            }
        ],
        "Segments": results,
    }


def recognize_continuous(args: argparse.Namespace) -> dict[str, Any]:
    speech_key = os.environ.get("SPEECH_KEY")
    speech_region = os.environ.get("SPEECH_REGION")

    if not speech_key or not speech_region:
        raise RuntimeError(
            "SPEECH_KEY and SPEECH_REGION are required. "
            "Create .env from .env.example or set them in your shell."
        )

    audio_path = Path(args.audio_file).expanduser().resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
    speech_config.output_format = speechsdk.OutputFormat.Detailed
    audio_config = speechsdk.audio.AudioConfig(filename=str(audio_path))

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        language=args.language,
        audio_config=audio_config,
    )

    pronunciation_config = build_pronunciation_config(args)
    pronunciation_config.apply_to(recognizer)

    done = False
    errors: list[str] = []
    segment_results: list[dict[str, Any]] = []

    def handle_recognized(evt: Any) -> None:
        result = evt.result
        if result.reason != speechsdk.ResultReason.RecognizedSpeech:
            return
        raw_json = result.properties.get(
            speechsdk.PropertyId.SpeechServiceResponse_JsonResult
        )
        if raw_json:
            segment_results.append(json.loads(raw_json))

    def handle_canceled(evt: Any) -> None:
        nonlocal done
        details = evt.result.cancellation_details if evt.result else None
        if details and details.error_details:
            errors.append(str(details.error_details))
        done = True

    def handle_stopped(_: Any) -> None:
        nonlocal done
        done = True

    recognizer.recognized.connect(handle_recognized)
    recognizer.canceled.connect(handle_canceled)
    recognizer.session_stopped.connect(handle_stopped)

    recognizer.start_continuous_recognition()
    timeout_seconds = max(60.0, float(getattr(args, "max_wait_seconds", 300)))
    started_at = time.monotonic()
    while not done and time.monotonic() - started_at < timeout_seconds:
        time.sleep(0.1)

    recognizer.stop_continuous_recognition()

    if not segment_results and errors:
        raise RuntimeError(f"Recognition canceled: {'; '.join(errors)}")
    if not segment_results:
        raise RuntimeError("No speech recognized in the audio file.")

    return combine_continuous_results(segment_results)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run Azure Pronunciation Assessment and save detailed JSON offsets."
    )
    parser.add_argument("--audio-file", required=True, help="Path to a short WAV file.")
    parser.add_argument(
        "--reference-text",
        required=True,
        help="Expected text the speaker was reading.",
    )
    parser.add_argument("--language", default="en-US", help="Recognition locale.")
    parser.add_argument(
        "--phoneme-alphabet",
        choices=("IPA", "SAPI"),
        default="IPA",
        help="Phoneme alphabet in the JSON result.",
    )
    parser.add_argument(
        "--nbest-phoneme-count",
        type=int,
        default=5,
        help="Number of spoken phoneme candidates to request.",
    )
    parser.add_argument(
        "--enable-prosody",
        action="store_true",
        help="Include prosody score where supported.",
    )
    parser.add_argument(
        "--enable-miscue",
        action="store_true",
        help="Request omission/insertion comparison against the reference text.",
    )
    parser.add_argument(
        "--output-dir",
        default="outputs",
        help="Directory for JSON and CSV outputs.",
    )
    parser.add_argument(
        "--output-label",
        default="pronunciation",
        help="Label to include in output filenames.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_dir = Path(__file__).resolve().parent
    load_env_file(project_dir / ".env")

    if args.enable_prosody and args.language != "en-US":
        print("Warning: prosody assessment is only supported for en-US.", file=sys.stderr)

    result_json = recognize_once(args)

    output_dir = (project_dir / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_label = "".join(
        char if char.isalnum() or char in ("-", "_") else "_"
        for char in args.output_label
    ).strip("_") or "pronunciation"
    prefix = output_dir / f"{timestamp}_{safe_label}"
    raw_json_path = prefix.with_name(prefix.name + "_raw.json")
    summary_json_path = prefix.with_name(prefix.name + "_summary.json")
    words_csv_path = prefix.with_name(prefix.name + "_words.csv")
    phoneme_csv_path = prefix.with_name(prefix.name + "_phonemes.csv")
    syllable_csv_path = prefix.with_name(prefix.name + "_syllables.csv")

    raw_json_path.write_text(
        json.dumps(result_json, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary_json_path.write_text(
        json.dumps(build_summary(result_json), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    word_rows = flatten_words(result_json)
    phoneme_rows = flatten_phonemes(result_json)
    syllable_rows = flatten_syllables(result_json)
    write_csv(words_csv_path, word_rows)
    write_csv(phoneme_csv_path, phoneme_rows)
    write_csv(syllable_csv_path, syllable_rows)

    print_summary(result_json, phoneme_rows)
    print()
    print(f"Raw JSON: {raw_json_path}")
    print(f"Summary JSON: {summary_json_path}")
    print(f"Words CSV: {words_csv_path}")
    print(f"Phoneme CSV: {phoneme_csv_path}")
    print(f"Syllable CSV: {syllable_csv_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
