const tick = 10000000;
const BREAK_CONFIDENCE_THRESHOLD = 0.75;
const KEYBOARD_SCROLL_STEP = 220;
const MIC_MONITOR_STORAGE_KEY = "speakingMicMonitor";

const state = {
  result: null,
  selectedSentence: 0,
  selectedWord: 0,
  currentView: "sentences",
  recorder: null,
  stream: null,
  activeStreams: new Set(),
  chunks: [],
  pendingRecording: null,
  uploadAfterStop: false,
  stopWithoutUpload: false,
  uploadInProgress: false,
  recordingStarting: false,
  recordingStartedAt: null,
  lastRecordingSeconds: null,
  durationTimer: null,
  micMonitorEnabled: readMicMonitorSetting(),
  micMonitorContext: null,
  micMonitorSource: null,
  micMonitorGain: null,
  scriptText: "",
  scriptSentences: [],
  savedScripts: [],
  activeScriptId: null,
  scriptsLoading: false,
  scriptSaveStatus: "Not saved",
  scriptTtsCache: new Map(),
  scriptTtsLoadingKey: "",
  busy: false,
};

const els = {
  statusPill: document.querySelector("#statusPill"),
  recordingMeta: document.querySelector("#recordingMeta"),
  recordingTimer: document.querySelector("#recordingTimer"),
  micMonitorToggle: document.querySelector("#micMonitorToggle"),
  recordButton: document.querySelector("#recordButton"),
  stopButton: document.querySelector("#stopButton"),
  uploadButton: document.querySelector("#uploadButton"),
  resultAudio: document.querySelector("#resultAudio"),
  latestFiles: document.querySelector("#latestFiles"),
  scoreGrid: document.querySelector("#scoreGrid"),
  prosodyOverview: document.querySelector("#prosodyOverview"),
  scriptTitleInput: document.querySelector("#scriptTitleInput"),
  scriptInput: document.querySelector("#scriptInput"),
  applyScriptButton: document.querySelector("#applyScriptButton"),
  saveScriptButton: document.querySelector("#saveScriptButton"),
  newScriptButton: document.querySelector("#newScriptButton"),
  deleteScriptButton: document.querySelector("#deleteScriptButton"),
  clearScriptButton: document.querySelector("#clearScriptButton"),
  scriptSaveStatus: document.querySelector("#scriptSaveStatus"),
  savedScriptList: document.querySelector("#savedScriptList"),
  scriptSentenceList: document.querySelector("#scriptSentenceList"),
  transcriptCompare: document.querySelector("#transcriptCompare"),
  scriptAudio: document.querySelector("#scriptAudio"),
  speakingStats: document.querySelector("#speakingStats"),
  sentenceList: document.querySelector("#sentenceList"),
  selectedSentenceTitle: document.querySelector("#selectedSentenceTitle"),
  sentenceMetrics: document.querySelector("#sentenceMetrics"),
  sentenceTranscript: document.querySelector("#sentenceTranscript"),
  sentenceWordChain: document.querySelector("#sentenceWordChain"),
  timeRuler: document.querySelector("#timeRuler"),
  playhead: document.querySelector("#playhead"),
  wordTimeline: document.querySelector("#wordTimeline"),
  wordList: document.querySelector("#wordList"),
  selectedWordTitle: document.querySelector("#selectedWordTitle"),
  seekWordButton: document.querySelector("#seekWordButton"),
  detailMetrics: document.querySelector("#detailMetrics"),
  phonemeLane: document.querySelector("#phonemeLane"),
  syllableLane: document.querySelector("#syllableLane"),
  feedbackGrid: document.querySelector("#feedbackGrid"),
  tabPanel: document.querySelector("#tabPanel"),
};

const seconds = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value) / tick;
};

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
};

const formatTimer = (secondsValue) => {
  const value = Math.max(0, Number(secondsValue) || 0);
  const minutes = Math.floor(value / 60);
  const secondsPart = Math.floor(value % 60);
  const tenths = Math.floor((value % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}.${tenths}`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const scoreColor = (score) => {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "#66726e";
  if (Number(score) >= 90) return "var(--green)";
  if (Number(score) >= 70) return "var(--amber)";
  return "var(--red)";
};

const scoreBg = (score) => {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "#eef1eb";
  if (Number(score) >= 90) return "var(--soft-green)";
  if (Number(score) >= 70) return "var(--soft-amber)";
  return "var(--soft-red)";
};

const pct = (value) => `${Math.max(0, Math.min(100, Number(value) || 0))}%`;

function readMicMonitorSetting() {
  try {
    return window.localStorage.getItem(MIC_MONITOR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeMicMonitorSetting(value) {
  try {
    window.localStorage.setItem(MIC_MONITOR_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function isTextEntryTarget(target) {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target?.isContentEditable;
}

function chooseMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function setStatus(text, tone = "ready") {
  els.statusPill.textContent = text;
  const colors = {
    ready: ["var(--soft-blue)", "var(--blue)"],
    recording: ["var(--soft-red)", "var(--red)"],
    busy: ["var(--soft-amber)", "var(--amber)"],
    done: ["var(--soft-green)", "var(--green)"],
  };
  const [bg, color] = colors[tone] || colors.ready;
  els.statusPill.style.background = bg;
  els.statusPill.style.color = color;
}

function setAudioSource(audio, src) {
  if (!audio || !src) return;
  if (audio.getAttribute("src") !== src) {
    audio.src = src;
    audio.load();
  }
}

function cacheBustUrl(url, key) {
  if (!url) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(key || Date.now())}`;
}

function stopMediaStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

async function startMicMonitor(stream) {
  if (!stream || !state.micMonitorEnabled || state.micMonitorContext) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const gain = context.createGain();
    gain.gain.value = 0.85;
    source.connect(gain);
    gain.connect(context.destination);
    state.micMonitorContext = context;
    state.micMonitorSource = source;
    state.micMonitorGain = gain;
    if (context.state === "suspended") await context.resume();
  } catch (error) {
    console.warn("Mic monitor failed", error);
    stopMicMonitor();
  }
}

function stopMicMonitor() {
  try {
    state.micMonitorSource?.disconnect();
  } catch {}
  try {
    state.micMonitorGain?.disconnect();
  } catch {}
  try {
    state.micMonitorContext?.close();
  } catch {}
  state.micMonitorSource = null;
  state.micMonitorGain = null;
  state.micMonitorContext = null;
}

function stopAllRecordingTracks() {
  stopMicMonitor();
  state.activeStreams.forEach(stopMediaStream);
  state.activeStreams.clear();
  stopMediaStream(state.stream);
  state.stream = null;
}

function normalizeResult(payload) {
  const raw = payload.raw || {};
  const nbest = raw.NBest?.[0] || {};
  const words = (nbest.Words || []).map((word, wordIndex) => {
    const assessment = word.PronunciationAssessment || {};
    const phonemes = (word.Phonemes || []).map((phoneme, phonemeIndex) => {
      const phonemeAssessment = phoneme.PronunciationAssessment || {};
      const candidates = phonemeAssessment.NBestPhonemes || [];
      return {
        wordIndex,
        phonemeIndex,
        word: word.Word,
        expected: phoneme.Phoneme,
        offset: seconds(phoneme.Offset),
        duration: seconds(phoneme.Duration),
        accuracy: phonemeAssessment.AccuracyScore,
        candidates,
        best: candidates[0]?.Phoneme || "",
        bestScore: candidates[0]?.Score,
      };
    });
    const syllables = (word.Syllables || []).map((syllable, syllableIndex) => ({
      syllableIndex,
      syllable: syllable.Syllable,
      grapheme: syllable.Grapheme,
      offset: seconds(syllable.Offset),
      duration: seconds(syllable.Duration),
      accuracy: syllable.PronunciationAssessment?.AccuracyScore,
    }));

    return {
      wordIndex,
      text: word.Word,
      offset: seconds(word.Offset),
      duration: seconds(word.Duration),
      confidence: word.Confidence,
      accuracy: assessment.AccuracyScore,
      errorType: assessment.ErrorType || "None",
      feedback: assessment.Feedback || null,
      phonemes,
      syllables,
    };
  });

  const result = {
    ...payload,
    nbest,
    assessment: nbest.PronunciationAssessment || {},
    words,
    phonemes: words.flatMap((word) => word.phonemes),
    transcript: raw.DisplayText || nbest.Display || nbest.Lexical || "",
    timelineStart: seconds(raw.Offset) ?? 0,
    timelineEnd: Math.max(
      (seconds(raw.Offset) ?? 0) + (seconds(raw.Duration) ?? 0),
      ...words.map((word) => (word.offset ?? 0) + (word.duration ?? 0)),
      1
    ),
  };

  result.sentences = buildSentenceGroups(result);
  return result;
}

function tokenizeTextWords(text) {
  return String(text || "").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
}

function transcriptSentenceParts(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return (
    clean
      .match(/[^.!?\u3002\uff01\uff1f]+(?:[.!?\u3002\uff01\uff1f]+|$)/g)
      ?.map((part) => part.trim())
      .filter(Boolean) || [clean]
  );
}

function cleanScriptLine(line) {
  const ipaBlockPattern =
    /\/[^/\n]*[\u0250-\u02AF\u02B0-\u02FF\u0300-\u036F\u1D00-\u1D7F\u1D80-\u1DBF\u02C8\u02CC\u02D0][^/\n]*\//gu;
  const looseIpaTokenPattern =
    /\/[^\s/\n]*[\u0250-\u02AF\u02B0-\u02FF\u0300-\u036F\u1D00-\u1D7F\u1D80-\u1DBF\u02C8\u02CC\u02D0][^\s/\n]*/gu;
  const cjkPattern = /[\u3400-\u9FFF\uF900-\uFAFF]/u;
  let cleaned = String(line || "")
    .replace(ipaBlockPattern, " ")
    .replace(looseIpaTokenPattern, " ")
    .replace(/[\[(\uFF08][^\])\uFF09\n]*[\u3400-\u9FFF\uF900-\uFAFF][^\])\uFF09\n]*[\])\uFF09]/gu, " ");

  cleaned = cleaned.replace(/\s+[-\u2013\u2014]\s+.*$/u, (chunk) =>
    cjkPattern.test(chunk) ? "" : chunk
  );
  cleaned = cleaned.replace(/[\u3400-\u9FFF\uF900-\uFAFF]+/gu, " ");
  return cleaned;
}

function cleanScriptText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .split("\n")
    .map(cleanScriptLine)
    .join("\n")
    .replace(/^[\s"']+|[\s"']+$/g, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCompareWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, "")
    .trim();
}

function buildScriptSentences(text) {
  let wordCursor = 0;
  return transcriptSentenceParts(text).map((sentence, index) => {
    const words = tokenizeTextWords(sentence);
    const startWordIndex = wordCursor;
    wordCursor += words.length;
    return {
      index,
      text: sentence,
      words,
      startWordIndex,
      endWordIndex: wordCursor,
    };
  });
}

function alignWordItems(scriptItems, recognizedItems) {
  const left = scriptItems.map((item) => normalizeCompareWord(item.word));
  const right = recognizedItems.map((item) => normalizeCompareWord(item.word));
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        left[i] && left[i] === right[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matchedScript = new Set();
  const matchedRecognized = new Set();
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] && left[i] === right[j]) {
      matchedScript.add(i);
      matchedRecognized.add(j);
      pairs.push({ scriptIndex: i, recognizedIndex: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return { matchedScript, matchedRecognized, pairs };
}

function compareWordItems(scriptItems, recognizedItems) {
  const alignment = alignWordItems(scriptItems, recognizedItems);
  const matchedScript = alignment.matchedScript;
  const matchedRecognized = alignment.matchedRecognized;
  const matchedCount = matchedScript.size;
  return {
    scriptWords: scriptItems.map((item, index) => ({ word: item.word, matched: matchedScript.has(index) })),
    recognizedWords: recognizedItems.map((item, index) => ({ word: item.word, matched: matchedRecognized.has(index) })),
    matchedCount,
    missingCount: Math.max(0, scriptItems.length - matchedCount),
    extraCount: Math.max(0, recognizedItems.length - matchedCount),
    matchScore: scriptItems.length ? (matchedCount / scriptItems.length) * 100 : null,
  };
}

function compareWords(scriptText, recognizedText) {
  const scriptItems = tokenizeTextWords(scriptText).map((word) => ({ word }));
  const recognizedItems = tokenizeTextWords(recognizedText).map((word) => ({ word }));
  return compareWordItems(scriptItems, recognizedItems);
}

function flattenScriptWordItems() {
  return state.scriptSentences.flatMap((sentence) =>
    sentence.words.map((word, localWordIndex) => ({
      word,
      scriptSentenceIndex: sentence.index,
      localWordIndex,
      globalWordIndex: sentence.startWordIndex + localWordIndex,
    }))
  );
}

function flattenRecognizedWordItems() {
  const result = state.result;
  if (!result) return [];
  const sentenceByWordIndex = new Map();
  (result.sentences || []).forEach((sentence) => {
    sentence.words.forEach((word) => {
      sentenceByWordIndex.set(word.wordIndex, sentence.index);
    });
  });
  return (result.words || []).map((word, index) => ({
    word: word.text,
    resultWord: word,
    globalWordIndex: index,
    recognizedSentenceIndex: sentenceByWordIndex.get(word.wordIndex),
  }));
}

function buildGlobalScriptAlignment() {
  const scriptItems = flattenScriptWordItems();
  const recognizedItems = flattenRecognizedWordItems();
  return {
    scriptItems,
    recognizedItems,
    alignment: alignWordItems(scriptItems, recognizedItems),
  };
}

function averageWordScore(words) {
  const scored = words.filter((word) => Number.isFinite(Number(word.accuracy)));
  if (!scored.length) return null;
  const totalWeight = scored.reduce((sum, word) => sum + Math.max(0.05, word.duration || 0.25), 0);
  return (
    scored.reduce((sum, word) => sum + Number(word.accuracy) * Math.max(0.05, word.duration || 0.25), 0) /
    totalWeight
  );
}

function wordGapBefore(words, index) {
  const word = words[index];
  const previousWord = words[index - 1];
  if (!word || !previousWord || word.offset === null || previousWord.offset === null || previousWord.duration === null) {
    return null;
  }
  return Math.max(0, word.offset - (previousWord.offset + previousWord.duration));
}

function splitWordsByPause(words) {
  const groups = [];
  let current = [];
  words.forEach((word, index) => {
    const gap = wordGapBefore(words, index);
    if (current.length && (gap > 0.85 || current.length >= 18)) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  });
  if (current.length) groups.push(current);
  return groups;
}

function makeSentenceGroup(text, words, index) {
  const sortedWords = [...words].sort((a, b) => (a.accuracy ?? 999) - (b.accuracy ?? 999));
  const first = words[0];
  const last = words[words.length - 1];
  const start = first?.offset ?? null;
  const end =
    last?.offset === null || last?.offset === undefined
      ? null
      : last.offset + (last.duration || 0);
  const breakSignals = words.filter((word) => {
    const feedback = wordBreakFeedback(word);
    return (
      feedback.errors.length > 0 ||
      (feedback.unexpectedConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD ||
      (feedback.missingConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD
    );
  });

  return {
    index,
    text: text || words.map((word) => word.text).join(" "),
    words,
    score: averageWordScore(words),
    worstWords: sortedWords.slice(0, 4),
    start,
    end,
    duration: start === null || end === null ? null : Math.max(0, end - start),
    breakSignals,
  };
}

function buildSentenceGroups(result) {
  const words = result.words || [];
  if (!words.length) return [];

  const parts = transcriptSentenceParts(result.transcript);
  const groups = [];
  let cursor = 0;
  parts.forEach((part) => {
    const count = tokenizeTextWords(part).length;
    if (!count) return;
    const sentenceWords = words.slice(cursor, cursor + count);
    cursor += count;
    if (sentenceWords.length) {
      groups.push(makeSentenceGroup(part, sentenceWords, groups.length));
    }
  });

  if (cursor < words.length) {
    splitWordsByPause(words.slice(cursor)).forEach((wordGroup) => {
      groups.push(makeSentenceGroup(wordGroup.map((word) => word.text).join(" "), wordGroup, groups.length));
    });
  }

  if (groups.length <= 1 && words.length > 18) {
    return splitWordsByPause(words).map((wordGroup, index) =>
      makeSentenceGroup(wordGroup.map((word) => word.text).join(" "), wordGroup, index)
    );
  }

  return groups.length ? groups : [makeSentenceGroup(words.map((word) => word.text).join(" "), words, 0)];
}

function feedbackValue(word, path, fallback = "-") {
  return path.reduce((current, key) => current?.[key], word?.feedback) ?? fallback;
}

function wordBreakErrors(word) {
  const errors = feedbackValue(word, ["Prosody", "Break", "ErrorTypes"], []);
  return Array.isArray(errors) ? errors.filter((item) => item && item !== "None") : [];
}

function wordBreakFeedback(word) {
  const unexpected = Number(feedbackValue(word, ["Prosody", "Break", "UnexpectedBreak", "Confidence"], null));
  const missing = Number(feedbackValue(word, ["Prosody", "Break", "MissingBreak", "Confidence"], null));
  const breakLength = Number(feedbackValue(word, ["Prosody", "Break", "BreakLength"], null));
  return {
    errors: wordBreakErrors(word),
    unexpectedConfidence: Number.isFinite(unexpected) ? unexpected : null,
    missingConfidence: Number.isFinite(missing) ? missing : null,
    breakLength: Number.isFinite(breakLength) ? breakLength : null,
  };
}

function wordIntonationErrors(word) {
  const errors = feedbackValue(word, ["Prosody", "Intonation", "ErrorTypes"], []);
  return Array.isArray(errors) ? errors.filter(Boolean) : [];
}

function getSelectedSentence() {
  const result = state.result;
  return result?.sentences?.[state.selectedSentence] || result?.sentences?.[0] || null;
}

function getSelectedWord() {
  const result = state.result;
  return result?.words?.[state.selectedWord] || null;
}

function selectSentence(index) {
  const result = state.result;
  if (!result?.sentences?.length) return;
  state.selectedSentence = Math.max(0, Math.min(result.sentences.length - 1, Number(index)));
  const sentence = getSelectedSentence();
  state.selectedWord = sentence?.worstWords?.[0]?.wordIndex ?? sentence?.words?.[0]?.wordIndex ?? 0;
  renderAll();
}

function selectWord(index, seek = false) {
  state.selectedWord = Number(index);
  const result = state.result;
  const sentenceIndex = result?.sentences?.findIndex((sentence) =>
    sentence.words.some((word) => word.wordIndex === state.selectedWord)
  );
  if (sentenceIndex >= 0) state.selectedSentence = sentenceIndex;
  const word = getSelectedWord();
  if (seek && word?.offset !== null) {
    els.resultAudio.currentTime = word.offset;
    els.resultAudio.play().catch(() => {});
  }
  renderAll();
}

function renderControls() {
  const isRecording = state.recorder?.state === "recording";
  els.recordButton.disabled = state.busy || state.recordingStarting || isRecording;
  els.stopButton.disabled = !isRecording;
  els.uploadButton.disabled = state.busy || !state.pendingRecording;
  els.recordButton.classList.toggle("recording", isRecording);
  if (els.micMonitorToggle) els.micMonitorToggle.checked = state.micMonitorEnabled;
}

function renderRecordingMeta() {
  let timerSeconds = state.lastRecordingSeconds;
  if (state.recorder?.state === "recording" && state.recordingStartedAt) {
    const elapsed = (Date.now() - state.recordingStartedAt) / 1000;
    timerSeconds = elapsed;
    els.recordingMeta.textContent = `Recording ${fmt(elapsed, 1)}s`;
    els.recordingTimer.textContent = formatTimer(timerSeconds);
    return;
  }
  if (state.pendingRecording) {
    els.recordingMeta.textContent = "Saved locally";
    els.recordingTimer.textContent = formatTimer(timerSeconds);
    return;
  }
  if (state.result?.cost?.audioSeconds) {
    els.recordingMeta.textContent = `${fmt(state.result.cost.audioSeconds, 1)}s assessed`;
    els.recordingTimer.textContent = formatTimer(state.result.cost.audioSeconds);
    return;
  }
  els.recordingMeta.textContent = "No recording";
  els.recordingTimer.textContent = formatTimer(timerSeconds);
}

function renderFiles() {
  if (!state.result && !state.pendingRecording) {
    els.latestFiles.innerHTML = "";
    els.resultAudio.removeAttribute("src");
    return;
  }

  if (!state.result && state.pendingRecording) {
    setAudioSource(els.resultAudio, state.pendingRecording.url);
    els.latestFiles.innerHTML = `<span class="stat-box"><span>Saved locally</span><strong>Upload</strong></span>`;
    return;
  }

  if (state.pendingRecording) {
    setAudioSource(els.resultAudio, state.pendingRecording.url);
  } else {
    setAudioSource(els.resultAudio, cacheBustUrl(state.result.audioUrl, state.result.runId));
  }

  const links = [
    ["Raw JSON", state.result.files?.rawJson],
    ["Words CSV", state.result.files?.wordsCsv],
    ["Phonemes CSV", state.result.files?.phonemesCsv],
  ].filter(([, href]) => href);

  els.latestFiles.innerHTML =
    links
      .map(([label, href]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`)
      .join("") +
    `<span class="stat-box"><span>Estimated</span><strong>$${Number(state.result.cost?.estimatedTotalUsd || 0).toFixed(4)}</strong></span>`;
}

function renderScores() {
  const result = state.result;
  const scores = [
    { label: "PronScore", value: result?.assessment?.PronScore, kind: "score" },
    { label: "Accuracy", value: result?.assessment?.AccuracyScore, kind: "score" },
    { label: "Fluency", value: result?.assessment?.FluencyScore, kind: "score" },
    { label: "Prosody", value: result?.assessment?.ProsodyScore, kind: "score" },
    { label: "Words", value: result?.words?.length, text: result ? String(result.words.length) : "-", kind: "count" },
  ];

  els.scoreGrid.innerHTML = scores
    .map((item) => {
      const color = item.kind === "count" ? "var(--blue)" : scoreColor(item.value);
      const barValue = item.kind === "count" ? Math.min(100, (Number(item.value) || 0) * 2) : item.value || 0;
      return `
        <article class="score-card">
          <span>${item.label}</span>
          <div class="score-value" style="color:${color}">${item.text || fmt(item.value, 1)}</div>
          <div class="score-bar">
            <div class="score-fill" style="--value:${pct(barValue)}; --score-color:${color}"></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function summarizeProsody(result) {
  const words = result?.words || [];
  const breakSignalWords = words.filter((word) => {
    const feedback = wordBreakFeedback(word);
    return (
      feedback.errors.length > 0 ||
      (feedback.unexpectedConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD ||
      (feedback.missingConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD
    );
  });
  const intonationIssueWords = words.filter((word) => wordIntonationErrors(word).length > 0);
  const lowWords = words.filter((word) => Number(word.accuracy) < 70);
  const longestSentence = [...(result?.sentences || [])].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
  return {
    score: result?.assessment?.ProsodyScore,
    lowWords,
    breakSignalWords,
    intonationIssueWords,
    longestSentence,
  };
}

function renderProsodyOverview() {
  const result = state.result;
  if (!result) {
    els.prosodyOverview.innerHTML = "";
    return;
  }
  const summary = summarizeProsody(result);
  const lowText = summary.lowWords.length
    ? summary.lowWords.slice(0, 8).map((word) => word.text).join(", ")
    : "None";
  const breakText = summary.breakSignalWords.length
    ? `${summary.breakSignalWords.length} break confidence signals`
    : "No break signals";
  const intonationText = summary.intonationIssueWords.length
    ? summary.intonationIssueWords.map((word) => `${word.text}: ${wordIntonationErrors(word).join(", ")}`).join("; ")
    : "No intonation flags";

  els.prosodyOverview.innerHTML = `
    <article class="prosody-card">
      <div>
        <p class="eyebrow">Prosody Diagnostics</p>
        <h2>Long-Response Signals</h2>
      </div>
      <div class="prosody-metrics">
        <div class="metric">
          <span>Prosody score</span>
          <strong style="color:${scoreColor(summary.score)}">${fmt(summary.score, 1)}</strong>
        </div>
        <div class="metric">
          <span>Sentences</span>
          <strong>${result.sentences.length}</strong>
        </div>
        <div class="metric">
          <span>Break signals</span>
          <strong>${summary.breakSignalWords.length}</strong>
        </div>
        <div class="metric">
          <span>Longest sentence</span>
          <strong>${summary.longestSentence ? `${fmt(summary.longestSentence.duration, 1)}s` : "-"}</strong>
        </div>
      </div>
      <div class="prosody-notes">
        <div class="feedback-item">
          <span>Low word scores</span>
          <strong>${escapeHtml(lowText)}</strong>
        </div>
        <div class="feedback-item">
          <span>Break flags</span>
          <strong>${escapeHtml(breakText)}</strong>
        </div>
        <div class="feedback-item">
          <span>Intonation flags</span>
          <strong>${escapeHtml(intonationText)}</strong>
        </div>
      </div>
    </article>
  `;
}

function scriptSentenceComparison(scriptSentence) {
  const global = buildGlobalScriptAlignment();
  const scriptItems = global.scriptItems.filter(
    (item) =>
      item.globalWordIndex >= scriptSentence.startWordIndex &&
      item.globalWordIndex < scriptSentence.endWordIndex
  );
  const matchedRecognizedIndexes = global.alignment.pairs
    .filter((pair) => {
      const item = global.scriptItems[pair.scriptIndex];
      return (
        item &&
        item.globalWordIndex >= scriptSentence.startWordIndex &&
        item.globalWordIndex < scriptSentence.endWordIndex
      );
    })
    .map((pair) => pair.recognizedIndex);

  let recognizedItems = [];
  if (matchedRecognizedIndexes.length > 0) {
    const start = Math.min(...matchedRecognizedIndexes);
    const end = Math.max(...matchedRecognizedIndexes) + 1;
    recognizedItems = global.recognizedItems.slice(start, end);
  }

  const recognizedSentenceIndexes = [
    ...new Set(
      recognizedItems
        .map((item) => item.recognizedSentenceIndex)
        .filter((index) => Number.isFinite(Number(index)))
    ),
  ];
  const recognized =
    recognizedItems.length > 0
      ? {
          text: recognizedItems.map((item) => item.word).join(" "),
          wordStart: recognizedItems[0].globalWordIndex,
          wordEnd: recognizedItems[recognizedItems.length - 1].globalWordIndex,
          sentenceIndexes: recognizedSentenceIndexes,
        }
      : null;

  return {
    recognized,
    diff: compareWordItems(scriptItems, recognizedItems),
  };
}

function renderWordDiffChips(words, missingClass) {
  if (!words.length) return `<span class="script-word-chip muted">-</span>`;
  return words
    .map(
      (item) =>
        `<span class="script-word-chip ${item.matched ? "matched" : missingClass}">${escapeHtml(item.word)}</span>`
    )
    .join("");
}

function recognizedSourceLabel(recognized) {
  if (!recognized) return "No recognized word span";
  const sentenceIndexes = recognized.sentenceIndexes || [];
  if (sentenceIndexes.length > 0) {
    const first = Math.min(...sentenceIndexes) + 1;
    const last = Math.max(...sentenceIndexes) + 1;
    return first === last
      ? `Azure sentence ${first}`
      : `Azure sentences ${first}-${last}`;
  }
  return `Azure words ${recognized.wordStart + 1}-${recognized.wordEnd + 1}`;
}

function renderScriptSentenceList() {
  if (!state.scriptSentences.length) {
    els.scriptSentenceList.innerHTML = `<div class="empty-state">Paste a script, then click Use Script.</div>`;
    return;
  }

  els.scriptSentenceList.innerHTML = state.scriptSentences
    .map((sentence) => {
      const { recognized, diff } = scriptSentenceComparison(sentence);
      const key = sentence.text;
      const cached = state.scriptTtsCache.get(key);
      const loading = state.scriptTtsLoadingKey === key;
      const color = !recognized || diff.matchScore === null ? "var(--muted)" : scoreColor(diff.matchScore);
      const bg = !recognized || diff.matchScore === null ? "#eef1eb" : scoreBg(diff.matchScore);
      return `
        <article class="script-sentence-card" style="--word-color:${color}; --word-bg:${bg}">
          <div class="script-sentence-head">
            <span class="sentence-number">${sentence.index + 1}</span>
            <span class="quality-pill" style="--word-color:${color}; --word-bg:${bg}">
              ${recognized ? fmt(diff.matchScore, 0) : "-"}
            </span>
          </div>
          <p>${escapeHtml(sentence.text)}</p>
          <span class="script-align-source">${escapeHtml(recognizedSourceLabel(recognized))}</span>
          <div class="script-sentence-actions">
            <button class="secondary-button compact-button" type="button" data-script-tts="${sentence.index}" ${loading ? "disabled" : ""}>
              ${loading ? "Generating..." : "Play Azure"}
            </button>
            <span>${cached ? (cached.cached ? "cached" : "ready") : "not requested"}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTranscriptCompare() {
  if (!state.scriptSentences.length && !state.result) {
    els.transcriptCompare.innerHTML = `<div class="empty-state">No transcript yet</div>`;
    return;
  }

  if (!state.scriptSentences.length) {
    const transcript = state.result?.transcript || "";
    els.transcriptCompare.innerHTML = transcript
      ? `<div class="transcript-card"><span>Azure transcript</span><p>${escapeHtml(transcript)}</p></div>`
      : `<div class="empty-state">No transcript yet</div>`;
    return;
  }

  els.transcriptCompare.innerHTML = state.scriptSentences
    .map((sentence) => {
      const { recognized, diff } = scriptSentenceComparison(sentence);
      const color = recognized ? scoreColor(diff.matchScore) : "var(--muted)";
      const bg = recognized ? scoreBg(diff.matchScore) : "#eef1eb";
      return `
        <article class="transcript-card" style="--word-color:${color}; --word-bg:${bg}">
          <div class="script-sentence-head">
            <span>Sentence ${sentence.index + 1}</span>
            <span class="quality-pill" style="--word-color:${color}; --word-bg:${bg}">
              ${recognized ? `${fmt(diff.matchScore, 0)}%` : "No match"}
            </span>
          </div>
          <div class="diff-block">
            <span>Script</span>
            <div>${renderWordDiffChips(diff.scriptWords, "missing")}</div>
          </div>
          <div class="diff-block">
            <span>Azure recognized</span>
            <div>${renderWordDiffChips(diff.recognizedWords, "extra")}</div>
          </div>
          <div class="script-diff-summary">
            <span>missing ${diff.missingCount}</span>
            <span>extra ${diff.extraCount}</span>
            <span>${escapeHtml(recognizedSourceLabel(recognized))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderScriptPanel() {
  renderSavedScriptList();
  renderScriptSentenceList();
  renderTranscriptCompare();
}

function scriptTitleFallback(text) {
  const cleaned = cleanScriptText(text);
  const firstSentence = transcriptSentenceParts(cleaned)[0] || cleaned;
  return firstSentence.slice(0, 72) || "Untitled script";
}

function formatScriptDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderSavedScriptList() {
  if (!els.savedScriptList) return;
  if (state.scriptsLoading) {
    els.savedScriptList.innerHTML = `<div class="empty-state">Loading saved scripts...</div>`;
    return;
  }
  if (!state.savedScripts.length) {
    els.savedScriptList.innerHTML = `<div class="empty-state">No saved scripts yet</div>`;
    return;
  }

  els.savedScriptList.innerHTML = state.savedScripts
    .map((script) => {
      const active = script.id === state.activeScriptId;
      const meta = formatScriptDate(script.updatedAt);
      return `
        <button class="saved-script-item ${active ? "active" : ""}" type="button" data-load-script="${escapeHtml(script.id)}">
          <strong>${escapeHtml(script.title || "Untitled script")}</strong>
          <span>${escapeHtml(meta || "saved")}</span>
        </button>
      `;
    })
    .join("");
}

function renderScriptEditorState() {
  if (els.deleteScriptButton) els.deleteScriptButton.disabled = !state.activeScriptId;
  if (els.scriptSaveStatus) els.scriptSaveStatus.textContent = state.scriptSaveStatus;
}

async function loadSavedScripts() {
  state.scriptsLoading = true;
  renderScriptPanel();
  try {
    const response = await fetch("/api/speaking-scripts", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Failed to load scripts");
    state.savedScripts = payload.scripts || [];
  } catch (error) {
    state.scriptSaveStatus = error.message || "Failed to load scripts";
  } finally {
    state.scriptsLoading = false;
    renderAll();
  }
}

function loadScriptIntoEditor(script) {
  state.activeScriptId = script.id;
  state.scriptSaveStatus = "Loaded";
  if (els.scriptTitleInput) els.scriptTitleInput.value = script.title || "";
  if (els.scriptInput) els.scriptInput.value = script.text || "";
  applyScriptFromInput({ preserveStatus: true });
}

function beginNewScript() {
  state.activeScriptId = null;
  state.scriptSaveStatus = "New script";
  state.scriptText = "";
  state.scriptSentences = [];
  state.scriptTtsLoadingKey = "";
  if (els.scriptTitleInput) els.scriptTitleInput.value = "";
  if (els.scriptInput) els.scriptInput.value = "";
  if (els.scriptAudio) els.scriptAudio.removeAttribute("src");
  renderAll();
}

async function saveCurrentScript() {
  const rawText = (els.scriptInput?.value || "").trim();
  if (!rawText) {
    alert("Paste or type a script before saving.");
    return;
  }
  const title = (els.scriptTitleInput?.value || "").trim() || scriptTitleFallback(rawText);
  if (els.scriptTitleInput) els.scriptTitleInput.value = title;

  state.scriptSaveStatus = "Saving...";
  renderScriptEditorState();
  try {
    const response = await fetch("/api/speaking-scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.activeScriptId,
        title,
        text: rawText,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Failed to save script");
    state.activeScriptId = payload.script?.id || state.activeScriptId;
    state.savedScripts = payload.scripts || state.savedScripts;
    state.scriptSaveStatus = "Saved";
    applyScriptFromInput({ preserveStatus: true });
  } catch (error) {
    state.scriptSaveStatus = error.message || "Failed to save";
  } finally {
    renderAll();
  }
}

async function deleteCurrentScript() {
  if (!state.activeScriptId) return;
  const title = els.scriptTitleInput?.value || "this script";
  const confirmed = window.confirm(`Delete "${title}"?`);
  if (!confirmed) return;

  state.scriptSaveStatus = "Deleting...";
  renderScriptEditorState();
  try {
    const response = await fetch(`/api/speaking-scripts/${encodeURIComponent(state.activeScriptId)}`, {
      method: "DELETE",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Failed to delete script");
    state.savedScripts = payload.scripts || [];
    beginNewScript();
    state.scriptSaveStatus = "Deleted";
    renderAll();
  } catch (error) {
    state.scriptSaveStatus = error.message || "Failed to delete";
    renderAll();
  }
}

function renderSpeakingStats() {
  const result = state.result;
  if (!result) {
    els.speakingStats.innerHTML = `
      <div class="stat-box"><span>Sentences</span><strong>-</strong></div>
      <div class="stat-box"><span>Lowest</span><strong>-</strong></div>
    `;
    return;
  }
  const worst = [...result.sentences].sort((a, b) => (a.score ?? 999) - (b.score ?? 999))[0];
  els.speakingStats.innerHTML = `
    <div class="stat-box"><span>Sentences</span><strong>${result.sentences.length}</strong></div>
    <div class="stat-box"><span>Lowest</span><strong>${fmt(worst?.score, 0)}</strong></div>
  `;
}

function renderSentenceList() {
  const result = state.result;
  if (!result) {
    els.sentenceList.innerHTML = `<div class="empty-state">No assessment yet</div>`;
    return;
  }

  const ordered = [...result.sentences].sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
  els.sentenceList.innerHTML = ordered
    .map((sentence) => {
      const color = scoreColor(sentence.score);
      const bg = scoreBg(sentence.score);
      const worst = sentence.worstWords[0];
      return `
        <button
          class="sentence-item ${sentence.index === state.selectedSentence ? "active" : ""}"
          type="button"
          data-sentence-index="${sentence.index}"
          style="--item-color:${color}; --item-bg:${bg}"
        >
          <span class="sentence-number">${sentence.index + 1}</span>
          <span>
            <span class="sentence-text">${escapeHtml(sentence.text)}</span>
            <span class="sentence-worst">Worst: ${escapeHtml(worst?.text || "-")} ${fmt(worst?.accuracy, 0)}</span>
          </span>
          <span class="sentence-score">${fmt(sentence.score, 0)}</span>
        </button>
      `;
    })
    .join("");
}

function renderSentenceDetail() {
  const sentence = getSelectedSentence();
  if (!sentence) {
    els.selectedSentenceTitle.textContent = "No result yet";
    els.sentenceMetrics.innerHTML = "";
    els.sentenceTranscript.innerHTML = `<div class="empty-state">Record and upload a response to see sentence groups.</div>`;
    els.sentenceWordChain.innerHTML = "";
    return;
  }

  const worst = sentence.worstWords[0];
  els.selectedSentenceTitle.textContent = `Sentence ${sentence.index + 1}`;
  els.sentenceMetrics.innerHTML = [
    ["Sentence score", fmt(sentence.score, 1)],
    ["Worst word", worst ? `${worst.text} ${fmt(worst.accuracy, 0)}` : "-"],
    ["Words", String(sentence.words.length)],
    ["Time", sentence.start === null || sentence.end === null ? "-" : `${fmt(sentence.start, 2)}s-${fmt(sentence.end, 2)}s`],
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  els.sentenceTranscript.innerHTML = `<p>${escapeHtml(sentence.text)}</p>`;
  els.sentenceWordChain.innerHTML = sentence.words
    .map((word) => {
      const color = scoreColor(word.accuracy);
      const bg = scoreBg(word.accuracy);
      return `
        <button
          class="sentence-word-chip ${word.wordIndex === state.selectedWord ? "active" : ""}"
          type="button"
          data-word-index="${word.wordIndex}"
          style="--word-color:${color}; --word-bg:${bg}"
        >
          <strong>${escapeHtml(word.text)}</strong>
          <span>${fmt(word.accuracy, 0)}</span>
        </button>
      `;
    })
    .join("");
}

function timelineBounds(result) {
  const start = result?.timelineStart ?? 0;
  const end = result?.timelineEnd ?? 1;
  return { start, end, span: Math.max(0.1, end - start) };
}

function renderRuler() {
  const result = state.result;
  if (!result) {
    els.timeRuler.innerHTML = "";
    return;
  }
  const { start, end, span } = timelineBounds(result);
  const step = span > 45 ? 5 : span > 18 ? 2 : 0.5;
  const count = Math.floor(span / step) + 1;
  els.timeRuler.innerHTML = Array.from({ length: count + 1 }, (_, index) => start + index * step)
    .filter((time) => time <= end + 0.001)
    .map((time) => {
      const left = ((time - start) / span) * 100;
      return `<span class="tick" style="--left:${left}%">${fmt(time, step >= 1 ? 0 : 1)}s</span>`;
    })
    .join("");
}

function renderTimeline() {
  const result = state.result;
  if (!result) {
    els.wordTimeline.innerHTML = `<div class="empty-state">No assessment yet</div>`;
    return;
  }
  const { start, span } = timelineBounds(result);
  els.wordTimeline.innerHTML = result.words
    .map((word, index) => {
      const left = word.offset === null ? 0 : ((word.offset - start) / span) * 100;
      const width = word.duration === null ? 8 : (word.duration / span) * 100;
      const color = scoreColor(word.accuracy);
      const bg = scoreBg(word.accuracy);
      return `
        <button
          class="word-bar ${index === state.selectedWord ? "active" : ""}"
          type="button"
          data-word-index="${index}"
          style="--left:${left}%; --width:${width}%; --mobile-top:${index * 36}px; --word-color:${color}; --word-bg:${bg}"
        >
          <strong>${escapeHtml(word.text)}</strong>
          <small>${fmt(word.offset)}s / ${fmt(word.accuracy, 0)}</small>
        </button>
      `;
    })
    .join("");
}

function renderWordList() {
  const sentence = getSelectedSentence();
  if (!sentence) {
    els.wordList.innerHTML = `<div class="empty-state">No words yet</div>`;
    return;
  }
  const words = [...sentence.words].sort((a, b) => (a.accuracy ?? 999) - (b.accuracy ?? 999));
  els.wordList.innerHTML = words
    .map((word) => {
      const color = scoreColor(word.accuracy);
      const bg = scoreBg(word.accuracy);
      return `
        <button
          class="word-button ${word.wordIndex === state.selectedWord ? "active" : ""}"
          type="button"
          data-word-index="${word.wordIndex}"
          style="--word-color:${color}; --word-bg:${bg}"
        >
          <span>
            <strong>${escapeHtml(word.text)}</strong>
            <span>${escapeHtml(word.errorType)} - ${fmt(word.offset)}s</span>
          </span>
          <span class="badge">${fmt(word.accuracy, 0)}</span>
        </button>
      `;
    })
    .join("");
}

function renderDetail() {
  const word = getSelectedWord();
  if (!word) {
    els.selectedWordTitle.textContent = "No result yet";
    els.detailMetrics.innerHTML = "";
    els.phonemeLane.innerHTML = `<div class="empty-state">No phonemes yet</div>`;
    els.syllableLane.innerHTML = "";
    els.feedbackGrid.innerHTML = "";
    return;
  }

  els.selectedWordTitle.textContent = word.text;
  els.detailMetrics.innerHTML = [
    ["Accuracy", fmt(word.accuracy, 1)],
    ["Error", word.errorType],
    ["Offset", `${fmt(word.offset)}s`],
    ["Duration", `${fmt(word.duration)}s`],
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");

  els.phonemeLane.innerHTML = word.phonemes
    .map((phoneme) => {
      const color = scoreColor(phoneme.accuracy);
      const candidates = phoneme.candidates
        .slice(0, 5)
        .map((candidate) => `${candidate.Phoneme}:${fmt(candidate.Score, 0)}`)
        .join(" | ");
      const candidateLabel = candidates ? `spoken candidates ${candidates}` : "spoken candidates -";
      return `
        <div class="phoneme-row">
          <div class="phoneme-symbol">${escapeHtml(phoneme.expected)}</div>
          <div>
            <div class="phoneme-bar">
              <div class="phoneme-fill" style="--value:${pct(phoneme.accuracy || 0)}; --score-color:${color}"></div>
            </div>
            <div class="candidate-line">${escapeHtml(candidateLabel)} | offset ${fmt(phoneme.offset)}s</div>
          </div>
          <div class="phoneme-score" style="--score-color:${color}">${fmt(phoneme.accuracy, 0)}</div>
        </div>
      `;
    })
    .join("");

  els.syllableLane.innerHTML =
    word.syllables.length > 0
      ? word.syllables
          .map(
            (item) => `
              <div class="syllable-chip">
                <span>${escapeHtml(item.grapheme || "")}</span>
                <strong>${escapeHtml(item.syllable)}</strong>
                <span>${fmt(item.accuracy, 0)} - ${fmt(item.offset)}s</span>
              </div>
            `
          )
          .join("")
      : `<div class="syllable-chip"><span>Syllable</span><strong>-</strong></div>`;

  const breakErrors = feedbackValue(word, ["Prosody", "Break", "ErrorTypes"], []);
  const intonationErrors = feedbackValue(word, ["Prosody", "Intonation", "ErrorTypes"], []);
  const feedbackItems = [
    ["Break errors", Array.isArray(breakErrors) && breakErrors.length ? breakErrors.join(", ") : "None"],
    ["Break length", feedbackValue(word, ["Prosody", "Break", "BreakLength"], "-")],
    ["Unexpected break", feedbackValue(word, ["Prosody", "Break", "UnexpectedBreak", "Confidence"], "-")],
    ["Missing break", feedbackValue(word, ["Prosody", "Break", "MissingBreak", "Confidence"], "-")],
    ["Intonation", Array.isArray(intonationErrors) && intonationErrors.length ? intonationErrors.join(", ") : "None"],
    ["Monotone", feedbackValue(word, ["Prosody", "Intonation", "Monotone", "SyllablePitchDeltaConfidence"], "-")],
  ];

  els.feedbackGrid.innerHTML = feedbackItems
    .map(([label, value]) => `<div class="feedback-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function describeBreakBefore(words, index) {
  const word = words[index];
  const previousWord = words[index - 1];
  if (!word || !previousWord) return null;
  const feedback = wordBreakFeedback(word);
  const actualGap = wordGapBefore(words, index);
  const hasUnexpectedSignal = (feedback.unexpectedConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD;
  const hasMissingSignal = (feedback.missingConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD;
  const explicitErrors = feedback.errors;
  let tone = "ok";
  let label = "No break error";
  if (actualGap === null) {
    tone = "unknown";
    label = "No timing";
  } else if (explicitErrors.length > 0) {
    tone = "bad";
    label = explicitErrors.join(", ");
  } else if (hasUnexpectedSignal) {
    tone = "bad";
    label = "Unexpected-break signal";
  } else if (hasMissingSignal) {
    tone = "warn";
    label = "Missing-break signal";
  }
  return {
    previousWord,
    word,
    actualGap,
    feedback,
    tone,
    label,
    hasUnexpectedSignal,
    hasMissingSignal,
  };
}

function renderWordsBreakMap() {
  const sentence = getSelectedSentence();
  if (!sentence) return `<div class="empty-state">No word chain yet</div>`;
  const words = sentence.words;
  const transitions = words.map((_, index) => describeBreakBefore(words, index)).filter(Boolean);
  const explicitBreakCount = transitions.filter((item) => item.feedback.errors.length > 0).length;
  const signalBreakCount = transitions.filter((item) => item.hasUnexpectedSignal || item.hasMissingSignal).length;
  const longestGap = transitions
    .map((item) => item.actualGap)
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);
  const chain = words
    .map((word, index) => {
      const hasWordError = word.errorType && word.errorType !== "None";
      const color = hasWordError ? "var(--red)" : scoreColor(word.accuracy);
      const bg = hasWordError ? "var(--soft-red)" : scoreBg(word.accuracy);
      const end = word.offset === null || word.duration === null ? null : word.offset + word.duration;
      const timeLabel = end === null ? "not detected" : `${fmt(word.offset, 2)}s-${fmt(end, 2)}s`;
      const cardWidth = Math.min(116, Math.max(74, 42 + String(word.text || "").length * 7));
      const transition = describeBreakBefore(words, index);
      const breakHtml = transition
        ? `
          <div class="break-link ${transition.tone}">
            <div class="break-line"></div>
            <strong>${escapeHtml(transition.label)}</strong>
            <span>gap ${fmt(transition.actualGap, 2)}s</span>
            <small>unexp ${fmt(transition.feedback.unexpectedConfidence, 2)} - miss ${fmt(transition.feedback.missingConfidence, 2)}</small>
          </div>
        `
        : "";

      return `
        ${breakHtml}
        <button
          class="word-chain-card ${word.wordIndex === state.selectedWord ? "active" : ""}"
          type="button"
          data-word-index="${word.wordIndex}"
          style="--word-color:${color}; --word-bg:${bg}; --card-width:${cardWidth}px"
        >
          <strong>${escapeHtml(word.text)}</strong>
          <span class="quality-pill" style="--word-color:${color}; --word-bg:${bg}">${fmt(word.accuracy, 0)}</span>
          ${hasWordError ? `<em>${escapeHtml(word.errorType)}</em>` : ""}
          <small>${escapeHtml(timeLabel)}</small>
        </button>
      `;
    })
    .join("");

  return `
    <div class="break-map">
      <div class="break-map-head">
        <div>
          <p class="eyebrow">Sentence Words + Breaks</p>
          <h2>Timing Inside Selected Sentence</h2>
        </div>
        <div class="break-summary">
          <span>Explicit errors <strong>${explicitBreakCount}</strong></span>
          <span>High signals <strong>${signalBreakCount}</strong></span>
          <span>Longest gap <strong>${fmt(longestGap, 2)}s</strong></span>
        </div>
      </div>
      <div class="break-chain">${chain}</div>
      <div class="break-help">
        <span><i class="break-dot ok"></i>No break error</span>
        <span><i class="break-dot warn"></i>Confidence signal at or above 0.75</span>
        <span><i class="break-dot bad"></i>Explicit break error or unexpected-break signal</span>
      </div>
    </div>
  `;
}

function renderSentenceTable() {
  const result = state.result;
  if (!result) return `<div class="empty-state">No sentence results yet</div>`;
  const ordered = [...result.sentences].sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Sentence</th>
            <th>Score</th>
            <th>Worst words</th>
            <th>Time</th>
            <th>Break signals</th>
          </tr>
        </thead>
        <tbody>
          ${ordered
            .map((sentence, rank) => {
              const color = scoreColor(sentence.score);
              const bg = scoreBg(sentence.score);
              const worstWords = sentence.worstWords.map((word) => `${word.text} ${fmt(word.accuracy, 0)}`).join(", ");
              return `
                <tr>
                  <td>${rank + 1}</td>
                  <td>${escapeHtml(sentence.text)}</td>
                  <td><span class="quality-pill" style="--word-color:${color}; --word-bg:${bg}">${fmt(sentence.score, 1)}</span></td>
                  <td>${escapeHtml(worstWords || "-")}</td>
                  <td>${sentence.start === null || sentence.end === null ? "-" : `${fmt(sentence.start, 2)}s-${fmt(sentence.end, 2)}s`}</td>
                  <td>${sentence.breakSignals.length}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPhonemeTable(rows) {
  if (!rows || rows.length === 0) return `<div class="empty-state">No phonemes yet</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Word</th>
            <th>Expected</th>
            <th>Best</th>
            <th>Accuracy</th>
            <th>Offset</th>
            <th>Duration</th>
            <th>Spoken candidates</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((item) => {
              const color = scoreColor(item.accuracy);
              const bg = scoreBg(item.accuracy);
              const nbestText = item.candidates
                .slice(0, 5)
                .map((candidate) => `${candidate.Phoneme}:${fmt(candidate.Score, 0)}`)
                .join(" | ");
              return `
                <tr>
                  <td>${escapeHtml(item.word)}</td>
                  <td>${escapeHtml(item.expected)}</td>
                  <td>${escapeHtml(item.best)}</td>
                  <td><span class="quality-pill" style="--word-color:${color}; --word-bg:${bg}">${fmt(item.accuracy, 0)}</span></td>
                  <td>${fmt(item.offset)}s</td>
                  <td>${fmt(item.duration)}s</td>
                  <td>${escapeHtml(nbestText)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTab() {
  if (state.currentView === "sentences") els.tabPanel.innerHTML = renderSentenceTable();
  if (state.currentView === "words") els.tabPanel.innerHTML = renderWordsBreakMap();
  if (state.currentView === "phonemes") els.tabPanel.innerHTML = renderPhonemeTable(state.result?.phonemes);
  if (state.currentView === "low") {
    const lowRows = [...(state.result?.phonemes || [])]
      .sort((a, b) => (a.accuracy ?? 999) - (b.accuracy ?? 999))
      .slice(0, 24);
    els.tabPanel.innerHTML = renderPhonemeTable(lowRows);
  }
}

function renderPlayhead() {
  const result = state.result;
  if (!result || !els.resultAudio.duration) {
    els.playhead.style.setProperty("--playhead-left", "0%");
    return;
  }
  const { start, span } = timelineBounds(result);
  const left = ((els.resultAudio.currentTime - start) / span) * 100;
  els.playhead.style.setProperty("--playhead-left", pct(left));
}

function renderAll() {
  renderControls();
  renderRecordingMeta();
  renderFiles();
  renderScores();
  renderProsodyOverview();
  renderScriptEditorState();
  renderScriptPanel();
  renderSpeakingStats();
  renderSentenceList();
  renderSentenceDetail();
  renderRuler();
  renderTimeline();
  renderWordList();
  renderDetail();
  renderTab();
  renderPlayhead();
}

async function startRecording() {
  if (state.busy || state.recordingStarting || state.recorder?.state === "recording") return;
  state.recordingStarting = true;
  state.pendingRecording = null;
  state.lastRecordingSeconds = null;
  setStatus("Starting mic", "busy");
  renderAll();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    state.stream = stream;
    state.activeStreams.add(stream);
    state.chunks = [];
    const mimeType = chooseMimeType();
    state.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.chunks.push(event.data);
    });
    state.recorder.addEventListener("stop", handleRecordingStopped);
    state.recorder.start();
    await startMicMonitor(state.stream);
    state.recordingStartedAt = Date.now();
    state.durationTimer = window.setInterval(renderRecordingMeta, 250);
    setStatus("Recording", "recording");
  } catch (error) {
    stopAllRecordingTracks();
    setStatus("Mic blocked", "busy");
    alert(error.message || "Microphone permission failed");
  } finally {
    state.recordingStarting = false;
    renderAll();
  }
}

function stopRecording({ upload = false } = {}) {
  state.uploadAfterStop = upload;
  const recorder = state.recorder;
  if (!recorder || recorder.state !== "recording") {
    stopAllRecordingTracks();
    renderAll();
    return;
  }
  recorder.stop();
  setStatus(upload ? "Stopping and uploading" : "Recording saved", upload ? "busy" : "done");
  state.busy = upload;
  renderAll();
}

function stopRecordingWithoutUpload() {
  state.stopWithoutUpload = true;
  stopRecording({ upload: false });
}

function handleRecordingStopped() {
  if (state.durationTimer) {
    window.clearInterval(state.durationTimer);
    state.durationTimer = null;
  }
  const type = state.recorder?.mimeType || "audio/webm";
  const blob = new Blob(state.chunks, { type });
  stopAllRecordingTracks();
  if (state.pendingRecording?.url) URL.revokeObjectURL(state.pendingRecording.url);
  state.pendingRecording = {
    blob,
    type,
    url: URL.createObjectURL(blob),
  };
  state.recorder = null;
  state.stream = null;
  state.chunks = [];
  state.lastRecordingSeconds = state.recordingStartedAt
    ? (Date.now() - state.recordingStartedAt) / 1000
    : state.lastRecordingSeconds;
  state.recordingStartedAt = null;

  if (state.uploadAfterStop) {
    state.uploadAfterStop = false;
    state.stopWithoutUpload = false;
    uploadPendingRecording();
    return;
  }

  state.busy = false;
  state.stopWithoutUpload = false;
  setStatus("Saved locally", "done");
  renderAll();
}

async function uploadPendingRecording() {
  if (!state.pendingRecording || state.uploadInProgress) return;
  const recording = state.pendingRecording;
  if (!recording.blob || recording.blob.size === 0) {
    state.pendingRecording = null;
    setStatus("Empty recording", "busy");
    renderAll();
    alert("Recording was empty. Press Space once to start recording, then press Space again after speaking.");
    return;
  }

  state.uploadInProgress = true;
  state.busy = true;
  setStatus("Uploading", "busy");
  renderAll();

  try {
    const form = new FormData();
    if (state.scriptText) form.append("scriptText", state.scriptText);
    form.append("language", "en-US");
    form.append("phonemeAlphabet", "IPA");
    form.append("nbestPhonemeCount", "5");
    form.append("enableProsody", "true");
    form.append(
      "audio",
      recording.blob,
      `recording.${recording.type.includes("ogg") ? "ogg" : "webm"}`
    );

    const response = await fetch("/api/assess-speaking", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) {
      const details = payload.details ? `\n\n${payload.details}` : "";
      throw new Error(`${payload.error || "Assessment failed"}${details}`);
    }

    state.result = normalizeResult(payload);
    state.pendingRecording = null;
    state.selectedSentence = 0;
    selectSentence([...state.result.sentences].sort((a, b) => (a.score ?? 999) - (b.score ?? 999))[0]?.index || 0);
    setStatus("Done", "done");
  } catch (error) {
    setStatus("Failed", "busy");
    alert(error.message || "Assessment failed");
  } finally {
    state.busy = false;
    state.uploadInProgress = false;
    state.uploadAfterStop = false;
    state.stopWithoutUpload = false;
    renderAll();
  }
}

function applyScriptFromInput(options = {}) {
  state.scriptText = cleanScriptText(els.scriptInput.value);
  state.scriptSentences = buildScriptSentences(state.scriptText);
  state.scriptTtsLoadingKey = "";
  if (!options.preserveStatus) {
    state.scriptSaveStatus = state.activeScriptId ? "Applied saved script" : "Applied";
  }
  renderAll();
}

function clearScript() {
  beginNewScript();
  state.scriptSaveStatus = "Cleared";
  renderAll();
}

async function playScriptSentenceAudio(index) {
  const sentence = state.scriptSentences[Number(index)];
  if (!sentence) return;
  if (state.recorder?.state === "recording") {
    alert("Stop recording before playing script audio, otherwise the prompt sound may be recorded into your answer.");
    return;
  }

  const key = sentence.text;
  const cached = state.scriptTtsCache.get(key);
  if (cached?.audioUrl) {
    setAudioSource(els.scriptAudio, cached.audioUrl);
    await els.scriptAudio.play().catch(() => {});
    return;
  }

  state.scriptTtsLoadingKey = key;
  setStatus("Generating script audio", "busy");
  renderScriptPanel();

  try {
    const response = await fetch("/api/tts-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence.text }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Azure audio failed");
    state.scriptTtsCache.set(key, payload);
    setAudioSource(els.scriptAudio, payload.audioUrl);
    setStatus(payload.cached ? "Audio cached" : "Audio ready", "done");
    renderScriptPanel();
    await els.scriptAudio.play().catch(() => {});
  } catch (error) {
    setStatus("Audio failed", "busy");
    alert(error.message || "Azure audio failed");
  } finally {
    state.scriptTtsLoadingKey = "";
    renderScriptPanel();
  }
}

function handleSpaceShortcut() {
  if (state.recordingStarting || state.uploadInProgress) return true;
  if (state.recorder?.state === "recording") {
    stopRecording({ upload: true });
    return true;
  }
  if (state.pendingRecording) {
    uploadPendingRecording();
    return true;
  }
  startRecording();
  return true;
}

function scrollMainPageByKeyboard(direction) {
  window.scrollBy({ top: direction * KEYBOARD_SCROLL_STEP, behavior: "smooth" });
  return true;
}

function handleShortcut(code) {
  if (code === "Space") return handleSpaceShortcut();
  if (code === "KeyM") {
    stopRecordingWithoutUpload();
    return true;
  }
  if (code === "KeyW") return scrollMainPageByKeyboard(-1);
  if (code === "KeyS") return scrollMainPageByKeyboard(1);
  return false;
}

function initMicMonitorControls() {
  if (!els.micMonitorToggle) return;
  els.micMonitorToggle.checked = state.micMonitorEnabled;
  els.micMonitorToggle.addEventListener("change", async () => {
    state.micMonitorEnabled = els.micMonitorToggle.checked;
    writeMicMonitorSetting(state.micMonitorEnabled);
    if (!state.micMonitorEnabled) {
      stopMicMonitor();
      renderControls();
      return;
    }
    if (state.stream && state.recorder?.state === "recording") {
      await startMicMonitor(state.stream);
    }
    renderControls();
  });
}

function initEvents() {
  initMicMonitorControls();
  els.recordButton.addEventListener("click", startRecording);
  els.stopButton.addEventListener("click", stopRecordingWithoutUpload);
  els.uploadButton.addEventListener("click", uploadPendingRecording);
  els.seekWordButton.addEventListener("click", () => selectWord(state.selectedWord, true));
  els.applyScriptButton.addEventListener("click", applyScriptFromInput);
  els.saveScriptButton.addEventListener("click", saveCurrentScript);
  els.newScriptButton.addEventListener("click", beginNewScript);
  els.deleteScriptButton.addEventListener("click", deleteCurrentScript);
  els.clearScriptButton.addEventListener("click", clearScript);
  [els.scriptTitleInput, els.scriptInput].forEach((input) => {
    input?.addEventListener("input", () => {
      state.scriptSaveStatus = state.activeScriptId ? "Unsaved edits" : "Not saved";
      renderScriptEditorState();
    });
  });
  els.resultAudio.addEventListener("timeupdate", renderPlayhead);

  document.addEventListener("click", (event) => {
    const loadScriptButton = event.target.closest("[data-load-script]");
    if (loadScriptButton) {
      const script = state.savedScripts.find((item) => item.id === loadScriptButton.dataset.loadScript);
      if (script) loadScriptIntoEditor(script);
      return;
    }

    const scriptTtsButton = event.target.closest("[data-script-tts]");
    if (scriptTtsButton) {
      playScriptSentenceAudio(Number(scriptTtsButton.dataset.scriptTts));
      return;
    }

    const sentenceButton = event.target.closest("[data-sentence-index]");
    if (sentenceButton) {
      selectSentence(Number(sentenceButton.dataset.sentenceIndex));
      return;
    }
    const wordButton = event.target.closest("[data-word-index]");
    if (wordButton) {
      selectWord(Number(wordButton.dataset.wordIndex));
    }
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentView = button.dataset.view;
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      renderTab();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (isTextEntryTarget(event.target)) return;
    const handled = handleShortcut(event.code || "");
    if (handled) event.preventDefault();
  });
}

initEvents();
renderAll();
loadSavedScripts();
