
这个项目实在是太乱了，我打算之后再来写齐全这个 README。

而且现在它仍然是一个在迭代中的东西，并不是一个最终的成品。它的整个逻辑其实是针对 PTE 考试的口语练习（比如 Read Aloud、Repeat Sentence、Describe Image 等），是一个录音并练习口语的工具。

目前主要解决了两个痛点：

1. 缺乏外部反馈： 作为非母语者，很多时候我们不知道自己哪里读得不对。尤其是在没有第三方纠正的情况下，有时候单词读错了自己都完全意识不到。这个工具就是针对这种情况提供监测和反馈的。
2. 音调与语速控制： 拿我个人来说，我平时的音调和语速起伏非常大，声音很跳。但 PTE 考试要求的是非常平淡、单调且平滑的语调。因此，工具需要对音调进行监测和反馈，来帮助考生调整。

因为这个项目其实包含了三个子项目，所以导致现在代码无比混乱，甚至我自己在我本地的开发环境上都有点理不清楚了。这三个子项目分别是：

• 照着读的练习： 针对 Repeat Sentence 和 Read Aloud。
• 自主组织语言的练习： 针对 Describe Image 和 Respond to a Situation，需要自己动脑子想答案。
• 特定单词发音纠正： 专门把一些我读不准的特定单词单独摘出来进行练习。

另外，关于下面要求配置的 Azure Speech Key，它其实也是必要的。准确地说，它主要用于单词练习、Repeat Sentence 和 Read Aloud。尤其是 Repeat Sentence，你必须先听到原音频才能跟着说，如果连音频都无法播放，那练起来就很不地道了。


# Repeat sentance + Read aloud (.\practice_pipeline\start_practice_pipeline.ps1 -Page repeat)

这两个题目在我看来其实是一个东西，都是去念一句话，而且都是有稿的（不管稿是听到的还是看到的），都有明确固定的内容要去说，所以我就把它们两个合在一起了。

导入和修改题目都很简单，直接在 sentence.txt 文件里改就行。一行对应一句话，程序会自动进行编排。具体看页面吧，自由度非常大，一切都是为了实用服务。

最开始这个工具还挺简单的，但我做着做着就发现这个也想要、那个也想要，最后功能就越来越多了：

关于 Play Monotone：
这个注意一下。因为考试要求语调比较平缓，所以我特地加了这个功能。如果点 Play Prompt，它是用 Azure 那边非常自然、抑扬顿挫的声音去念；而 Play Monotone 用的是另一个声音源，读出来会更平缓。我个人练习的时候是照着 Play Monotone 来练的。主要是我自己的声调容易上蹿下跳，所以才用这种办法把语调往回拉，大家使用时根据自己的情况选择就好。

下面的截图展示：
下面这些内容我尽量都放上去了，截图展示了我念第一句话时的完整信息。大家看一眼就知道大概包含哪些内容了。反正不好说哪些有用、哪些没用，给到的信息多一点总比没有强

<img width="1763" height="3939" alt="image" src="https://github.com/user-attachments/assets/1c5a3dbf-b921-4f9f-a18e-acad78629a72" />


先跟大家说明一下这个情况，等我后面把代码再整理一下，再来更新这个 README 吧。我现在实在是太乱了

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
