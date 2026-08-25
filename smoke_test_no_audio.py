from __future__ import annotations

import json
import os
import sys
from argparse import Namespace
from datetime import datetime
from pathlib import Path

import azure.cognitiveservices.speech as speechsdk

from assess_pronunciation import (
    build_summary,
    flatten_phonemes,
    flatten_syllables,
    flatten_words,
    load_env_file,
    print_summary,
    recognize_once,
    write_csv,
)


def synthesize_wav(text: str, wav_path: Path) -> None:
    speech_key = os.environ.get("SPEECH_KEY")
    speech_region = os.environ.get("SPEECH_REGION")

    if not speech_key or not speech_region:
        raise RuntimeError("SPEECH_KEY and SPEECH_REGION must be set in .env.")

    speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
    speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm
    )

    audio_config = speechsdk.audio.AudioOutputConfig(filename=str(wav_path))
    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config,
    )

    result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return

    if result.reason == speechsdk.ResultReason.Canceled:
        details = speechsdk.SpeechSynthesisCancellationDetails.from_result(result)
        raise RuntimeError(
            f"Speech synthesis canceled: {details.reason}; "
            f"details: {details.error_details}"
        )

    raise RuntimeError(f"Unexpected synthesis result: {result.reason}")


def main() -> int:
    project_dir = Path(__file__).resolve().parent
    load_env_file(project_dir / ".env")

    output_dir = project_dir / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)

    reference_text = "hello world"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    prefix = output_dir / f"{timestamp}_smoke_test"
    wav_path = prefix.with_name(prefix.name + "_hello_world.wav")

    print("Step 1/2: synthesizing a short WAV with Azure Speech...")
    synthesize_wav(reference_text, wav_path)
    print(f"Generated WAV: {wav_path}")

    print()
    print("Step 2/2: running Pronunciation Assessment on that WAV...")
    args = Namespace(
        audio_file=str(wav_path),
        reference_text=reference_text,
        language="en-US",
        phoneme_alphabet="IPA",
        nbest_phoneme_count=5,
        enable_prosody=False,
        enable_miscue=False,
        output_dir="outputs",
        output_label="smoke_test",
    )
    result_json = recognize_once(args)

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
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
