# Pronunciation Practice Pipeline

This local app turns the one-off Azure Pronunciation Assessment demo into a
sentence-by-sentence practice workflow.

## Run

From `azure-pronunciation-assessment-json`:

```powershell
.\.venv\Scripts\python.exe .\practice_pipeline\server.py
```

Open Read Aloud:

```text
http://127.0.0.1:8765/read
```

Open Repeat Sentence:

```text
http://127.0.0.1:8765/repeat
```

Open Words / Phrases:

```text
http://127.0.0.1:8765/words
```

The server reads Azure credentials from the parent `.env` file.

Desktop shortcuts are created at:

```text
C:\Users\yeche\Desktop\PTE Read Aloud.lnk
C:\Users\yeche\Desktop\PTE Repeat Sentence.lnk
```

Double-click either shortcut to start the local server and open the page.

## Sentences

Edit one sentence per line:

```text
practice_pipeline/sentences.txt
```

You can also click `Edit` in the page, paste your full sentence list, and save.

## Workflow

### Read Aloud

1. Select a sentence.
2. Click `Start Recording`.
3. Read the sentence.
4. Click `Stop`.
5. The browser uploads the recording automatically.
6. The server converts the recording to WAV, runs Azure Pronunciation
   Assessment, and updates the page.

The latest uploaded user recording and assessment result is saved under:

```text
practice_pipeline/outputs/latest/
```

This directory is cleared before each new upload, so old user recordings do not
accumulate. Prompt audio for Repeat Sentence is separate and remains cached
under `practice_pipeline/tts_cache/`.

The app returns the same core data as the single-file demo: raw JSON, summary,
word rows, phoneme rows, syllable rows, and the converted WAV.

### Repeat Sentence

1. Open `/repeat`.
2. The sentence text is masked as `Sentence N`.
3. Click a sentence or press `Down` to play the prompt audio.
4. After prompt playback ends, the page waits 2 seconds, plays a short beep, and starts recording automatically.
5. Repeat what you heard.
6. Click `Stop` if you only want to keep the recording local for review.
7. Press `Space` while recording to stop and upload immediately.
8. If you already clicked `Stop`, press `Space` to upload the saved local recording.

Repeat Sentence keyboard shortcuts:

```text
Up: previous sentence
Down: next sentence and play prompt
Left: replay current prompt from the beginning
Space: stop recording and upload; or upload the saved local recording
```

Prompt audio is generated once with Azure TTS and then cached locally:

```text
practice_pipeline/tts_cache/
```

If you click the same sentence again, the page plays the cached WAV instead of
calling Azure TTS again.

### Words / Phrases

1. Open `/words`.
2. Add a word or short phrase from the left panel, or edit the full bank.
3. Click `Play Audio` to hear the Azure voice. The generated audio is cached
   under `practice_pipeline/tts_cache/`.
4. Click `Start Recording`, speak the word or phrase, then click `Stop`.
5. Press `Space` to upload the saved recording to Azure Pronunciation
   Assessment.

Words / Phrases keyboard shortcuts:

```text
Left: previous word or phrase
Right: next word or phrase
Space: stop recording and upload; or upload the saved local recording
```

The word and phrase bank is stored separately from the sentence list:

```text
practice_pipeline/word_items.txt
```

## Custom Reward Sound

The practice pages include a `Reward Sound` switch and a volume slider. Reward
MP3 files are optional and are not included in the repository. When local files
exist, the page plays one after Azure returns a PronScore:

```text
<80: other.mp3
80-84.9: great.mp3
85+: unbelievable.mp3
```

To add your own sounds, put MP3 files with these exact names under:

```text
practice_pipeline/static/reward_sounds/
```

The MP3 files are ignored by Git so copyrighted or personal audio is not pushed
to GitHub.
