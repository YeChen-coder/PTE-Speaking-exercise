const tick = 10000000;
const appMode = document.body.dataset.mode || "read";
const isRepeatMode = appMode === "repeat";
const isWordsMode = appMode === "words";
const hasPromptAudio = isRepeatMode || isWordsMode;
const usesRepeatStyleControls = isRepeatMode || isWordsMode;
const isManualUploadMode = isRepeatMode || isWordsMode;
const collectionEndpoint = isWordsMode ? "/api/word-items" : "/api/sentences";
const collectionPayloadKey = isWordsMode ? "items" : "sentences";
const REWARD_SOUND_STORAGE_KEY = "practiceRewardSoundEnabled";
const REWARD_VOLUME_STORAGE_KEY = "practiceRewardSoundVolume";
const CONTROLLER_ENABLED_STORAGE_KEY = "practiceControllerEnabled";
const SHOW_ALL_TEXT_STORAGE_KEY = "repeatShowAllText";
const MIC_MONITOR_STORAGE_KEY = "repeatMicMonitor";
const MONOTONE_PROMPT_STORAGE_KEY = "repeatMonotonePrompt";
const BREAK_CONFIDENCE_THRESHOLD = 0.75;
const GAMEPAD_SCROLL_DEADZONE = 0.22;
const GAMEPAD_SCROLL_STEP = 22;
const WORD_STACK_STICK_REPEAT_MS = 230;
const XINPUT_SCROLL_STEP = 70;
const KEYBOARD_SCROLL_STEP = 220;
const XINPUT_TRIGGER_THRESHOLD = 24;
const REWARD_AUDIO_URLS = {
  unbelievable: "/static/reward_sounds/unbelievable.mp3",
  great: "/static/reward_sounds/great.mp3",
  other: "/static/reward_sounds/other.mp3",
};
const GAMEPAD_BUTTON_CODES_STANDARD = {
  0: "ArrowDown",
  1: "ArrowRight",
  2: "ArrowLeft",
  3: "ArrowUp",
  4: "RevealText",
  5: "StopNoUpload",
  9: "Space",
};
const GAMEPAD_BUTTON_LABELS_STANDARD = {
  0: "A / Down",
  1: "B / Right",
  2: "X / Left",
  3: "Y / Up",
  4: "Left Shoulder / Reveal Text",
  5: "Right Shoulder / Stop",
  9: "Menu / Upload",
};
const GAMEPAD_BUTTON_CODES_XBOX_BLUETOOTH = {
  0: "ArrowDown",
  1: "ArrowRight",
  2: "ArrowLeft",
  3: "ArrowUp",
  6: "RevealText",
  7: "StopNoUpload",
  9: "Space",
};
const GAMEPAD_BUTTON_LABELS_XBOX_BLUETOOTH = {
  0: "A / Down",
  1: "B / Right",
  2: "X / Left",
  3: "Y / Up",
  6: "Left Shoulder / Reveal Text",
  7: "Right Shoulder / Stop",
  9: "Menu / Upload",
};
const XINPUT_BUTTON_CODES = {
  A: "ArrowDown",
  B: "ArrowRight",
  X: "ArrowLeft",
  Y: "ArrowUp",
  LEFT_SHOULDER: "RevealText",
  RIGHT_SHOULDER: "StopNoUpload",
  START: "Space",
  DPAD_UP: "ArrowUp",
  DPAD_DOWN: "ArrowDown",
  DPAD_LEFT: "ArrowLeft",
  DPAD_RIGHT: "ArrowRight",
};
const XINPUT_BUTTON_LABELS = {
  A: "A / Down",
  B: "B / Right",
  X: "X / Left",
  Y: "Y / Up",
  LEFT_SHOULDER: "Left Shoulder / Reveal Text",
  RIGHT_SHOULDER: "Right Shoulder / Stop",
  START: "Start / Upload",
  DPAD_UP: "DPad Up",
  DPAD_DOWN: "DPad Down",
  DPAD_LEFT: "DPad Left",
  DPAD_RIGHT: "DPad Right",
};

const state = {
  sentences: [],
  index: 0,
  results: new Map(),
  revealedSentences: new Set(),
  showAllText: readShowAllTextSetting(),
  monotonePromptEnabled: readMonotonePromptSetting(),
  micMonitorEnabled: readMicMonitorSetting(),
  micMonitorContext: null,
  micMonitorSource: null,
  micMonitorGain: null,
  speedrunActive: false,
  selectedWord: 0,
  currentView: "words",
  recorder: null,
  recordingStarting: false,
  recordingStartId: 0,
  stream: null,
  activeStreams: new Set(),
  chunks: [],
  pendingRecording: null,
  uploadInProgress: false,
  uploadAfterStop: false,
  stopWithoutUpload: false,
  afterStopAction: null,
  promptTimer: null,
  rewardSoundEnabled: readRewardSoundSetting(),
  rewardSoundVolume: readRewardVolumeSetting(),
  controllerEnabled: readControllerEnabledSetting(),
  rewardAudios: new Map(),
  pitchCompareRunId: null,
  pitchCompareData: null,
  pitchCompareLoading: false,
  pitchCompareError: "",
  machineModeRunId: null,
  machineModeData: null,
  machineModeLoading: false,
  machineModeError: "",
  phonemeSpeedRunId: null,
  phonemeSpeedData: null,
  phonemeSpeedLoading: false,
  phonemeSpeedError: "",
  gamepadButtons: new Map(),
  xinputButtons: new Map(),
  xinputConnected: false,
  xinputPollInFlight: false,
  wordStickLastMoveAt: 0,
  wordStickDirection: 0,
  busy: false,
};

const els = {
  sentenceList: document.querySelector("#sentenceList"),
  queueStats: document.querySelector("#queueStats"),
  sentenceCounter: document.querySelector("#sentenceCounter"),
  statusPill: document.querySelector("#statusPill"),
  gamepadStatus: document.querySelector("#gamepadStatus"),
  gamepadDebug: document.querySelector("#gamepadDebug"),
  gamepadDetectButton: document.querySelector("#gamepadDetectButton"),
  controllerToggle: document.querySelector("#controllerToggle"),
  showAllTextToggle: document.querySelector("#showAllTextToggle"),
  monotonePromptToggle: document.querySelector("#monotonePromptToggle"),
  micMonitorToggle: document.querySelector("#micMonitorToggle"),
  currentSentence: document.querySelector("#currentSentence"),
  prevButton: document.querySelector("#prevButton"),
  nextButton: document.querySelector("#nextButton"),
  recordButton: document.querySelector("#recordButton"),
  stopButton: document.querySelector("#stopButton"),
  uploadButton: document.querySelector("#uploadButton"),
  speedrunButton: document.querySelector("#speedrunButton"),
  playPromptButton: document.querySelector("#playPromptButton"),
  playMonotonePromptButton: document.querySelector("#playMonotonePromptButton"),
  revealTextButton: document.querySelector("#revealTextButton"),
  promptAudio: document.querySelector("#promptAudio"),
  promptStatus: document.querySelector("#promptStatus"),
  rewardSoundToggle: document.querySelector("#rewardSoundToggle"),
  rewardVolumeSlider: document.querySelector("#rewardVolumeSlider"),
  resultAudio: document.querySelector("#resultAudio"),
  latestFiles: document.querySelector("#latestFiles"),
  scoreGrid: document.querySelector("#scoreGrid"),
  prosodyOverview: document.querySelector("#prosodyOverview"),
  machineModeSection: document.querySelector("#machineModeSection"),
  pitchCompareSection: document.querySelector("#pitchCompareSection"),
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
  sentenceDialog: document.querySelector("#sentenceDialog"),
  sentenceEditor: document.querySelector("#sentenceEditor"),
  editSentencesButton: document.querySelector("#editSentencesButton"),
  saveSentencesButton: document.querySelector("#saveSentencesButton"),
  addItemForm: document.querySelector("#addItemForm"),
  addItemInput: document.querySelector("#addItemInput"),
};

function readRewardSoundSetting() {
  try {
    return window.localStorage.getItem(REWARD_SOUND_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeRewardSoundSetting(value) {
  try {
    window.localStorage.setItem(REWARD_SOUND_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function readRewardVolumeSetting() {
  try {
    const storedRaw = window.localStorage.getItem(REWARD_VOLUME_STORAGE_KEY);
    if (storedRaw !== null) {
      const stored = Number(storedRaw);
      if (Number.isFinite(stored)) return Math.max(0, Math.min(1, stored));
    }
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
  return 0.65;
}

function writeRewardVolumeSetting(value) {
  try {
    window.localStorage.setItem(REWARD_VOLUME_STORAGE_KEY, String(value));
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function readControllerEnabledSetting() {
  try {
    return window.localStorage.getItem(CONTROLLER_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeControllerEnabledSetting(value) {
  try {
    window.localStorage.setItem(CONTROLLER_ENABLED_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function readShowAllTextSetting() {
  if (!isRepeatMode) return false;
  try {
    return window.localStorage.getItem(SHOW_ALL_TEXT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeShowAllTextSetting(value) {
  try {
    window.localStorage.setItem(SHOW_ALL_TEXT_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function readMonotonePromptSetting() {
  if (!isRepeatMode) return false;
  try {
    return window.localStorage.getItem(MONOTONE_PROMPT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeMonotonePromptSetting(value) {
  try {
    window.localStorage.setItem(MONOTONE_PROMPT_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function readMicMonitorSetting() {
  if (!isRepeatMode) return false;
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

const seconds = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value) / tick;
};

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
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

const pct = (value) => `${Math.max(0, Math.min(100, value))}%`;

function isTextEntryTarget(target) {
  return (
    target instanceof HTMLTextAreaElement ||
    target === els.addItemInput ||
    target?.isContentEditable
  );
}

function shortcutCodeFromEvent(event) {
  if (event.code) return event.code;
  const key = String(event.key || "").toLowerCase();
  const fallbackCodes = {
    " ": "Space",
    spacebar: "Space",
    e: "KeyE",
    m: "KeyM",
    p: "KeyP",
    s: "KeyS",
    w: "KeyW",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
  };
  return fallbackCodes[key] || "";
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

function getCurrentResult() {
  return state.results.get(state.index) || null;
}

function getPromptEndpoint(index) {
  return isWordsMode ? `/api/word-tts/${index}` : `/api/tts/${index}`;
}

function getMonotonePromptEndpoint(index) {
  return `/api/tts-monotone/${index}`;
}

function collectionFromPayload(payload) {
  return payload[collectionPayloadKey] || payload.sentences || payload.items || [];
}

function normalizeResult(result) {
  const raw = result.raw || {};
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

  return {
    ...result,
    nbest,
    assessment: nbest.PronunciationAssessment || {},
    words,
    phonemes: words.flatMap((word) => word.phonemes),
    timelineStart: seconds(raw.Offset) ?? 0,
    timelineEnd: Math.max(
      (seconds(raw.Offset) ?? 0) + (seconds(raw.Duration) ?? 0),
      ...words.map((word) => (word.offset ?? 0) + (word.duration ?? 0))
    ),
  };
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

function setGamepadStatus(text, tone = "ready") {
  if (!els.gamepadStatus) return;
  els.gamepadStatus.textContent = text;
  const colors = {
    ready: ["var(--soft-blue)", "var(--blue)"],
    connected: ["var(--soft-green)", "var(--green)"],
    active: ["var(--soft-amber)", "var(--amber)"],
  };
  const [bg, color] = colors[tone] || colors.ready;
  els.gamepadStatus.style.background = bg;
  els.gamepadStatus.style.color = color;
}

function setGamepadDebug(text) {
  if (!els.gamepadDebug) return;
  els.gamepadDebug.textContent = text;
}

function showControllerDisabled() {
  setGamepadStatus("Pad: disabled", "ready");
  setGamepadDebug("Controller input disabled. Keyboard and mouse still work.");
}

function readGamepadSnapshot() {
  const hasApi = Boolean(window.navigator?.getGamepads);
  if (!hasApi) {
    return {
      hasApi,
      connectedCount: 0,
      pads: [],
      firstPad: null,
      pressedLabels: [],
    };
  }

  const pads = Array.from(window.navigator.getGamepads()).filter(Boolean);
  const pressedLabels = [];
  pads.forEach((gamepad) => {
    gamepad.buttons.forEach((button, index) => {
      const value = Number(button?.value || 0);
      if (button?.pressed || value > 0.05) {
        pressedLabels.push(`B${index}:${value.toFixed(2)}`);
      }
    });
    gamepad.axes.forEach((value, index) => {
      if (Math.abs(value) > 0.5) {
        pressedLabels.push(`A${index}:${value.toFixed(2)}`);
      }
    });
  });

  return {
    hasApi,
    connectedCount: pads.length,
    pads,
    firstPad: pads[0] || null,
    pressedLabels,
  };
}

function browserGamepadLayout(gamepad) {
  return gamepad?.mapping === "standard" ? "standard" : "xbox-bluetooth";
}

function browserGamepadCodes(gamepad) {
  return browserGamepadLayout(gamepad) === "standard"
    ? GAMEPAD_BUTTON_CODES_STANDARD
    : GAMEPAD_BUTTON_CODES_XBOX_BLUETOOTH;
}

function browserGamepadLabels(gamepad) {
  return browserGamepadLayout(gamepad) === "standard"
    ? GAMEPAD_BUTTON_LABELS_STANDARD
    : GAMEPAD_BUTTON_LABELS_XBOX_BLUETOOTH;
}

function updateGamepadDebugFromSnapshot(snapshot) {
  if (!snapshot.hasApi) {
    setGamepadStatus("Pad: API unavailable", "ready");
    setGamepadDebug(`Gamepad: API unavailable | secure=${window.isSecureContext ? "yes" : "no"}`);
    return;
  }
  if (!snapshot.firstPad) {
    setGamepadStatus("Pad: press a button", "ready");
    setGamepadDebug(
      `Gamepad: API available | secure=${window.isSecureContext ? "yes" : "no"} | no controller exposed yet`
    );
    return;
  }

  const pressedText = snapshot.pressedLabels.length ? snapshot.pressedLabels.join(", ") : "none";
  const layout = browserGamepadLayout(snapshot.firstPad);
  const mapping = snapshot.firstPad.mapping || "none";
  setGamepadDebug(
    `Gamepad: ${snapshot.connectedCount} connected | ${snapshot.firstPad.id || "unknown"} | mapping ${mapping} | layout ${layout} | buttons ${snapshot.firstPad.buttons.length} | axes ${snapshot.firstPad.axes.length} | pressed ${pressedText}`
  );
}

function scaledAxisValue(value, deadzone = GAMEPAD_SCROLL_DEADZONE) {
  const number = Number(value) || 0;
  const magnitude = Math.abs(number);
  if (magnitude < deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(number) * scaled * scaled;
}

function scrollMainPageFromStick(value, maxStep = GAMEPAD_SCROLL_STEP) {
  if (document.querySelector("dialog[open]")) return;
  const scaled = scaledAxisValue(value);
  if (!scaled) return;
  window.scrollBy({ top: scaled * maxStep, left: 0, behavior: "auto" });
}

function scrollMainPageByKeyboard(direction) {
  if (document.querySelector("dialog[open]")) return false;
  window.scrollBy({ top: direction * KEYBOARD_SCROLL_STEP, left: 0, behavior: "auto" });
  return true;
}

function scrollSelectedWordIntoView() {
  window.requestAnimationFrame(() => {
    els.wordList
      ?.querySelector(".word-button.active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  });
}

function isTextHidden(index) {
  if (isRepeatMode) return !state.showAllText && !state.revealedSentences.has(index);
  if (isWordsMode) return state.revealedSentences.has(index);
  return false;
}

function hiddenTextLabel(index) {
  return isWordsMode ? `Item ${index + 1}` : `Sentence ${index + 1}`;
}

function moveSelectedWord(direction) {
  const result = getCurrentResult();
  if (!result?.words?.length) return false;
  const nextIndex = Math.max(0, Math.min(result.words.length - 1, state.selectedWord + direction));
  if (nextIndex === state.selectedWord) return false;
  selectWord(nextIndex, true);
  return true;
}

function moveSelectedWordFromStick(value) {
  const scaled = scaledAxisValue(value, 0.35);
  const direction = scaled > 0 ? 1 : scaled < 0 ? -1 : 0;
  if (!direction) {
    state.wordStickDirection = 0;
    return;
  }

  const now = window.performance.now();
  const isNewDirection = direction !== state.wordStickDirection;
  if (isNewDirection || now - state.wordStickLastMoveAt >= WORD_STACK_STICK_REPEAT_MS) {
    if (moveSelectedWord(direction)) {
      state.wordStickLastMoveAt = now;
    }
    state.wordStickDirection = direction;
  }
}

function cacheBustUrl(url, key) {
  if (!url || url.startsWith("blob:")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(key || Date.now())}`;
}

function setAudioSource(audio, url) {
  if (!audio || !url) return;
  if (audio.getAttribute("src") !== url) {
    audio.src = url;
    audio.load();
  }
}

function renderQueue() {
  const scored = [...state.results.values()].length;
  const scores = [...state.results.values()].map((result) => result.assessment?.PronScore).filter(Number.isFinite);
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  const totalCost = [...state.results.values()].reduce(
    (sum, result) => sum + (Number(result.cost?.estimatedTotalUsd) || 0),
    0
  );
  const totalAudioSeconds = [...state.results.values()].reduce(
    (sum, result) => sum + (Number(result.cost?.audioSeconds) || 0),
    0
  );

  els.queueStats.innerHTML = [
    ["Total", state.sentences.length],
    ["Done", scored],
    ["Avg", average === null ? "-" : fmt(average, 1)],
    ["Est $", scored ? `$${totalCost.toFixed(4)}` : "-"],
    ["Audio", scored ? `${fmt(totalAudioSeconds, 1)}s` : "-"],
  ]
    .map(([label, value]) => `<div class="stat-box"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  els.sentenceList.innerHTML = state.sentences
    .map((sentence, index) => {
      const result = state.results.get(index);
      const score = result?.assessment?.PronScore;
      const color = scoreColor(score);
      const bg = scoreBg(score);
      const visibleSentence = isTextHidden(index) ? hiddenTextLabel(index) : sentence;
      return `
        <button
          class="sentence-item ${index === state.index ? "active" : ""}"
          type="button"
          data-sentence-index="${index}"
          style="--item-color:${color}; --item-bg:${bg}"
        >
          <span class="sentence-number">${index + 1}</span>
          <span class="sentence-text">${escapeHtml(visibleSentence)}</span>
          <span class="sentence-score">${score === undefined ? "-" : fmt(score, 0)}</span>
        </button>
      `;
    })
    .join("");
}

function renderStage() {
  const total = state.sentences.length;
  els.sentenceCounter.textContent = total ? `${state.index + 1} / ${total}` : "0 / 0";
  const currentText = state.sentences[state.index] || (isWordsMode ? "No words loaded" : "No sentences loaded");
  const shouldMask = total && isTextHidden(state.index);
  els.currentSentence.textContent = shouldMask ? hiddenTextLabel(state.index) : currentText;
  els.currentSentence.classList.toggle("masked", Boolean(shouldMask));
  els.prevButton.disabled = state.busy || state.index <= 0;
  els.nextButton.disabled = state.busy || state.index >= total - 1;
  els.recordButton.disabled = state.busy || state.recordingStarting || !total;
  els.stopButton.disabled = !state.recordingStarting && (!state.recorder || state.recorder.state !== "recording");
  if (els.uploadButton) {
    els.uploadButton.disabled = state.busy || !state.pendingRecording;
  }
  if (els.playPromptButton) els.playPromptButton.disabled = state.busy || !total;
  if (els.playMonotonePromptButton) {
    els.playMonotonePromptButton.disabled = !isRepeatMode || state.busy || !total;
  }
  if (els.speedrunButton) {
    els.speedrunButton.disabled = !isRepeatMode || !total || (!state.speedrunActive && (state.busy || state.uploadInProgress));
    els.speedrunButton.textContent = state.speedrunActive ? "Pause Speedrun" : "Start Speedrun";
    els.speedrunButton.classList.toggle("active", state.speedrunActive);
  }
  if (els.showAllTextToggle) {
    els.showAllTextToggle.checked = state.showAllText;
  }
  if (els.monotonePromptToggle) {
    els.monotonePromptToggle.checked = state.monotonePromptEnabled;
  }
  if (els.micMonitorToggle) {
    els.micMonitorToggle.checked = state.micMonitorEnabled;
  }
  if (els.revealTextButton) {
    els.revealTextButton.disabled = !total;
    els.revealTextButton.textContent = isTextHidden(state.index) ? "Reveal Text" : "Hide Text";
  }

  const result = getCurrentResult();
  if (!state.busy && state.pendingRecording) {
    setStatus("Saved. Space uploads.", "done");
  } else if (!state.busy && state.recordingStarting) {
    setStatus("Starting mic", "busy");
  } else if (!state.busy && result) {
    setStatus(`Scored ${fmt(result.assessment?.PronScore, 1)}`, "done");
  } else if (!state.busy && !result && !state.recorder && !state.recordingStarting) {
    setStatus("Ready", "ready");
  }
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stopMediaStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function stopAllRecordingTracks() {
  stopMicMonitor();
  state.activeStreams.forEach((stream) => stopMediaStream(stream));
  state.activeStreams.clear();
  stopMediaStream(state.stream);
}

async function startMicMonitor(stream) {
  if (!stream || !state.micMonitorEnabled || state.micMonitorContext) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  try {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const gain = context.createGain();
    gain.gain.value = 0.85;
    source.connect(gain);
    gain.connect(context.destination);
    state.micMonitorContext = context;
    state.micMonitorSource = source;
    state.micMonitorGain = gain;
    if (context.state === "suspended") {
      await context.resume();
    }
  } catch (error) {
    console.warn(error.message || "Mic monitor failed");
    stopMicMonitor();
  }
}

function stopMicMonitor() {
  try {
    state.micMonitorSource?.disconnect();
  } catch {
    // Already disconnected.
  }
  try {
    state.micMonitorGain?.disconnect();
  } catch {
    // Already disconnected.
  }
  const context = state.micMonitorContext;
  state.micMonitorSource = null;
  state.micMonitorGain = null;
  state.micMonitorContext = null;
  if (context && context.state !== "closed") {
    context.close().catch(() => {});
  }
}

async function playBeep() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    await sleep(180);
    return;
  }
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  await sleep(230);
  await context.close();
}

function rewardFromScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "other";
  if (value >= 85) return "unbelievable";
  if (value >= 80) return "great";
  return "other";
}

function getRewardAudio(reward) {
  const url = REWARD_AUDIO_URLS[reward];
  if (!url) return null;
  if (!state.rewardAudios.has(reward)) {
    const audio = new Audio(url);
    audio.preload = "auto";
    state.rewardAudios.set(reward, audio);
  }
  return state.rewardAudios.get(reward);
}

function applyRewardVolume() {
  state.rewardAudios.forEach((audio) => {
    audio.volume = state.rewardSoundVolume;
  });
}

async function playRewardAudio(reward) {
  if (!state.rewardSoundEnabled || !reward) return;

  try {
    const audio = getRewardAudio(reward);
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = state.rewardSoundVolume;
    await audio.play();
  } catch (error) {
    console.warn(error.message || "Reward audio failed");
  }
}

function clearPromptTimer() {
  if (state.promptTimer) {
    window.clearTimeout(state.promptTimer);
    state.promptTimer = null;
  }
}

function stopPromptPlayback() {
  clearPromptTimer();
  if (!els.promptAudio) return;
  els.promptAudio.onended = null;
  els.promptAudio.pause();
  try {
    els.promptAudio.currentTime = 0;
  } catch {
    // Some browsers reject seeking while metadata is not ready yet.
  }
}

async function playPrompt(index = state.index, options = {}) {
  if (!hasPromptAudio || !state.sentences.length) return;
  const isMonotoneReference = Boolean(options.monotone || (isRepeatMode && state.monotonePromptEnabled));
  const shouldAutoRecord = usesRepeatStyleControls && Boolean(options.autoRecord);
  stopPromptPlayback();
  try {
    if (els.promptStatus) {
      els.promptStatus.textContent = isMonotoneReference
        ? "Preparing monotone reference..."
        : "Preparing prompt audio...";
    }
    setStatus(isMonotoneReference ? "Loading monotone" : "Loading prompt", "busy");
    const response = await fetch(isMonotoneReference ? getMonotonePromptEndpoint(index) : getPromptEndpoint(index));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Audio failed");

    if (els.promptAudio) {
      els.promptAudio.src = payload.audioUrl;
      els.promptAudio.load();
      await els.promptAudio.play();
    }
    if (els.promptStatus) {
      const label = isMonotoneReference
        ? (payload.source === "windows-sapi" ? "local flat reference" : "monotone reference")
        : "prompt audio";
      els.promptStatus.textContent = payload.cached
        ? `Loaded ${label} from cache (${payload.voice})`
        : `Generated and cached ${label} (${payload.voice})`;
    }
    if (!state.busy) setStatus(isMonotoneReference ? "Monotone playing" : "Prompt playing", "done");
    if (shouldAutoRecord && els.promptAudio) {
      els.promptAudio.onended = async () => {
        els.promptAudio.onended = null;
        if (state.index !== index || state.busy || state.recorder?.state === "recording") return;
        if (els.promptStatus) els.promptStatus.textContent = "Wait 2 seconds, then record.";
        state.promptTimer = window.setTimeout(async () => {
          state.promptTimer = null;
          if (state.index !== index || state.busy || state.recorder?.state === "recording") return;
          setStatus("Beep", "busy");
          await playBeep();
          await startRecording();
        }, 2000);
      };
    }
  } catch (error) {
    if (els.promptStatus) els.promptStatus.textContent = error.message || "Prompt audio failed";
    if (!state.busy) setStatus("Prompt failed", "busy");
  }
}

function renderFiles(result) {
  if (!result && !state.pendingRecording) {
    els.latestFiles.innerHTML = "";
    els.resultAudio.removeAttribute("src");
    return;
  }

  if (!result && state.pendingRecording) {
    setAudioSource(els.resultAudio, state.pendingRecording.url);
    els.latestFiles.innerHTML = `<span class="stat-box"><span>Saved locally</span><strong>Press Space</strong></span>`;
    return;
  }

  setAudioSource(els.resultAudio, cacheBustUrl(result.audioUrl, result.runId));
  const links = [
    ["Raw JSON", result.files?.rawJson],
    ["Words CSV", result.files?.wordsCsv],
    ["Phonemes CSV", result.files?.phonemesCsv],
  ].filter(([, href]) => href);

  els.latestFiles.innerHTML = links
    .map(([label, href]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`)
    .join("") +
    `<span class="stat-box"><span>Estimated</span><strong>$${Number(result.cost?.estimatedTotalUsd || 0).toFixed(4)}</strong></span>`;
}

function renderScores(result) {
  const scores = [
    ["PronScore", result?.assessment?.PronScore],
    ["Accuracy", result?.assessment?.AccuracyScore],
    ["Fluency", result?.assessment?.FluencyScore],
    ["Completeness", result?.assessment?.CompletenessScore],
    ["Prosody", result?.assessment?.ProsodyScore],
  ];

  els.scoreGrid.innerHTML = scores
    .map(([label, value]) => {
      const color = scoreColor(value);
      return `
        <article class="score-card">
          <span>${label}</span>
          <div class="score-value" style="color:${color}">${fmt(value, 1)}</div>
          <div class="score-bar">
            <div class="score-fill" style="--value:${pct(value || 0)}; --score-color:${color}"></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function timelineBounds(result) {
  const start = result?.timelineStart ?? 0;
  const end = result?.timelineEnd ?? 1;
  return { start, end, span: Math.max(0.1, end - start) };
}

function renderRuler(result) {
  if (!result) {
    els.timeRuler.innerHTML = "";
    return;
  }
  const { start, end, span } = timelineBounds(result);
  const step = 0.5;
  const count = Math.floor(span / step) + 1;
  els.timeRuler.innerHTML = Array.from({ length: count + 1 }, (_, index) => start + index * step)
    .filter((time) => time <= end + 0.001)
    .map((time) => {
      const left = ((time - start) / span) * 100;
      return `<span class="tick" style="--left:${left}%">${fmt(time, 1)}s</span>`;
    })
    .join("");
}

function renderTimeline(result) {
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

function renderWordList(result) {
  if (!result) {
    els.wordList.innerHTML = `<div class="empty-state">No words yet</div>`;
    return;
  }

  els.wordList.innerHTML = result.words
    .map((word, index) => {
      const color = scoreColor(word.accuracy);
      const bg = scoreBg(word.accuracy);
      const timingSummary = wordPhonemeTimingSummary(result, index);
      const timingClass = timingSummary ? `has-timing-${timingSummary.tone}` : "";
      return `
        <button
          class="word-button ${timingClass} ${index === state.selectedWord ? "active" : ""}"
          type="button"
          data-word-index="${index}"
          style="--word-color:${color}; --word-bg:${bg}"
        >
          <span class="word-button-main">
            <strong>${escapeHtml(word.text)}</strong>
            ${renderWordPhonemeTimingTags(timingSummary)}
            <span>${escapeHtml(word.errorType)} · ${fmt(word.offset)}s</span>
          </span>
          <span class="badge">${fmt(word.accuracy, 0)}</span>
        </button>
      `;
    })
    .join("");
}

function feedbackValue(word, path, fallback = "-") {
  return path.reduce((current, key) => current?.[key], word?.feedback) ?? fallback;
}

function wordPitchDelta(word) {
  const value = feedbackValue(word, ["Prosody", "Intonation", "Monotone", "SyllablePitchDeltaConfidence"], null);
  return value === null || value === "-" ? null : Number(value);
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

function wordGapBefore(result, index) {
  const word = result?.words?.[index];
  const previousWord = result?.words?.[index - 1];
  if (!word || !previousWord || word.offset === null || previousWord.offset === null || previousWord.duration === null) {
    return null;
  }
  return Math.max(0, word.offset - (previousWord.offset + previousWord.duration));
}

function wordGapAfter(result, index) {
  const word = result?.words?.[index];
  const nextWord = result?.words?.[index + 1];
  if (!word || !nextWord || word.offset === null || word.duration === null || nextWord.offset === null) return null;
  return Math.max(0, nextWord.offset - (word.offset + word.duration));
}

function describeBreakBefore(result, index) {
  const word = result?.words?.[index];
  const previousWord = result?.words?.[index - 1];
  if (!word || !previousWord) return null;

  const feedback = wordBreakFeedback(word);
  const actualGap = wordGapBefore(result, index);
  const hasTiming = actualGap !== null;
  const hasUnexpectedSignal = (feedback.unexpectedConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD;
  const hasMissingSignal = (feedback.missingConfidence ?? 0) >= BREAK_CONFIDENCE_THRESHOLD;
  const explicitErrors = feedback.errors;
  let tone = "ok";
  let label = "No break error";

  if (!hasTiming) {
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

function summarizeProsody(result) {
  const words = result?.words || [];
  const pitchValues = words.map(wordPitchDelta).filter(Number.isFinite);
  const averagePitch =
    pitchValues.length > 0
      ? pitchValues.reduce((sum, value) => sum + value, 0) / pitchValues.length
      : null;
  const lowPitchWords = words.filter((word) => {
    const value = wordPitchDelta(word);
    return Number.isFinite(value) && value < 0.5;
  });
  const breakIssueWords = words.filter((word) => wordBreakErrors(word).length > 0);
  const breakSignalWords = words.filter((_, index) => {
    const transition = describeBreakBefore(result, index);
    return transition && (transition.hasUnexpectedSignal || transition.hasMissingSignal);
  });
  const intonationIssueWords = words.filter((word) => wordIntonationErrors(word).length > 0);
  const gaps = words.map((_, index) => wordGapAfter(result, index)).filter(Number.isFinite);
  const longestGap = gaps.length ? Math.max(...gaps) : null;

  return {
    score: result?.assessment?.ProsodyScore,
    wordCount: words.length,
    averagePitch,
    lowPitchWords,
    breakIssueWords,
    breakSignalWords,
    intonationIssueWords,
    longestGap,
  };
}

function renderProsodyOverview(result) {
  if (!els.prosodyOverview) return;
  if (!result) {
    els.prosodyOverview.innerHTML = "";
    return;
  }

  const summary = summarizeProsody(result);
  const lowPitchText = summary.lowPitchWords.length
    ? `${summary.lowPitchWords.length}/${summary.wordCount} words below 0.50`
    : "No low pitch-delta words";
  const lowPitchWords = summary.lowPitchWords
    .slice(0, 8)
    .map((word) => word.text)
    .join(", ");
  const lowPitchList =
    lowPitchWords && summary.lowPitchWords.length > 8
      ? `${lowPitchWords}, +${summary.lowPitchWords.length - 8} more`
      : lowPitchWords;
  const breakText = summary.breakIssueWords.length
    ? summary.breakIssueWords.map((word) => `${word.text}: ${wordBreakErrors(word).join(", ")}`).join("; ")
    : summary.breakSignalWords.length
      ? `${summary.breakSignalWords.length} high break confidence signals`
      : "No break error flags";
  const intonationText = summary.intonationIssueWords.length
    ? summary.intonationIssueWords.map((word) => `${word.text}: ${wordIntonationErrors(word).join(", ")}`).join("; ")
    : "No intonation error flags";

  els.prosodyOverview.innerHTML = `
    <article class="prosody-card">
      <div>
        <p class="eyebrow">Prosody Diagnostics</p>
        <h2>Sentence-Level Signals</h2>
      </div>
      <div class="prosody-metrics">
        <div class="metric">
          <span>Prosody score</span>
          <strong style="color:${scoreColor(summary.score)}">${fmt(summary.score, 1)}</strong>
        </div>
        <div class="metric">
          <span>Avg pitch delta</span>
          <strong>${summary.averagePitch === null ? "-" : fmt(summary.averagePitch, 2)}</strong>
        </div>
        <div class="metric">
          <span>Low pitch signal</span>
          <strong>${escapeHtml(lowPitchText)}</strong>
        </div>
        <div class="metric">
          <span>Longest word gap</span>
          <strong>${summary.longestGap === null ? "-" : `${fmt(summary.longestGap, 2)}s`}</strong>
        </div>
      </div>
      <div class="prosody-notes">
        <div class="feedback-item">
          <span>Low pitch words</span>
          <strong>${escapeHtml(lowPitchList || "None")}</strong>
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

function pitchPointX(point, wordCount) {
  if (point.wordIndex === null || point.wordIndex === undefined || wordCount <= 0) return null;
  const position = Math.max(0, Math.min(1, Number(point.wordPosition || 0)));
  return ((Number(point.wordIndex) + position) / wordCount) * 1000;
}

function pitchPointY(point, yMin, yMax) {
  if (point.semitone === null || point.semitone === undefined) return null;
  const span = Math.max(1, yMax - yMin);
  const normalized = (Number(point.semitone) - yMin) / span;
  return 230 - Math.max(0, Math.min(1, normalized)) * 190;
}

function renderPitchSeries(points, wordCount, yMin, yMax, className) {
  const segments = [];
  let current = [];
  let lastX = null;
  points.forEach((point) => {
    const x = pitchPointX(point, wordCount);
    const y = pitchPointY(point, yMin, yMax);
    if (x === null || y === null) {
      if (current.length > 1) segments.push(current);
      current = [];
      lastX = null;
      return;
    }
    if (lastX !== null && x - lastX > 50) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(`${fmt(x, 1)},${fmt(y, 1)}`);
    lastX = x;
  });
  if (current.length > 1) segments.push(current);
  return segments
    .map((segment) => `<polyline class="${className}" points="${segment.join(" ")}"></polyline>`)
    .join("");
}

function renderPitchComparisonGraph(data) {
  const wordCount = Math.max(data.reference?.words?.length || 0, data.user?.words?.length || 0, 1);
  const yMin = Number(data.yMin ?? -6);
  const yMax = Number(data.yMax ?? 6);
  const grid = Array.from({ length: wordCount + 1 }, (_, index) => {
    const x = (index / wordCount) * 1000;
    return `<line class="pitch-grid-line" x1="${fmt(x, 1)}" y1="24" x2="${fmt(x, 1)}" y2="236"></line>`;
  }).join("");
  const labels = (data.user?.words || data.reference?.words || [])
    .map((word, index) => {
      const x = ((index + 0.5) / wordCount) * 1000;
      return `<text class="pitch-word-label" x="${fmt(x, 1)}" y="256">${escapeHtml(word.word || "")}</text>`;
    })
    .join("");
  const zeroY = 230 - ((0 - yMin) / Math.max(1, yMax - yMin)) * 190;
  return `
    <svg class="pitch-graph" viewBox="0 0 1000 270" role="img" aria-label="Reference and recorded pitch comparison">
      <rect class="pitch-graph-bg" x="0" y="0" width="1000" height="270"></rect>
      ${grid}
      <line class="pitch-zero-line" x1="0" y1="${fmt(zeroY, 1)}" x2="1000" y2="${fmt(zeroY, 1)}"></line>
      ${renderPitchSeries(data.reference?.contour || [], wordCount, yMin, yMax, "pitch-line reference")}
      ${renderPitchSeries(data.user?.contour || [], wordCount, yMin, yMax, "pitch-line user")}
      ${labels}
    </svg>
  `;
}

function pitchIssueClass(item) {
  if (item.note === "flatter than reference") return "bad";
  if (item.note === "pitch level differs" || item.note === "weak pitch detection") return "warn";
  return "ok";
}

function renderPitchComparisonWords(data) {
  return (data.comparison || [])
    .map((item) => {
      const issueClass = pitchIssueClass(item);
      const ref = item.referenceWord || {};
      const user = item.userWord || {};
      return `
        <button class="pitch-word-card ${issueClass}" type="button" data-word-index="${item.index}">
          <strong>${escapeHtml(item.word || ref.word || user.word || "-")}</strong>
          <span>Ref range ${fmt(ref.rangeSemitone, 1)} st</span>
          <span>Your range ${fmt(user.rangeSemitone, 1)} st</span>
          <em>${escapeHtml(item.note || "OK")}</em>
        </button>
      `;
    })
    .join("");
}

function renderPitchCompare(result) {
  if (!els.pitchCompareSection) return;
  if (!result) {
    els.pitchCompareSection.innerHTML = "";
    return;
  }

  const hasData = state.pitchCompareData && state.pitchCompareRunId === result.runId;
  const body = state.pitchCompareLoading
    ? `<div class="empty-state">Building pitch comparison...</div>`
    : state.pitchCompareError
      ? `<div class="empty-state">${escapeHtml(state.pitchCompareError)}</div>`
      : hasData
        ? `
          <div class="pitch-meta">
            <span><i class="pitch-dot reference"></i>Reference Azure audio</span>
            <span><i class="pitch-dot user"></i>Your recording</span>
            <span>Boundary: ${escapeHtml(state.pitchCompareData.reference?.boundarySource || "-")}</span>
            <span>Median Hz ref/user: ${fmt(state.pitchCompareData.reference?.medianHz, 0)} / ${fmt(state.pitchCompareData.user?.medianHz, 0)}</span>
          </div>
          ${renderPitchComparisonGraph(state.pitchCompareData)}
          <div class="pitch-word-grid">
            ${renderPitchComparisonWords(state.pitchCompareData)}
          </div>
        `
        : `<div class="empty-state">Compare pitch movement against the cached Azure prompt audio.</div>`;

  els.pitchCompareSection.innerHTML = `
    <article class="pitch-card">
      <div class="pitch-head">
        <div>
          <p class="eyebrow">Pitch Comparison</p>
          <h2>Reference Audio vs Your Recording</h2>
        </div>
        <button class="secondary-button compact-button" type="button" data-pitch-compare>
          ${hasData ? "Rebuild" : "Build"}
        </button>
      </div>
      <p class="pitch-note">This uses relative pitch, centered inside each audio, so voice gender/range does not dominate the comparison.</p>
      ${body}
    </article>
  `;
}

async function loadPitchComparison() {
  const result = getCurrentResult();
  if (!result || state.pitchCompareLoading) return;
  state.pitchCompareLoading = true;
  state.pitchCompareError = "";
  renderPitchCompare(result);
  try {
    const response = await fetch("/api/prosody-compare/latest", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Pitch comparison failed");
    state.pitchCompareData = payload;
    state.pitchCompareRunId = result.runId;
  } catch (error) {
    state.pitchCompareData = null;
    state.pitchCompareRunId = null;
    state.pitchCompareError = error.message || "Pitch comparison failed";
  } finally {
    state.pitchCompareLoading = false;
    renderPitchCompare(result);
  }
}

function machineToneFromScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "warn";
  if (value >= 78) return "ok";
  if (value >= 58) return "warn";
  return "bad";
}

function renderMachineMetric(label, value, detail, score) {
  const tone = machineToneFromScore(score);
  return `
    <div class="machine-metric machine-${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(detail)}</em>
    </div>
  `;
}

function machineTimeX(time, duration) {
  return (Math.max(0, Math.min(duration, Number(time) || 0)) / Math.max(0.1, duration)) * 1000;
}

function machinePitchY(value, yMin, yMax) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const span = Math.max(1, yMax - yMin);
  return 226 - Math.max(0, Math.min(1, (Number(value) - yMin) / span)) * 176;
}

function machineEnergyY(value, energyMin, energyMax) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const span = Math.max(1, energyMax - energyMin);
  return 226 - Math.max(0, Math.min(1, (Number(value) - energyMin) / span)) * 176;
}

function renderMachineSeries(points, duration, valueGetter, yGetter, className) {
  const segments = [];
  let current = [];
  let lastX = null;
  points.forEach((point) => {
    const rawValue = valueGetter(point);
    const y = yGetter(rawValue);
    if (y === null) {
      if (current.length > 1) segments.push(current);
      current = [];
      lastX = null;
      return;
    }
    const x = machineTimeX(point.time, duration);
    if (lastX !== null && x - lastX > 40) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(`${fmt(x, 1)},${fmt(y, 1)}`);
    lastX = x;
  });
  if (current.length > 1) segments.push(current);
  return segments
    .map((segment) => `<polyline class="${className}" points="${segment.join(" ")}"></polyline>`)
    .join("");
}

function renderMachineGraph(data) {
  const points = data.contour?.points || [];
  const words = data.words || [];
  const duration = Math.max(
    0.1,
    Number(data.contour?.duration || 0),
    ...words.map((word) => Number(word.end || 0))
  );
  const yMin = Number(data.yMin ?? -6);
  const yMax = Number(data.yMax ?? 6);
  const energyMin = Number(data.energyMinDb ?? -60);
  const energyMax = Number(data.energyMaxDb ?? -20);
  const pitchTop = machinePitchY(2, yMin, yMax);
  const pitchBottom = machinePitchY(-2, yMin, yMax);
  const pitchBandY = Math.min(pitchTop ?? 70, pitchBottom ?? 180);
  const pitchBandHeight = Math.abs((pitchBottom ?? 180) - (pitchTop ?? 70));
  const wordLines = words
    .map((word) => {
      const x = machineTimeX(word.start, duration);
      return `<line class="machine-word-line" x1="${fmt(x, 1)}" y1="42" x2="${fmt(x, 1)}" y2="238"></line>`;
    })
    .join("");
  const labelStep = words.length > 8 ? Math.ceil(words.length / 8) : 1;
  const wordLabels = words
    .filter((_, index) => index % labelStep === 0 || index === words.length - 1)
    .map((word) => {
      const start = Number(word.start || 0);
      const end = Number(word.end || start);
      const x = machineTimeX((start + end) / 2, duration);
      const label = String(word.word || "").slice(0, 10);
      return `<text class="machine-word-label" x="${fmt(x, 1)}" y="260">${escapeHtml(label)}</text>`;
    })
    .join("");

  return `
    <svg class="machine-graph" viewBox="0 0 1000 276" role="img" aria-label="Monotone speech pitch and energy diagnostics">
      <rect class="machine-graph-bg" x="0" y="0" width="1000" height="276"></rect>
      <rect class="machine-target-band" x="0" y="${fmt(pitchBandY, 1)}" width="1000" height="${fmt(pitchBandHeight, 1)}"></rect>
      ${wordLines}
      <line class="machine-zero-line" x1="0" y1="${fmt(machinePitchY(0, yMin, yMax), 1)}" x2="1000" y2="${fmt(machinePitchY(0, yMin, yMax), 1)}"></line>
      ${renderMachineSeries(points, duration, (point) => point.semitone, (value) => machinePitchY(value, yMin, yMax), "machine-line pitch")}
      ${renderMachineSeries(points, duration, (point) => point.rmsDb, (value) => machineEnergyY(value, energyMin, energyMax), "machine-line energy")}
      ${wordLabels}
    </svg>
  `;
}

function machineWordTone(word) {
  if (word.tone === "bad") return "bad";
  if (word.tone === "warn") return "warn";
  return "ok";
}

function renderMachineWords(data) {
  const words = data.words || [];
  if (!words.length) return `<div class="empty-state">No word timing available</div>`;
  return `
    <div class="machine-word-grid">
      ${words
        .map((word) => {
          const tone = machineWordTone(word);
          const flags = word.flags?.length ? word.flags.join(", ") : "flat flow";
          return `
            <button class="machine-word-card machine-${tone}" type="button" data-word-index="${word.index}">
              <strong>${escapeHtml(word.word || "-")}</strong>
              <span>pitch ${fmt(word.pitchRangeSemitone, 1)} st</span>
              <span>stress ${fmt(word.energyLiftDb, 1)} dB</span>
              <span>gap ${word.gapBefore === null || word.gapBefore === undefined ? "-" : `${fmt(word.gapBefore, 2)}s`}</span>
              <em>${escapeHtml(flags)}</em>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMachineMode(result) {
  if (!els.machineModeSection) return;
  if (!result) {
    els.machineModeSection.innerHTML = "";
    return;
  }

  const hasData = state.machineModeData && state.machineModeRunId === result.runId;
  const summary = state.machineModeData?.summary || {};
  const body = state.machineModeLoading
    ? `<div class="empty-state">Building local Monotone Speech analysis...</div>`
    : state.machineModeError
      ? `<div class="empty-state">${escapeHtml(state.machineModeError)}</div>`
      : hasData
        ? `
          <div class="machine-score-row">
            <div class="machine-main-score machine-${machineToneFromScore(summary.machineScore)}">
              <span>Monotone Score</span>
              <strong>${fmt(summary.machineScore, 1)}</strong>
              <em>higher means flatter, steadier, less expressive</em>
            </div>
            <div class="machine-metrics">
              ${renderMachineMetric("Pitch Flatness", `${fmt(summary.pitchFlatnessScore, 0)}`, `${fmt(summary.pitchRangeSemitone, 1)} st range`, summary.pitchFlatnessScore)}
              ${renderMachineMetric("Low Stress", `${fmt(summary.lowStressScore, 0)}`, `${fmt(summary.energyRangeDb, 1)} dB range`, summary.lowStressScore)}
              ${renderMachineMetric("Speed Lock", `${fmt(summary.speedLockScore, 0)}`, `${fmt(summary.paceSpread, 2)}x pace spread`, summary.speedLockScore)}
              ${renderMachineMetric("Smooth Flow", `${fmt(summary.smoothFlowScore, 0)}`, `longest gap ${fmt(summary.longestGap, 2)}s`, summary.smoothFlowScore)}
              ${renderMachineMetric("Clarity Floor", `${fmt(summary.clarityFloorScore, 0)}`, `${fmt(summary.voicedRatio, 2)} voiced ratio`, summary.clarityFloorScore)}
            </div>
          </div>
          <div class="machine-meta">
            <span><i class="machine-dot pitch"></i>Pitch movement</span>
            <span><i class="machine-dot energy"></i>Energy / stress</span>
            <span>WPM ${fmt(summary.wordsPerMinute, 1)}</span>
            <span>Flags ${summary.flaggedWordCount || 0}</span>
            <span>Median Hz ${fmt(summary.medianHz, 0)}</span>
          </div>
          ${renderMachineGraph(state.machineModeData)}
          ${renderMachineWords(state.machineModeData)}
        `
        : `<div class="empty-state">Run local analysis after a Read Aloud or Repeat Sentence recording to judge flat, fixed-speed, low-stress delivery.</div>`;

  els.machineModeSection.innerHTML = `
    <article class="machine-card">
      <div class="pitch-head">
        <div>
          <p class="eyebrow">Monotone Speech</p>
          <h2>Flat, Even, Low-Stress Delivery</h2>
        </div>
        <button class="secondary-button compact-button" type="button" data-machine-mode>
          ${hasData ? "Rebuild" : "Build"}
        </button>
      </div>
      <p class="pitch-note">This is a local training score for the monotone RS/RA style you described: small pitch movement, low stress peaks, fixed speed, and smooth flow. It is separate from Azure Prosody and does not call Azure again.</p>
      ${body}
    </article>
  `;
}

async function loadMachineModeAnalysis() {
  const result = getCurrentResult();
  if (!result || state.machineModeLoading) return;
  state.machineModeLoading = true;
  state.machineModeError = "";
  renderMachineMode(result);
  try {
    const response = await fetch("/api/machine-mode/latest", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Monotone Speech analysis failed");
    if (payload.runId && result.runId && payload.runId !== result.runId) {
      throw new Error("Monotone Speech analysis is available for the latest recording only. Record this item again to rebuild it.");
    }
    state.machineModeData = payload;
    state.machineModeRunId = result.runId;
  } catch (error) {
    state.machineModeData = null;
    state.machineModeRunId = null;
    state.machineModeError = error.message || "Monotone Speech analysis failed";
  } finally {
    state.machineModeLoading = false;
    renderMachineMode(result);
  }
}

function phonemeSpeedRow(phoneme) {
  if (!state.phonemeSpeedData || state.phonemeSpeedRunId !== getCurrentResult()?.runId) return null;
  return (state.phonemeSpeedData.rows || []).find(
    (row) => row.wordIndex === phoneme.wordIndex && row.phonemeIndex === phoneme.phonemeIndex
  ) || null;
}

function wordPhonemeTimingSummary(result, wordIndex) {
  if (!result || !state.phonemeSpeedData || state.phonemeSpeedRunId !== result.runId) return null;
  const issueRows = (state.phonemeSpeedData.rows || []).filter(
    (row) => row.wordIndex === wordIndex && (row.status === "too-fast" || row.status === "too-slow")
  );
  if (!issueRows.length) return null;

  const fastCount = issueRows.filter((row) => row.status === "too-fast").length;
  const slowCount = issueRows.filter((row) => row.status === "too-slow").length;
  const worst = [...issueRows].sort((left, right) => (right.severity || 0) - (left.severity || 0))[0];
  const tone = fastCount && slowCount ? "mixed" : fastCount ? "fast" : "slow";
  return {
    fastCount,
    slowCount,
    worstRatio: worst?.ratio ?? null,
    tone,
  };
}

function renderWordPhonemeTimingTags(summary) {
  if (!summary) return "";
  const tags = [];
  if (summary.fastCount) tags.push(`<span class="word-timing-tag timing-fast">fast ${summary.fastCount}</span>`);
  if (summary.slowCount) tags.push(`<span class="word-timing-tag timing-slow">slow ${summary.slowCount}</span>`);
  if (summary.worstRatio !== null && summary.worstRatio !== undefined) {
    tags.push(`<span class="word-timing-tag timing-ratio">worst ${fmt(summary.worstRatio, 2)}x</span>`);
  }
  return `<span class="word-timing-tags">${tags.join("")}</span>`;
}

function phonemeSpeedClass(status) {
  if (status === "too-fast") return "speed-fast";
  if (status === "too-slow") return "speed-slow";
  if (status === "ok") return "speed-ok";
  return "speed-missing";
}

function phonemeSpeedLabel(row) {
  if (!row) return "timing not loaded";
  if (row.status === "too-fast") return "too fast";
  if (row.status === "too-slow") return "too slow";
  if (row.status === "ok") return "ok timing";
  return "no reference";
}

function renderPhonemeSpeedSummary(result) {
  if (!result) return "";
  if (state.phonemeSpeedLoading) {
    return `<div class="phoneme-speed-summary loading">Building phoneme timing comparison...</div>`;
  }
  if (state.phonemeSpeedError) {
    return `<div class="phoneme-speed-summary error">${escapeHtml(state.phonemeSpeedError)}</div>`;
  }
  if (!state.phonemeSpeedData || state.phonemeSpeedRunId !== result.runId) {
    return `<div class="phoneme-speed-summary muted">Phoneme timing comparison will appear after the flat reference is aligned.</div>`;
  }
  const summary = state.phonemeSpeedData.summary || {};
  return `
    <div class="phoneme-speed-summary">
      <span>Timing vs flat reference</span>
      <strong>${summary.fastCount || 0} fast</strong>
      <strong>${summary.slowCount || 0} slow</strong>
      <span>avg ${fmt(summary.avgRatio, 2)}x</span>
    </div>
  `;
}

function renderPhonemeSpeedMeta(row) {
  if (!row) {
    return `<div class="phoneme-speed-meta muted">timing not loaded</div>`;
  }
  const cssClass = phonemeSpeedClass(row.status);
  const ratio = row.ratio === null || row.ratio === undefined ? "-" : `${fmt(row.ratio, 2)}x`;
  const userDuration = row.userDuration === null || row.userDuration === undefined ? "-" : `${fmt(row.userDuration, 3)}s`;
  const refDuration = row.referenceDuration === null || row.referenceDuration === undefined ? "-" : `${fmt(row.referenceDuration, 3)}s`;
  return `
    <div class="phoneme-speed-meta ${cssClass}">
      <span>${escapeHtml(phonemeSpeedLabel(row))}</span>
      <span>you ${userDuration}</span>
      <span>ref ${refDuration}</span>
      <strong>${ratio}</strong>
    </div>
  `;
}

async function loadPhonemeSpeedComparison() {
  const result = getCurrentResult();
  if (!result || state.phonemeSpeedLoading) return;
  state.phonemeSpeedLoading = true;
  state.phonemeSpeedError = "";
  renderDetail(result);
  try {
    const response = await fetch("/api/phoneme-speed/latest", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Phoneme speed comparison failed");
    if (payload.runId && result.runId && payload.runId !== result.runId) {
      throw new Error("Phoneme speed comparison is available for the latest recording only. Record this item again to rebuild it.");
    }
    state.phonemeSpeedData = payload;
    state.phonemeSpeedRunId = result.runId;
  } catch (error) {
    state.phonemeSpeedData = null;
    state.phonemeSpeedRunId = null;
    state.phonemeSpeedError = error.message || "Phoneme speed comparison failed";
  } finally {
    state.phonemeSpeedLoading = false;
    renderDetail(result);
    renderWordList(result);
  }
}

function renderDetail(result) {
  if (!result) {
    els.selectedWordTitle.textContent = "No result yet";
    els.detailMetrics.innerHTML = "";
    els.phonemeLane.innerHTML = `<div class="empty-state">No phonemes yet</div>`;
    els.syllableLane.innerHTML = "";
    els.feedbackGrid.innerHTML = "";
    return;
  }

  const word = result.words[state.selectedWord] || result.words[0];
  if (!word) return;
  els.selectedWordTitle.textContent = word.text;
  els.detailMetrics.innerHTML = [
    ["Accuracy", fmt(word.accuracy, 1)],
    ["Error", word.errorType],
    ["Offset", `${fmt(word.offset)}s`],
    ["Duration", `${fmt(word.duration)}s`],
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");

  els.phonemeLane.innerHTML = renderPhonemeSpeedSummary(result) + word.phonemes
    .map((phoneme) => {
      const color = scoreColor(phoneme.accuracy);
      const speedRow = phonemeSpeedRow(phoneme);
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
            ${renderPhonemeSpeedMeta(speedRow)}
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
                <span>${fmt(item.accuracy, 0)} · ${fmt(item.offset)}s</span>
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

function renderWordsTable(result) {
  if (!result) return `<div class="empty-state">No word chain yet</div>`;
  const transitions = result.words
    .map((_, index) => describeBreakBefore(result, index))
    .filter(Boolean);
  const explicitBreakCount = transitions.filter((item) => item.feedback.errors.length > 0).length;
  const signalBreakCount = transitions.filter((item) => item.hasUnexpectedSignal || item.hasMissingSignal).length;
  const longestGap = transitions
    .map((item) => item.actualGap)
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);
  const chain = result.words
    .map((word, index) => {
      const hasWordError = word.errorType && word.errorType !== "None";
      const color = hasWordError ? "var(--red)" : scoreColor(word.accuracy);
      const bg = hasWordError ? "var(--soft-red)" : scoreBg(word.accuracy);
      const end = word.offset === null || word.duration === null ? null : word.offset + word.duration;
      const timeLabel = end === null ? "not detected" : `${fmt(word.offset, 2)}s-${fmt(end, 2)}s`;
      const cardWidth = Math.min(116, Math.max(74, 42 + String(word.text || "").length * 7));
      const transition = describeBreakBefore(result, index);
      const breakHtml = transition
        ? `
          <div class="break-link ${transition.tone}">
            <div class="break-line"></div>
            <strong>${escapeHtml(transition.label)}</strong>
            <span>gap ${fmt(transition.actualGap, 2)}s</span>
            <small>unexp ${fmt(transition.feedback.unexpectedConfidence, 2)} · miss ${fmt(transition.feedback.missingConfidence, 2)}</small>
          </div>
        `
        : "";

      return `
        ${breakHtml}
        <button
          class="word-chain-card ${hasWordError ? "has-error" : ""} ${index === state.selectedWord ? "active" : ""}"
          type="button"
          data-word-index="${index}"
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
          <p class="eyebrow">Words + Breaks</p>
          <h2>Timing Between Words</h2>
        </div>
        <div class="break-summary">
          <span>Explicit errors <strong>${explicitBreakCount}</strong></span>
          <span>High signals <strong>${signalBreakCount}</strong></span>
          <span>Longest gap <strong>${fmt(longestGap, 2)}s</strong></span>
        </div>
      </div>
      <div class="break-chain" aria-label="Horizontal word and break timeline">
        ${chain}
      </div>
      <div class="break-help">
        <span><i class="break-dot ok"></i>No break error</span>
        <span><i class="break-dot warn"></i>Confidence signal at or above 0.75</span>
        <span><i class="break-dot bad"></i>Explicit break error or unexpected-break signal</span>
        <span>Offset is the word start time; gap is computed from adjacent word offsets and durations.</span>
      </div>
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

function renderRunsTable() {
  const rows = [...state.results.entries()].sort(([a], [b]) => a - b);
  if (!rows.length) return `<div class="empty-state">No runs yet</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Sentence</th>
            <th>PronScore</th>
            <th>Accuracy</th>
            <th>Audio</th>
            <th>Est cost</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(([index, result]) => {
              const score = result.assessment?.PronScore;
              const color = scoreColor(score);
              const bg = scoreBg(score);
              return `
                <tr>
                  <td>${index + 1}</td>
                  <td>${escapeHtml(state.sentences[index])}</td>
                  <td><span class="quality-pill" style="--word-color:${color}; --word-bg:${bg}">${fmt(score, 1)}</span></td>
                  <td>${fmt(result.assessment?.AccuracyScore, 1)}</td>
                  <td>${fmt(result.cost?.audioSeconds, 1)}s</td>
                  <td>$${Number(result.cost?.estimatedTotalUsd || 0).toFixed(4)}</td>
                  <td><a href="${escapeHtml(result.files?.rawJson || "#")}" target="_blank" rel="noreferrer">JSON</a></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTab(result) {
  if (state.currentView === "words") els.tabPanel.innerHTML = renderWordsTable(result);
  if (state.currentView === "phonemes") els.tabPanel.innerHTML = renderPhonemeTable(result?.phonemes);
  if (state.currentView === "low") {
    const lowRows = [...(result?.phonemes || [])]
      .sort((a, b) => (a.accuracy ?? 999) - (b.accuracy ?? 999))
      .slice(0, 16);
    els.tabPanel.innerHTML = renderPhonemeTable(lowRows);
  }
  if (state.currentView === "runs") els.tabPanel.innerHTML = renderRunsTable();
}

function renderAll() {
  const result = getCurrentResult();
  renderQueue();
  renderStage();
  renderFiles(result);
  renderScores(result);
  renderProsodyOverview(result);
  renderMachineMode(result);
  renderPitchCompare(result);
  renderRuler(result);
  renderTimeline(result);
  renderWordList(result);
  renderDetail(result);
  renderTab(result);
}

function initRewardControls() {
  if (els.rewardSoundToggle) {
    els.rewardSoundToggle.checked = state.rewardSoundEnabled;
    els.rewardSoundToggle.addEventListener("change", () => {
      state.rewardSoundEnabled = els.rewardSoundToggle.checked;
      writeRewardSoundSetting(state.rewardSoundEnabled);
    });
  }

  if (els.rewardVolumeSlider) {
    els.rewardVolumeSlider.value = String(Math.round(state.rewardSoundVolume * 100));
    els.rewardVolumeSlider.addEventListener("input", () => {
      state.rewardSoundVolume = Number(els.rewardVolumeSlider.value) / 100;
      writeRewardVolumeSetting(state.rewardSoundVolume);
      applyRewardVolume();
    });
  }
}

function initControllerControls() {
  if (!els.controllerToggle) return;
  els.controllerToggle.checked = state.controllerEnabled;
  if (!state.controllerEnabled) {
    state.gamepadButtons.clear();
    state.xinputButtons.clear();
    state.xinputConnected = false;
    showControllerDisabled();
  }

  els.controllerToggle.addEventListener("change", () => {
    state.controllerEnabled = els.controllerToggle.checked;
    writeControllerEnabledSetting(state.controllerEnabled);
    state.gamepadButtons.clear();
    state.xinputButtons.clear();
    state.xinputConnected = false;

    if (!state.controllerEnabled) {
      showControllerDisabled();
      return;
    }

    setGamepadStatus("Pad: checking", "ready");
    setGamepadDebug("Controller input enabled. Press a controller button if needed.");
    pollXInputGamepad();
  });
}

function initMicMonitorControls() {
  if (!els.micMonitorToggle) return;
  els.micMonitorToggle.checked = state.micMonitorEnabled;
  els.micMonitorToggle.addEventListener("change", () => {
    state.micMonitorEnabled = els.micMonitorToggle.checked;
    writeMicMonitorSetting(state.micMonitorEnabled);
    if (!state.micMonitorEnabled) {
      stopMicMonitor();
      return;
    }
    if (state.stream && state.recorder?.state === "recording") {
      startMicMonitor(state.stream);
    }
  });
}

function selectSentence(index, autoPlayPrompt = false) {
  if (state.busy) return;
  stopPromptPlayback();
  state.index = Math.max(0, Math.min(state.sentences.length - 1, Number(index)));
  state.selectedWord = 0;
  state.pendingRecording = null;
  renderAll();
  if (hasPromptAudio && autoPlayPrompt) playPrompt(state.index, { autoRecord: true });
  if (isWordsMode && els.promptStatus && !autoPlayPrompt) {
    els.promptStatus.textContent = "Play once to generate and cache the Azure voice.";
  }
}

function selectWord(index, seek = false) {
  state.selectedWord = Number(index);
  const result = getCurrentResult();
  const word = result?.words[state.selectedWord];
  if (seek && word?.offset !== null) {
    els.resultAudio.currentTime = word.offset;
    els.resultAudio.play().catch(() => {});
  }
  renderAll();
  scrollSelectedWordIntoView();
}

async function startRecording() {
  if (state.recordingStarting || state.recorder?.state === "recording") return;
  if (state.busy || !state.sentences.length) return;
  stopPromptPlayback();
  state.recordingStarting = true;
  const startId = state.recordingStartId + 1;
  state.recordingStartId = startId;
  setStatus("Starting mic", "busy");
  renderStage();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (
      startId !== state.recordingStartId ||
      !state.recordingStarting ||
      state.busy ||
      state.recorder?.state === "recording"
    ) {
      stopMediaStream(stream);
      return;
    }
    state.stream = stream;
    state.activeStreams.add(stream);
    state.chunks = [];
    const mimeType = chooseMimeType();
    state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.chunks.push(event.data);
    });
    state.recorder.addEventListener("stop", handleRecordingStopped);
    state.recorder.start();
    await startMicMonitor(state.stream);
    state.recordingStarting = false;
    state.pendingRecording = null;
    els.recordButton.classList.add("recording");
    els.recordButton.disabled = true;
    els.stopButton.disabled = false;
    setStatus("Recording", "recording");
  } catch (error) {
    state.recordingStarting = false;
    stopAllRecordingTracks();
    setStatus("Mic blocked", "busy");
    alert(error.message || "Microphone permission failed");
  } finally {
    if (startId === state.recordingStartId && state.recordingStarting) {
      state.recordingStarting = false;
    }
    renderStage();
  }
}

function stopRecording() {
  const recorder = state.recorder;
  state.recordingStartId += 1;
  state.recordingStarting = false;
  if (!recorder || recorder.state !== "recording") {
    stopAllRecordingTracks();
    els.stopButton.disabled = true;
    els.recordButton.classList.remove("recording");
    renderStage();
    return;
  }
  recorder.stop();
  els.stopButton.disabled = true;
  els.recordButton.classList.remove("recording");
  const willUpload = isManualUploadMode && state.uploadAfterStop;
  setStatus(
    willUpload ? "Stopping and uploading" : isManualUploadMode ? "Recording saved" : "Scoring",
    willUpload ? "busy" : isManualUploadMode ? "done" : "busy"
  );
  state.busy = willUpload || !isManualUploadMode;
  renderStage();
}

function stopAndUploadRecording() {
  if (!isManualUploadMode) return;
  state.afterStopAction = null;
  if (state.recorder?.state === "recording") {
    state.uploadAfterStop = true;
    state.stopWithoutUpload = false;
    stopRecording();
    return;
  }
  uploadPendingRecording();
}

function handleManualUploadShortcut() {
  const hasActiveRecording = state.recorder?.state === "recording";
  if (state.recordingStarting) return true;
  if (isManualUploadMode && !hasActiveRecording && !state.pendingRecording) {
    if (state.busy || state.uploadInProgress) return true;
    return restartRecordingSafely();
  }
  stopAndUploadRecording();
  return true;
}

function runAfterRecordingStops(action) {
  if (state.recorder?.state === "recording") {
    state.afterStopAction = action;
    state.uploadAfterStop = false;
    state.stopWithoutUpload = true;
    stopRecording();
    return true;
  }
  state.afterStopAction = null;
  action();
  return true;
}

function selectSentenceSafely(index, autoPlayPrompt = false) {
  return runAfterRecordingStops(() => selectSentence(index, autoPlayPrompt));
}

function restartRecordingSafely() {
  return runAfterRecordingStops(() => startRecording());
}

function toggleRevealText() {
  if (!els.revealTextButton || !usesRepeatStyleControls || !state.sentences.length) return false;
  if (state.revealedSentences.has(state.index)) {
    state.revealedSentences.delete(state.index);
  } else {
    state.revealedSentences.add(state.index);
  }
  renderAll();
  return true;
}

function toggleShowAllText() {
  if (!isRepeatMode) return false;
  state.showAllText = Boolean(els.showAllTextToggle?.checked);
  writeShowAllTextSetting(state.showAllText);
  renderAll();
  return true;
}

function toggleMonotonePrompt() {
  if (!isRepeatMode) return false;
  state.monotonePromptEnabled = Boolean(els.monotonePromptToggle?.checked);
  writeMonotonePromptSetting(state.monotonePromptEnabled);
  if (els.promptStatus) {
    els.promptStatus.textContent = state.monotonePromptEnabled
      ? "Monotone Speech is on: automatic prompt playback uses the local flat voice."
      : "Monotone Speech is off: automatic prompt playback uses Azure prompt audio.";
  }
  renderStage();
  return true;
}

function startSpeedrun() {
  if (!isRepeatMode || !state.sentences.length || state.busy || state.uploadInProgress) return false;
  state.speedrunActive = true;
  state.pendingRecording = null;
  setStatus("Speedrun starting", "busy");
  renderAll();
  return runAfterRecordingStops(() => playPrompt(state.index, { autoRecord: true }));
}

function pauseSpeedrun(message = "Speedrun paused") {
  if (!isRepeatMode) return false;
  state.speedrunActive = false;
  stopPromptPlayback();
  if (state.recordingStarting || state.recorder?.state === "recording") {
    stopRecordingWithoutUpload();
  } else {
    setStatus(message, "done");
    renderAll();
  }
  return true;
}

function toggleSpeedrun() {
  if (!isRepeatMode) return false;
  if (state.speedrunActive) return pauseSpeedrun();
  return startSpeedrun();
}

function shouldContinueSpeedrunFrom(sentenceIndex) {
  return (
    isRepeatMode &&
    state.speedrunActive &&
    Number(sentenceIndex) === state.index &&
    state.index < state.sentences.length - 1
  );
}

function continueSpeedrunAfterScore(sentenceIndex) {
  if (!shouldContinueSpeedrunFrom(sentenceIndex)) {
    if (isRepeatMode && state.speedrunActive && Number(sentenceIndex) >= state.sentences.length - 1) {
      state.speedrunActive = false;
      setStatus("Speedrun complete", "done");
      renderAll();
    }
    return;
  }
  const nextIndex = Math.min(state.sentences.length - 1, Number(sentenceIndex) + 1);
  selectSentence(nextIndex, false);
  if (state.speedrunActive) {
    playPrompt(state.index, { autoRecord: true });
  }
}

function handleShortcutCode(code) {
  if (code === "ArrowUp") {
    return selectSentenceSafely(state.index - 1, usesRepeatStyleControls);
  }
  if (code === "ArrowDown") {
    return selectSentenceSafely(state.index + 1, usesRepeatStyleControls);
  }
  if (code === "ArrowLeft") {
    if (usesRepeatStyleControls) {
      return runAfterRecordingStops(() => playPrompt(state.index, { autoRecord: true }));
    }
    els.resultAudio.currentTime = 0;
    return true;
  }
  if (code === "ArrowRight") {
    if (usesRepeatStyleControls) {
      return restartRecordingSafely();
    }
    return false;
  }
  if (code === "Space" && isManualUploadMode) {
    return handleManualUploadShortcut();
  }
  if (code === "KeyE") {
    return toggleRevealText();
  }
  if (code === "KeyW") {
    return scrollMainPageByKeyboard(-1);
  }
  if (code === "KeyS") {
    return scrollMainPageByKeyboard(1);
  }
  if (code === "KeyP") {
    return toggleRecordedAudioPlayback();
  }
  if (code === "RevealText") {
    return toggleRevealText();
  }
  if (code === "StopNoUpload") {
    stopRecordingWithoutUpload();
    return true;
  }
  if (code === "KeyM") {
    stopRecordingWithoutUpload();
    return true;
  }
  return false;
}

function toggleRecordedAudioPlayback() {
  if (!els.resultAudio) return false;
  const source = els.resultAudio.currentSrc || els.resultAudio.getAttribute("src");
  if (!source) {
    setStatus("No recorded audio", "busy");
    return true;
  }
  if (!els.resultAudio.paused && !els.resultAudio.ended) {
    els.resultAudio.pause();
    setStatus("Recorded audio paused", "done");
    return true;
  }
  if (els.resultAudio.ended) {
    els.resultAudio.currentTime = 0;
  }
  if (els.resultAudio.readyState === 0) {
    els.resultAudio.load();
  }
  setStatus("Recorded audio playing", "done");
  els.resultAudio
    .play()
    .catch((error) => {
      setStatus("Recorded audio blocked", "busy");
      console.warn("Recorded audio playback failed", error);
    });
  return true;
}

function stopRecordingWithoutUpload() {
  if (!state.recordingStarting && (!state.recorder || state.recorder.state !== "recording")) return;
  state.afterStopAction = null;
  state.uploadAfterStop = false;
  state.stopWithoutUpload = true;
  stopRecording();
}

function handleRecordingStopped() {
  const type = state.recorder?.mimeType || "audio/webm";
  const blob = new Blob(state.chunks, { type });
  stopAllRecordingTracks();
  state.pendingRecording = {
    blob,
    type,
    url: URL.createObjectURL(blob),
    sentenceIndex: state.index,
    referenceText: state.sentences[state.index],
  };
  state.recorder = null;
  state.stream = null;
  state.recordingStarting = false;
  state.chunks = [];

  if (state.stopWithoutUpload || isManualUploadMode) {
    if (state.uploadAfterStop) {
      state.uploadAfterStop = false;
      state.stopWithoutUpload = false;
      state.afterStopAction = null;
      uploadPendingRecording();
    } else {
      const afterStopAction = state.afterStopAction;
      state.afterStopAction = null;
      state.stopWithoutUpload = false;
      state.busy = false;
      setStatus("Saved. Space uploads.", "done");
      renderAll();
      if (afterStopAction) {
        window.setTimeout(afterStopAction, 0);
      }
    }
    return;
  }

  uploadPendingRecording();
}

async function uploadPendingRecording() {
  if (!state.pendingRecording || state.uploadInProgress) return;
  const recording = state.pendingRecording;
  let speedrunAdvanceFrom = null;
  if (!recording.blob || recording.blob.size === 0) {
    state.pendingRecording = null;
    setStatus("Empty recording", "busy");
    renderAll();
    alert("Recording was empty. Press Space once to start recording, then press Space again after you finish speaking.");
    return;
  }
  state.uploadInProgress = true;
  state.busy = true;
  setStatus("Uploading", "busy");
  renderStage();

  try {
    const form = new FormData();
    form.append("sentenceIndex", String(recording.sentenceIndex + 1).padStart(3, "0"));
    form.append("referenceText", recording.referenceText);
    form.append("language", "en-US");
    form.append("phonemeAlphabet", "IPA");
    form.append("nbestPhonemeCount", "5");
    form.append("enableProsody", "true");
    form.append("enableMiscue", "true");
    form.append(
      "audio",
      recording.blob,
      `recording.${recording.type.includes("ogg") ? "ogg" : "webm"}`
    );

    const response = await fetch("/api/assess", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) {
      const details = payload.details ? `\n\n${payload.details}` : "";
      throw new Error(`${payload.error || "Assessment failed"}${details}`);
    }

    const result = normalizeResult(payload);
    state.results.set(recording.sentenceIndex, result);
    if (recording.sentenceIndex === state.index) {
      state.pendingRecording = null;
    }
    state.selectedWord = 0;
    state.pitchCompareRunId = null;
    state.pitchCompareData = null;
    state.pitchCompareError = "";
    state.machineModeRunId = null;
    state.machineModeData = null;
    state.machineModeError = "";
    state.phonemeSpeedRunId = null;
    state.phonemeSpeedData = null;
    state.phonemeSpeedError = "";
    setStatus("Done", "done");
    playRewardAudio(rewardFromScore(result.assessment?.PronScore));
    if (!isWordsMode) {
      window.setTimeout(loadMachineModeAnalysis, 0);
      window.setTimeout(loadPhonemeSpeedComparison, 0);
    }
    if (shouldContinueSpeedrunFrom(recording.sentenceIndex)) {
      speedrunAdvanceFrom = recording.sentenceIndex;
    } else if (isRepeatMode && state.speedrunActive && Number(recording.sentenceIndex) >= state.sentences.length - 1) {
      speedrunAdvanceFrom = recording.sentenceIndex;
    }
  } catch (error) {
    setStatus("Failed", "busy");
    alert(error.message || "Assessment failed");
  } finally {
    state.busy = false;
    state.uploadInProgress = false;
    state.uploadAfterStop = false;
    state.stopWithoutUpload = false;
    state.afterStopAction = null;
    renderAll();
    if (speedrunAdvanceFrom !== null) {
      window.setTimeout(() => continueSpeedrunAfterScore(speedrunAdvanceFrom), 0);
    }
  }
}

async function loadSentences() {
  const response = await fetch(collectionEndpoint);
  const payload = await response.json();
  state.sentences = collectionFromPayload(payload);
  state.index = 0;
  renderAll();
  await loadLatestResult();
}

function normalizeComparableText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function latestResultIndex(payload) {
  const reference = normalizeComparableText(payload.referenceText);
  const matchedIndex = state.sentences.findIndex((sentence) => normalizeComparableText(sentence) === reference);
  if (matchedIndex >= 0) return matchedIndex;
  if (isWordsMode) return -1;
  const number = Number.parseInt(payload.sentenceIndex, 10);
  if (Number.isFinite(number)) {
    const zeroBased = number - 1;
    if (zeroBased >= 0 && zeroBased < state.sentences.length) return zeroBased;
  }
  return 0;
}

async function loadLatestResult() {
  if (!usesRepeatStyleControls || !state.sentences.length) return;
  try {
    const response = await fetch("/api/latest-result", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.mode === "speaking") return;
    const index = latestResultIndex(payload);
    if (index < 0) return;
    state.index = index;
    state.selectedWord = 0;
    state.pendingRecording = null;
    state.results.set(index, normalizeResult(payload));
    renderAll();
    if (!isWordsMode) {
      window.setTimeout(loadMachineModeAnalysis, 0);
      window.setTimeout(loadPhonemeSpeedComparison, 0);
    }
  } catch {
    // Latest result hydration is optional; new recordings still work normally.
  }
}

async function saveSentences() {
  const sentences = els.sentenceEditor.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const response = await fetch(collectionEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [collectionPayloadKey]: sentences }),
  });
  const payload = await response.json();
  if (!response.ok) {
    alert(payload.error || "Save failed");
    return;
  }
  state.sentences = collectionFromPayload(payload);
  state.results.clear();
  state.index = 0;
  state.selectedWord = 0;
  els.sentenceDialog.close();
  renderAll();
}

async function addCurrentItem(event) {
  event?.preventDefault();
  if (!isWordsMode || !els.addItemInput) return;
  const item = els.addItemInput.value.trim();
  if (!item) return;

  const items = [...state.sentences, item];
  const response = await fetch(collectionEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [collectionPayloadKey]: items }),
  });
  const payload = await response.json();
  if (!response.ok) {
    alert(payload.error || "Add failed");
    return;
  }
  state.sentences = collectionFromPayload(payload);
  state.index = Math.max(0, state.sentences.length - 1);
  state.selectedWord = 0;
  state.pendingRecording = null;
  els.addItemInput.value = "";
  renderAll();
}

function pollGamepads() {
  if (!state.controllerEnabled) {
    window.requestAnimationFrame(pollGamepads);
    return;
  }

  const snapshot = readGamepadSnapshot();
  if (!snapshot.hasApi) {
    if (!state.xinputConnected) updateGamepadDebugFromSnapshot(snapshot);
    return;
  }
  if (state.xinputConnected) {
    window.requestAnimationFrame(pollGamepads);
    return;
  }

  for (const gamepad of snapshot.pads) {
    if (!gamepad) continue;
    const buttonCodes = browserGamepadCodes(gamepad);
    const buttonLabels = browserGamepadLabels(gamepad);
    moveSelectedWordFromStick(gamepad.axes?.[1]);
    scrollMainPageFromStick(gamepad.axes?.[3], GAMEPAD_SCROLL_STEP);
    gamepad.buttons.forEach((button, index) => {
      const pressed = Boolean(button?.pressed || button?.value > 0.5);
      const key = `${gamepad.index}:any:${index}`;
      const wasPressed = state.gamepadButtons.get(key) || false;
      if (pressed && !wasPressed) {
        setGamepadStatus(`Pad: ${buttonLabels[index] || `Button ${index}`}`, "active");
      }
      state.gamepadButtons.set(key, pressed);
    });
    Object.entries(buttonCodes).forEach(([buttonIndex, code]) => {
      const index = Number(buttonIndex);
      const button = gamepad.buttons[index];
      const pressed = Boolean(button?.pressed || button?.value > 0.5);
      const key = `${gamepad.index}:${index}`;
      const wasPressed = state.gamepadButtons.get(key) || false;
      if (pressed && !wasPressed) {
        setGamepadStatus(`Pad: ${buttonLabels[index] || index}`, "active");
        handleShortcutCode(code);
      }
      state.gamepadButtons.set(key, pressed);
    });
  }
  if (snapshot.firstPad && !snapshot.pressedLabels.length) {
    setGamepadStatus("Pad: connected", "connected");
  } else if (!snapshot.firstPad) {
    if (!state.xinputConnected) setGamepadStatus("Pad: press a button", "ready");
  }
  if (snapshot.firstPad || !state.xinputConnected) {
    updateGamepadDebugFromSnapshot(snapshot);
  }
  window.requestAnimationFrame(pollGamepads);
}

async function pollXInputGamepad() {
  if (!state.controllerEnabled) {
    return;
  }
  if (state.xinputPollInFlight) return;
  state.xinputPollInFlight = true;
  try {
    const response = await fetch("/api/xinput-state", { cache: "no-store" });
    const payload = await response.json();
    const controller = payload.controllers?.[0] || null;
    state.xinputConnected = Boolean(controller);

    if (!payload.available) {
      setGamepadDebug(`Browser Gamepad: no controller exposed | Backend XInput: unavailable (${payload.error || "unknown"})`);
      return;
    }

    if (!controller) {
      if (!readGamepadSnapshot().firstPad) {
        setGamepadDebug("Browser Gamepad: no controller exposed | Backend XInput: no controller connected");
      }
      return;
    }

    const leftY = Number(controller.thumbs?.ly || 0) / 32767;
    moveSelectedWordFromStick(-leftY);
    const rightY = Number(controller.thumbs?.ry || 0) / 32767;
    scrollMainPageFromStick(-rightY, XINPUT_SCROLL_STEP);

    const buttons = controller.buttons || [];
    const triggerInputs = [
      { name: "LEFT_TRIGGER", label: "LT", value: Number(controller.leftTrigger || 0) },
      { name: "RIGHT_TRIGGER", label: "RT", value: Number(controller.rightTrigger || 0) },
    ];
    const activeTriggerNames = [];
    const activeTriggerLabels = [];
    triggerInputs.forEach((trigger) => {
      const pressed = trigger.value >= XINPUT_TRIGGER_THRESHOLD;
      const key = `${controller.index}:${trigger.name}`;
      const wasPressed = state.xinputButtons.get(key) || false;
      if (pressed) {
        activeTriggerNames.push(trigger.name);
        activeTriggerLabels.push(`${trigger.label}:${trigger.value}`);
      }
      if (pressed && !wasPressed) {
        setGamepadStatus(`Pad: ${trigger.label} trigger`, "active");
      }
      state.xinputButtons.set(key, pressed);
    });

    buttons.forEach((buttonName) => {
      const code = XINPUT_BUTTON_CODES[buttonName];
      const key = `${controller.index}:${buttonName}`;
      const wasPressed = state.xinputButtons.get(key) || false;
      if (code && !wasPressed) {
        setGamepadStatus(`Pad: ${XINPUT_BUTTON_LABELS[buttonName] || buttonName}`, "active");
        handleShortcutCode(code);
      }
      state.xinputButtons.set(key, true);
    });

    const activeXInputNames = [...buttons, ...activeTriggerNames];
    [...state.xinputButtons.keys()].forEach((key) => {
      const [, buttonName] = key.split(":");
      if (!activeXInputNames.includes(buttonName)) {
        state.xinputButtons.set(key, false);
      }
    });

    if (!buttons.length && !activeTriggerLabels.length) {
      setGamepadStatus("Pad: XInput connected", "connected");
    }
    const pressedText = [...buttons, ...activeTriggerLabels].join(", ") || "none";
    setGamepadDebug(
      `Browser Gamepad: ignored while XInput is active | Backend XInput: controller ${controller.index} connected | triggers LT:${controller.leftTrigger} RT:${controller.rightTrigger} | pressed ${pressedText}`
    );
  } catch (error) {
    if (!state.xinputConnected) {
      setGamepadDebug(`Backend XInput poll failed: ${error.message || "unknown error"}`);
    }
  } finally {
    state.xinputPollInFlight = false;
  }
}

function wireEvents() {
  initRewardControls();
  initControllerControls();
  initMicMonitorControls();

  els.prevButton.addEventListener("click", () => selectSentenceSafely(state.index - 1, usesRepeatStyleControls));
  els.nextButton.addEventListener("click", () => selectSentenceSafely(state.index + 1, usesRepeatStyleControls));
  els.recordButton.addEventListener("click", restartRecordingSafely);
  els.stopButton.addEventListener("click", stopRecording);
  els.uploadButton?.addEventListener("click", uploadPendingRecording);
  els.seekWordButton.addEventListener("click", () => selectWord(state.selectedWord, true));
  els.speedrunButton?.addEventListener("click", toggleSpeedrun);
  els.showAllTextToggle?.addEventListener("change", toggleShowAllText);
  els.monotonePromptToggle?.addEventListener("change", toggleMonotonePrompt);
  els.playPromptButton?.addEventListener("click", () =>
    runAfterRecordingStops(() => playPrompt(state.index, { autoRecord: usesRepeatStyleControls }))
  );
  els.playMonotonePromptButton?.addEventListener("click", () =>
    runAfterRecordingStops(() => playPrompt(state.index, { monotone: true }))
  );
  els.addItemForm?.addEventListener("submit", addCurrentItem);
  els.gamepadDetectButton?.addEventListener("click", () => {
    if (!state.controllerEnabled) {
      showControllerDisabled();
      return;
    }
    updateGamepadDebugFromSnapshot(readGamepadSnapshot());
  });
  els.revealTextButton?.addEventListener("click", toggleRevealText);

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (isTextEntryTarget(target)) return;

    const code = shortcutCodeFromEvent(event);
    if ((code === "Space" || code === "KeyE" || code === "KeyP") && event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (handleShortcutCode(code)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { capture: true });

  document.addEventListener("contextmenu", (event) => {
    if (isTextEntryTarget(event.target)) return;
    event.preventDefault();
    restartRecordingSafely();
  });

  els.editSentencesButton.addEventListener("click", () => {
    els.sentenceEditor.value = state.sentences.join("\n");
    els.sentenceDialog.showModal();
  });
  els.saveSentencesButton.addEventListener("click", saveSentences);

  document.addEventListener("click", (event) => {
    const sentenceButton = event.target.closest("[data-sentence-index]");
    if (sentenceButton) {
      selectSentenceSafely(sentenceButton.dataset.sentenceIndex, isRepeatMode);
      return;
    }

    const wordButton = event.target.closest("[data-word-index]");
    if (wordButton) {
      selectWord(wordButton.dataset.wordIndex, true);
      return;
    }

    const pitchButton = event.target.closest("[data-pitch-compare]");
    if (pitchButton) {
      loadPitchComparison();
      return;
    }

    const machineButton = event.target.closest("[data-machine-mode]");
    if (machineButton) {
      loadMachineModeAnalysis();
      return;
    }

    const tabButton = event.target.closest("[data-view]");
    if (tabButton) {
      state.currentView = tabButton.dataset.view;
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === tabButton));
      renderTab(getCurrentResult());
    }
  });

  els.resultAudio.addEventListener("timeupdate", () => {
    const result = getCurrentResult();
    if (!result) return;
    const { start, span } = timelineBounds(result);
    const left = ((els.resultAudio.currentTime - start) / span) * 100;
    els.playhead.style.setProperty("--playhead-left", pct(left));
  });

  window.addEventListener("gamepadconnected", () => {
    state.gamepadButtons.clear();
    setGamepadStatus("Pad: connected", "connected");
  });
  window.addEventListener("gamepaddisconnected", () => {
    state.gamepadButtons.clear();
    setGamepadStatus("Pad: press a button", "ready");
  });
  if (window.navigator?.getGamepads) {
    pollGamepads();
  }
  window.setInterval(pollXInputGamepad, 80);
  pollXInputGamepad();
}

wireEvents();
loadSentences();

window.practiceApp = {
  state,
  normalizeResult,
  renderAll,
};
