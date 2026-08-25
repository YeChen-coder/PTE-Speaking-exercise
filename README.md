# PTE Speaking Exercise

中文 | [English](README.en.md)

这个项目现在它仍然是一个在迭代中的东西（因为作者的口语还没有达到需要的level）。它的整个逻辑其实是针对 PTE 考试的口语练习（比如 Read Aloud、Repeat Sentence、Describe Image 等），是一个录音并练习口语的工具。

设计思路是针对这两个问题的：

1. 缺乏外部反馈： 作为非母语者，很多时候我们不知道自己哪里读得不对。尤其是在没有第三方纠正的情况下，有时候单词读错了自己都完全意识不到。这个工具就是针对这种情况提供监测和反馈的。
2. 音调与语速控制： 拿我个人来说，我平时的音调和语速起伏非常大，声音很跳。但 PTE 考试要求的是非常平淡、单调且平滑的语调。因此，工具需要对音调进行监测和反馈，来帮助考生调整。

因为这个项目其实包含了三个子项目，或者说，这三个子项目其实都是 base 在同一个 Flask 后台上的，而且它们的声音上传和检测标准也都是一样的，所以就被汇总起来，作为一个大项目而存在了。
三个子项目分别是：

• 照着读的练习： 针对 Repeat Sentence 和 Read Aloud。

• 自主组织语言的练习： 针对 Describe Image 和 Respond to a Situation，需要自己动脑子想答案。

• 特定单词发音纠正： 专门把一些我读不准的特定单词单独摘出来进行练习。

另外，关于下面要求配置的 Azure Speech Key，它其实也是必要的。准确地说，它主要用于单词练习、Repeat Sentence 和 Read Aloud。尤其是 Repeat Sentence，你必须先听到原音频才能跟着说，如果连音频都无法播放，那练起来就很不地道了。这边其实有设计。因为你每次调用一次 API Key 都是要钱的嘛，虽然我自己测下来，讲道理的，我都没有超他那个免费额度的标准，我自己其实没有花钱，但是你每次靠一次就花一次钱，这个事情实在是让人很不乐意。

所以在这边对于那些音频，就是那种固定的音频，比如像 Repeat Sentence， Read aloud 这种的，它是会保存在本地的，它是有一个哈希可以去匹配的，然后单独的单词 word 同理。

先说一下，这边所有的空格键都是去提交的快捷键，都是上传到 Azure 那边去提交，因为他那边要出一个检测结果。至于怎么从 Azure 那边拿到 Speech 相关的 Key，我已经放在最下面了。这就是个标准流程，，单纯就是拿到一个 Key 而已。
快捷键就是上下左右方向键：“上”是上一题，“下”是下一题，左和右也有各自对应的功能。

另外，有的网页会有 controller 选项。这是因为作者本人有个 Xbox controller，之前做这个平台的时候不太乐意一直坐在电脑前，有时想用手柄操作，所以就给它配了 Xbox controller 支持。大概率是能用的，不过在自己电脑上部署的时候还是需要测试检查一下，不确定移植到别的电脑上还能不能正常使用。

# Repeat sentance + Read aloud (.\practice_pipeline\start_practice_pipeline.ps1 -Page repeat)

这两个题目在我看来其实是一个东西，都是去念一句话，而且都是有稿的（不管稿是听到的还是看到的），都有明确固定的内容要去说，所以我就把它们两个合在一起了。

导入和修改题目都很简单，直接在 sentence.txt 文件里改就行。一行对应一句话，程序会自动进行编排。具体看页面吧，自由度非常大，一切都是为了实用服务。

最开始这个工具还挺简单的，但我做着做着就发现这个也想要、那个也想要，最后功能就越来越多了：

关于 Play Monotone：
这个注意一下。因为考试要求语调比较平缓，所以我特地加了这个功能。如果点 Play Prompt，它是用 Azure 那边非常自然、抑扬顿挫的声音去念；而 Play Monotone 用的是另一个声音源，读出来会更平缓。我个人练习的时候是照着 Play Monotone 来练的。主要是我自己的声调容易上蹿下跳，所以才用这种办法把语调往回拉，大家使用时根据自己的情况选择就好。

下面的截图展示：
下面这些内容我尽量都放上去了，截图展示了我念第一句话时的完整信息。大家看一眼就知道大概包含哪些内容了。反正不好说哪些有用、哪些没用，给到的信息多一点总比没有强

<img width="1763" height="3939" alt="image" src="https://github.com/user-attachments/assets/1c5a3dbf-b921-4f9f-a18e-acad78629a72" />

因为是个句子，所以不只是单词，还得考虑到连贯性之类的。

但讲道理，还是那句话，没有人知道 PTE 真实后台到底是怎么判断的，所以这些都只能作为参考。作者也很真诚地说，因为给出的信息太多、太专业，他自己基本上也就是看一下哪个单词读得不对，再修一下声调，仅此而已。而且有时候就算看懂了、知道是什么意思，能不能把嘴巴的肌肉记忆改过来、发出正确的音，本身就依然是个很大的课题。

# Word 重点单词加强 （.\practice_pipeline\start_practice_pipeline.ps1 -Page words）
这个就是有些单词念一次错一次，所以专门摘出来。首先你得先把单词的音标给搞对。

这里面的单词内容都是可以编辑的，直接去改 word_items.txt 那个文件就行。

下图就是它这边能出来的一个信息例子：
<img width="1763" height="2972" alt="image" src="https://github.com/user-attachments/assets/a2ee4273-4ab7-4583-bac5-6a2d5d0e7b57" />

# Describe image + Response to situation (.\practice_pipeline\start_practice_pipeline.ps1 -Page speaking)
这个模块主要是针对那种自己长段独白的长口语练习设计的。

虽然稿子不一定完全能用上，但它还是提供了一个放稿子的空间，稿子内容可以自己新建、编辑和保存，跟 writing email 那边是一样的。

这边的整体逻辑跟前两个模块一致：录音之后提交，把音频传到 Azure 那边返回结果，再在本地跟你的底稿进行对比。

不过实话实说，这个文本对比一般没什么太大用，甚至比 writing email 那边的对比还要更鸡肋一些。writing email 那边起码能看出你经常会忽略哪些词，或者会打错哪些单词；但口语这边毕竟带有即兴表达的属性，而且临场紧张程度非常高，所以实际使用时，作者并没有从单纯的文本对比中获益太多。

但它确实能暴露出问题：我在说很多句子时会吞头吞尾，发出来的声音可能我自己不觉得，但到了 Azure 这个客观中立的评判标准那边，识别出来的就根本不是我以为自己说的内容。从这个角度来说，它还是很有用的。
<img width="1763" height="3971" alt="image" src="https://github.com/user-attachments/assets/2e861f96-0e12-4f70-b70d-87d828634097" />


## Azure speech key的获得与系统要求

下面是单独讲一下，系统要求和Azure Speech 那边的 Credentials 怎么去拿。

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
