const STORAGE_KEY = "pronomen.progress.v1";
const SETTINGS_KEY = "pronomen.settings.v1";
const DRAFT_KEY = "pronomen.chart-draft.v1";
const SAVED_KEY = "pronomen.saved-at.v1";

export const DEFAULT_SETTINGS = {
  mode: "mixed",
  paradigms: ["qui-quae-quod", "hic-haec-hoc", "ille-illa-illud"],
  length: 10,
  fillParadigm: "all",
};

const MODES = ["mixed", "produce", "parse"];
const LENGTHS = [10, 20, 40];

let savedAt = readSavedAt();
let storageOK = true;

function readSavedAt() {
  try {
    return Number(localStorage.getItem(SAVED_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Broadcast the outcome of the last write so the UI can show its save state. */
function announce() {
  try {
    window.dispatchEvent(
      new CustomEvent("pronomen:saved", { detail: { ok: storageOK, at: savedAt } }),
    );
  } catch {
    // Dispatch needs a real DOM; nothing to update headlessly.
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    storageOK = true;
    savedAt = Date.now();
    try {
      localStorage.setItem(SAVED_KEY, String(savedAt));
    } catch {
      // The payload made it; a missing timestamp is cosmetic.
    }
    announce();
    return true;
  } catch {
    // Storage can be unavailable (private mode, quota); the session still works in memory.
    storageOK = false;
    announce();
    return false;
  }
}

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Last write outcome: { ok, at } where `at` is a timestamp (0 when never saved). */
export function storageState() {
  return { ok: storageOK, at: savedAt };
}

/* ------------------------------------------------------------------ progress */

export function emptyProgress() {
  return { cells: {}, answered: 0, correct: 0, sessions: 0 };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const count = (value) => Math.max(0, Number(value) || 0);

function normalizeProgress(parsed) {
  const progress = emptyProgress();
  if (!parsed || typeof parsed !== "object") return progress;

  const cells = parsed.cells && typeof parsed.cells === "object" ? parsed.cells : {};
  for (const [id, entry] of Object.entries(cells)) {
    if (!entry || typeof entry !== "object") continue;
    progress.cells[id] = {
      box: clamp(Number(entry.box) || 0, 0, 5),
      seen: count(entry.seen),
      right: count(entry.right),
      last: count(entry.last),
    };
  }
  progress.answered = count(parsed.answered);
  progress.correct = count(parsed.correct);
  progress.sessions = count(parsed.sessions);
  return progress;
}

export function loadProgress() {
  return normalizeProgress(readJSON(STORAGE_KEY));
}

export function saveProgress(progress) {
  return write(STORAGE_KEY, progress);
}

export function resetProgress() {
  const fresh = emptyProgress();
  saveProgress(fresh);
  return fresh;
}

export function recordAnswer(progress, cellId, correct) {
  const cell = progress.cells[cellId] ?? { box: 0, seen: 0, right: 0, last: 0 };
  cell.seen += 1;
  cell.right += correct ? 1 : 0;
  cell.box = correct ? Math.min(5, cell.box + 1) : Math.max(0, cell.box - 2);
  cell.last = Date.now();
  progress.cells[cellId] = cell;
  progress.answered += 1;
  progress.correct += correct ? 1 : 0;
  saveProgress(progress);
  return progress;
}

export function boxOf(progress, cellId) {
  return progress.cells[cellId]?.box ?? 0;
}

export function masteryStats(progress, cells) {
  const buckets = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const cell of cells) buckets[boxOf(progress, cell.id)] += 1;
  return {
    buckets,
    mastered: buckets[4] + buckets[5],
    familiar: buckets[3],
    learning: buckets[1] + buckets[2],
    fresh: buckets[0],
  };
}

/** Weighted pick: weak or unseen forms come up far more often than mastered ones. */
export function weightFor(progress, cellId) {
  const entry = progress.cells[cellId];
  if (!entry || entry.seen === 0) return 5;
  return Math.max(1, 6 - entry.box);
}

/** Weakest forms: seen at least once, lowest accuracy/box first. */
export function weakestCells(progress, cells, limit = 8) {
  return cells
    .filter((cell) => (progress.cells[cell.id]?.seen ?? 0) > 0)
    .sort((a, b) => {
      const ea = progress.cells[a.id];
      const eb = progress.cells[b.id];
      const accA = ea.right / ea.seen;
      const accB = eb.right / eb.seen;
      return ea.box - eb.box || accA - accB || eb.seen - ea.seen;
    })
    .slice(0, limit);
}

/* ------------------------------------------------------------------ settings */

export function normalizeSettings(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const paradigms = Array.isArray(raw.paradigms)
    ? raw.paradigms.filter((id) => typeof id === "string")
    : DEFAULT_SETTINGS.paradigms;
  return {
    mode: MODES.includes(raw.mode) ? raw.mode : DEFAULT_SETTINGS.mode,
    paradigms,
    length: LENGTHS.includes(raw.length) ? raw.length : DEFAULT_SETTINGS.length,
    // "all" or a paradigm id; unknown ids fall back to mixing every table.
    fillParadigm: typeof raw.fillParadigm === "string" && raw.fillParadigm ? raw.fillParadigm : "all",
  };
}

export function loadSettings() {
  return normalizeSettings(readJSON(SETTINGS_KEY));
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, settings);
}

/* --------------------------------------------------------------- chart draft */

/** In-progress chart entries, so a reload never loses a half-filled table. */
export function loadDraft() {
  const raw = readJSON(DRAFT_KEY);
  if (!raw || typeof raw !== "object") return {};
  const entries = {};
  for (const [cellId, value] of Object.entries(raw)) {
    if (typeof value === "string") entries[cellId] = value;
  }
  return entries;
}

export function saveDraft(entries) {
  return write(DRAFT_KEY, entries);
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/* ------------------------------------------------------------------- backups */

/** A portable snapshot of everything this app keeps on the device. */
export function buildBackup(progress, settings) {
  return JSON.stringify(
    {
      app: "pronomen",
      version: 1,
      savedAt: new Date().toISOString(),
      progress,
      settings,
    },
    null,
    2,
  );
}

/** Parse a backup file; throws a readable message when the file is not ours. */
export function readBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  const payload = parsed && parsed.app === "pronomen" ? parsed : { progress: parsed };
  const progress = payload.progress;
  if (!progress || typeof progress !== "object" || typeof progress.cells !== "object") {
    throw new Error("No Pronomen progress found in that file.");
  }

  return {
    progress: normalizeProgress(progress),
    settings: payload.settings ? normalizeSettings(payload.settings) : null,
  };
}
