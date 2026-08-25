# PTE-Speaking-exercise

<!-- Project introduction: TODO -->

## Setup

This is a local Python/Flask app. It uses Azure AI Speech for pronunciation
assessment, so each user needs their own Azure Speech resource key.

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

Start the local server:

```powershell
.\.venv\Scripts\python.exe .\practice_pipeline\server.py
```

Then open one of these pages:

```text
http://127.0.0.1:8765/repeat
http://127.0.0.1:8765/words
http://127.0.0.1:8765/speaking
```

Or use the helper script:

```powershell
.\practice_pipeline\start_practice_pipeline.ps1 -Page repeat
.\practice_pipeline\start_practice_pipeline.ps1 -Page words
.\practice_pipeline\start_practice_pipeline.ps1 -Page speaking
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
