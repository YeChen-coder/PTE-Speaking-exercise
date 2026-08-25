# PTE Speaking Exercise

This project is still being actively iterated, mainly because the author's own speaking score has not yet reached the target level. The tool is designed for PTE speaking practice, including tasks such as Read Aloud, Repeat Sentence, Describe Image, and Respond to a Situation. In simple terms, it is a local web app for recording speech, sending it to Azure AI Speech for pronunciation assessment, and reviewing the returned feedback visually.

The project was built around two practical problems:

1. Lack of external feedback: As a non-native speaker, it is often hard to know exactly where a pronunciation problem is. Without a third party correcting us, we may not even notice that a word is being pronounced incorrectly. This tool is meant to provide that kind of monitoring and feedback.
2. Pitch and speed control: In my own case, my natural pitch and speaking speed fluctuate a lot. However, for PTE practice, I want a flatter, more monotone, and smoother delivery. The app therefore includes local pitch and pacing diagnostics to help adjust speaking style.

The project contains three practice pages. They share the same Flask backend, recording flow, Azure upload logic, and assessment visualization, so they are grouped together as one larger project:

- Sentence practice: for Repeat Sentence and Read Aloud.
- Long speaking practice: for Describe Image and Respond to a Situation, where the user needs to organize and speak a longer answer.
- Word and phrase practice: for drilling specific words or phrases that repeatedly receive low scores.

The Azure Speech Key configured below is required. It is used for pronunciation assessment, and also for generating reference audio in some modes. In Repeat Sentence, for example, you need to hear the prompt before repeating it. Since every API call may count toward Azure usage, the app caches fixed reference audio locally. Repeat Sentence, Read Aloud, and word/phrase audio are saved by a hash-based cache so the same text does not need to request Azure TTS again.

Across the pages, `Space` is generally the submit shortcut. It uploads the current recording to Azure and returns an assessment result. Arrow keys are also used frequently: `Up` and `Down` move between items, while `Left` and `Right` have page-specific actions.

Some pages include an optional controller toggle. This exists because the author uses an Xbox controller for practice and does not always want to sit directly in front of the keyboard. Controller support works on the author's machine, but it may need testing on other computers.

## Repeat Sentence + Read Aloud

Start this page with:

```powershell
.\practice_pipeline\start_practice_pipeline.ps1 -Page repeat
```

In this project, Repeat Sentence and Read Aloud are treated as one practice flow. Both tasks involve speaking a fixed sentence: one sentence is heard first, while the other is read from text. The app therefore combines them into the same page.

To import or edit sentence material, edit:

```text
practice_pipeline/sentences.txt
```

Each line is treated as one sentence, and the app will automatically build the practice queue.

### Play Monotone

The `Play Monotone` feature deserves a special note. `Play Prompt` uses Azure's natural TTS voice, which usually has more natural intonation. `Play Monotone` uses a flatter local voice profile designed for more monotone practice. I personally use the monotone version as my main reference, because my own pitch tends to jump too much.

The screenshot below shows the kind of information available after reading one sentence.

<img width="1763" height="3939" alt="Repeat Sentence screenshot" src="https://github.com/user-attachments/assets/1c5a3dbf-b921-4f9f-a18e-acad78629a72" />

Because this is sentence-level practice, the app does not only look at individual words. It also tries to show continuity-related signals, timing between words, pacing, pitch movement, and other diagnostics.

That said, nobody outside the official PTE system knows exactly how the real scoring backend works. These results should be treated as training references rather than a perfect replica of the exam. In practice, I mostly use the tool to find weak words and to adjust my pitch and rhythm.

## Word / Phrase Practice

Start this page with:

```powershell
.\practice_pipeline\start_practice_pipeline.ps1 -Page words
```

This page is for words or short phrases that repeatedly cause problems. Before drilling a word, make sure its target pronunciation is correct.

To edit the word and phrase list, edit:

```text
practice_pipeline/word_items.txt
```

The screenshot below shows an example of the feedback available on this page.

<img width="1763" height="2972" alt="Word practice screenshot" src="https://github.com/user-attachments/assets/a2ee4273-4ab7-4583-bac5-6a2d5d0e7b57" />

## Describe Image + Respond To A Situation

Start this page with:

```powershell
.\practice_pipeline\start_practice_pipeline.ps1 -Page speaking
```

This page is designed for longer spoken responses, such as Describe Image and Respond to a Situation.

The page includes an optional script area. A script can be created, edited, and saved locally. After recording, the audio is sent to Azure, and the returned transcript and pronunciation assessment are compared against the script when one is provided.

In practice, the text comparison is not always equally useful. For spontaneous speaking, the exact wording may differ from the script, and the pressure of the task can make the answer less predictable. Still, the comparison can expose useful problems, especially cases where the beginning or ending of a sentence is swallowed and Azure recognizes something different from what the speaker thought they said.

<img width="1763" height="3971" alt="Long speaking practice screenshot" src="https://github.com/user-attachments/assets/2e861f96-0e12-4f70-b70d-87d828634097" />

## Requirements And Azure Speech Setup

### 1. Requirements

- Windows 10/11
- Python 3.10 or newer
- A browser with microphone access
- An Azure Speech resource

### 2. Create Azure Speech Credentials

1. Open the Azure Portal.
2. Create or open an Azure Speech resource.
3. Go to `Keys and Endpoint`.
4. Copy one key.
5. Copy the resource region, such as `eastus`.

Do not commit real keys to GitHub.

### 3. Install

From this repository folder:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
```

Edit `.env`:

```text
SPEECH_KEY=your-real-azure-speech-key
SPEECH_REGION=eastus
```

The real `.env` file is ignored by Git.

### 4. Run

Start one of the practice pages with the helper script:

```powershell
.\practice_pipeline\start_practice_pipeline.ps1 -Page repeat
.\practice_pipeline\start_practice_pipeline.ps1 -Page words
.\practice_pipeline\start_practice_pipeline.ps1 -Page speaking
```

The helper script starts the local Flask server and opens the selected page. If port `8765` is already occupied, it will automatically use another local port.

You can also start the server manually:

```powershell
.\.venv\Scripts\python.exe .\practice_pipeline\server.py
```

Then open one of these pages:

```text
http://127.0.0.1:8765/repeat
http://127.0.0.1:8765/words
http://127.0.0.1:8765/speaking
```

### 5. Practice Material

The included files are small examples only:

```text
practice_pipeline/sentences.txt
practice_pipeline/word_items.txt
```

Replace them with your own sentence bank and word/phrase bank.

### 6. Optional Reward Sounds

Reward sound files are not included.

To add your own local sounds, put MP3 files here:

```text
practice_pipeline/static/reward_sounds/
```

Use these exact filenames:

```text
great.mp3
unbelievable.mp3
other.mp3
```

These MP3 files are ignored by Git.
