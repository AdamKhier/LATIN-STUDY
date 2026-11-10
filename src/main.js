import { CELLS, PARADIGMS, PARADIGM_BY_ID, fold } from "./paradigms.js";
import { buildSession, isCorrect } from "./quiz.js";
import {
  buildBackup,
  clearDraft,
  loadDraft,
  loadProgress,
  loadSettings,
  normalizeSettings,
  readBackup,
  recordAnswer,
  resetProgress,
  saveDraft,
  saveProgress,
  saveSettings,
  storageState,
  weakestCells,
  weightFor,
} from "./store.js";
import {
  createCode,
  onSyncChange,
  startSync,
  stopSync,
  syncInfo,
  syncNow,
  useCode,
} from "./sync.js";
import {
  fillView,
  practiceView,
  progressView,
  quizView,
  rowFillView,
  savedAgo,
  summaryView,
  tablesView,
} from "./views.js";

const state = {
  tab: "practice",
  settings: loadSettings(),
  progress: loadProgress(),
  masked: false,
  revealed: new Set(),
  session: null,
  chart: { mode: "table", entries: loadDraft(), results: {}, recorded: {} },
  row: null,
};

const viewEl = document.getElementById("view");
const tabsEl = document.getElementById("tabs");
const saveDotEl = document.getElementById("save-dot");
const saveStatusEl = document.getElementById("save-status");

/* ------------------------------------------------------------- save indicator */

function paintSaveStatus() {
  const { ok, at } = storageState();
  const sync = syncInfo();
  saveDotEl.classList.toggle("is-error", !ok || sync.status === "error");

  let text = ok
    ? at
      ? `Autosaved ${savedAgo(at)}`
      : "Saves automatically in this browser"
    : "Local storage unavailable — progress is not being saved";

  if (sync.code) text += sync.status === "error" ? " · sync offline" : " · synced";
  saveStatusEl.textContent = text;
}

/** Pull in whatever sync negotiated, then repaint once. */
function applySyncedState(merged) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let changed = false;

  if (!same(state.progress, merged.progress)) {
    state.progress = merged.progress;
    saveProgress(state.progress);
    changed = true;
  }

  const settings = normalizeSettings(merged.settings);
  if (!same(state.settings, settings)) {
    state.settings = settings;
    saveSettings(state.settings);
    changed = true;
  }

  const draft = merged.draft ?? {};
  if (!same(state.chart.entries, draft)) {
    state.chart.entries = { ...draft };
    // Grades belong to the text they were given for, so they start over.
    state.chart.results = {};
    state.chart.recorded = {};
    saveDraft(state.chart.entries);
    changed = true;
  }

  if (changed) render({ scroll: false });
}

onSyncChange(() => {
  paintSaveStatus();
  if (state.tab === "progress") render({ scroll: false });
});

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Plain http on a LAN address has no clipboard API; try the old path.
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const done = document.execCommand("copy");
    field.remove();
    return done;
  } catch {
    return false;
  }
}

window.addEventListener("pronomen:saved", paintSaveStatus);
setInterval(paintSaveStatus, 20000);

/* ------------------------------------------------------------------- sessions */

function selectedCells() {
  return CELLS.filter((cell) => state.settings.paradigms.includes(cell.paradigmId));
}

function startSession(cells, count, mode) {
  const pool = cells.length ? cells : CELLS;
  if (pool.length === 0) return;
  state.session = {
    questions: buildSession({ cells: pool, count, progress: state.progress, mode }),
    index: 0,
    status: "asking",
    response: null,
    hint: false,
    result: null,
    answers: [],
    finished: false,
  };
  state.tab = "practice";
  render();
}

function currentQuestion() {
  return state.session?.questions[state.session.index] ?? null;
}

function submitAnswer(response) {
  const session = state.session;
  if (!session || session.status !== "asking" || session.finished) return;
  const question = currentQuestion();
  if (!question) return;

  if (question.type === "produce" && String(response).trim() === "") return;

  const correct = isCorrect(question, response);
  session.response = response;
  session.status = "answered";
  session.result = { correct };
  session.answers.push({
    questionIndex: session.index,
    cellId: question.cellId,
    correct,
    type: question.type,
  });
  recordAnswer(state.progress, question.cellId, correct);
  render();
}

function advance() {
  const session = state.session;
  if (!session || session.status !== "answered") return;

  if (session.index + 1 < session.questions.length) {
    session.index += 1;
    session.status = "asking";
    session.response = null;
    session.hint = false;
    session.result = null;
    render();
    return;
  }

  session.finished = true;
  state.progress.sessions += 1;
  saveProgress(state.progress);
  render();
}

function endSession() {
  const session = state.session;
  if (!session) return;
  if (session.answers.length === 0) {
    state.session = null;
    render();
    return;
  }
  session.finished = true;
  state.progress.sessions += 1;
  saveProgress(state.progress);
  render();
}

/* ---------------------------------------------------------------- fill charts */

let draftTimer = 0;
let draftDirty = false;

function queueDraftSave() {
  draftDirty = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    saveDraft(state.chart.entries);
    draftDirty = false;
  }, 400);
}

window.addEventListener("pagehide", () => {
  if (draftDirty) saveDraft(state.chart.entries);
});

/** Grade every written cell in the given paradigms, recording each one once. */
function gradeChart(paradigmIds) {
  for (const id of paradigmIds) {
    const paradigm = PARADIGM_BY_ID.get(id);
    if (!paradigm) continue;
    for (const cell of paradigm.cells) {
      const value = String(state.chart.entries[cell.id] ?? "").trim();
      if (!value) {
        delete state.chart.results[cell.id];
        continue;
      }
      const correct = fold(value) === fold(cell.form);
      state.chart.results[cell.id] = correct;
      if (!state.chart.recorded[cell.id]) {
        state.chart.recorded[cell.id] = true;
        recordAnswer(state.progress, cell.id, correct);
      }
    }
  }
}

function paintFillMeter() {
  const written = CELLS.filter((cell) => String(state.chart.entries[cell.id] ?? "").trim()).length;
  const el = viewEl.querySelector("[data-fill-written]");
  if (el) el.textContent = String(written);
}

/* -------------------------------------------------------------- fill: one row */

function rowCells(paradigm, entry) {
  return paradigm.cells.filter(
    (cell) => cell.caseKey === entry.case && cell.number === entry.number,
  );
}

/** Tables the row exercise draws from: one the learner picked, or all three. */
function rowParadigms() {
  const id = state.settings.fillParadigm;
  return PARADIGM_BY_ID.has(id) ? [PARADIGM_BY_ID.get(id)] : PARADIGMS;
}

/** Pick the next row to blank, favouring rows whose three forms are weakest. */
function pickRowTarget(excludeKey = "") {
  const candidates = [];
  for (const paradigm of rowParadigms()) {
    for (const entry of paradigm.rows) {
      const key = `${paradigm.id}:${entry.case}:${entry.number}`;
      if (key === excludeKey) continue;
      const cells = rowCells(paradigm, entry);
      const weight =
        cells.reduce((sum, cell) => sum + weightFor(state.progress, cell.id), 0) / cells.length;
      candidates.push({ paradigm, entry, key, weight });
    }
  }
  if (candidates.length === 0) return null;

  const total = candidates.reduce((sum, item) => sum + item.weight, 0);
  let target = Math.random() * total;
  for (const item of candidates) {
    target -= item.weight;
    if (target <= 0) return item;
  }
  return candidates[candidates.length - 1];
}

function makeRow(target, tally = { right: 0, total: 0 }) {
  return {
    key: target.key,
    paradigmId: target.paradigm.id,
    caseKey: target.entry.case,
    number: target.entry.number,
    cells: rowCells(target.paradigm, target.entry),
    entries: {},
    results: {},
    recorded: {},
    tally,
  };
}

function nextRow({ focusFirst = false } = {}) {
  const target = pickRowTarget(state.row?.key ?? "");
  if (!target) return;
  state.row = makeRow(target, state.row?.tally ?? { right: 0, total: 0 });
  render();

  // Keyboard learners land straight in the first field; a tap should not summon
  // the on-screen keyboard unless they ask for it.
  if (focusFirst) viewEl.querySelector(".row-input")?.focus();
}

/** Grade the blanked row, recording each form once per row. */
function checkRow() {
  const row = state.row;
  if (!row) return;
  for (const cell of row.cells) {
    const value = String(row.entries[cell.id] ?? "").trim();
    if (!value) {
      delete row.results[cell.id];
      continue;
    }
    const correct = fold(value) === fold(cell.form);
    row.results[cell.id] = correct;
    if (!row.recorded[cell.id]) {
      row.recorded[cell.id] = true;
      recordAnswer(state.progress, cell.id, correct);
      row.tally.total += 1;
      if (correct) row.tally.right += 1;
    }
  }
  render({ scroll: false });

  // Hand focus to the obvious next move, so Enter walks straight on to a new row.
  if (row.cells.some((cell) => row.results[cell.id] !== undefined)) {
    viewEl.querySelector("[data-action='next-row']")?.focus({ preventScroll: true });
  }
}

/** Keep the row badge and the check button honest while the learner types. */
function paintRowState() {
  const row = state.row;
  if (!row) return;

  const badge = viewEl.querySelector("[data-row-score]");
  if (badge) {
    const graded = row.cells.filter((cell) => row.results[cell.id] !== undefined);
    const right = graded.filter((cell) => row.results[cell.id]).length;
    badge.textContent = graded.length ? `${right}/${row.cells.length}` : "new row";
    badge.classList.toggle(
      "is-complete",
      graded.length === row.cells.length && right === row.cells.length,
    );
  }

  const button = viewEl.querySelector("[data-action='check-row']");
  if (button) {
    button.disabled = !row.cells.some((cell) => String(row.entries[cell.id] ?? "").trim());
  }
}

/* --------------------------------------------------------------------- render */

function render({ scroll = true } = {}) {
  const session = state.session;
  state.sync = syncInfo();

  if (state.tab === "practice") {
    viewEl.innerHTML = session
      ? session.finished
        ? summaryView(state)
        : quizView(state)
      : practiceView(state);
  } else if (state.tab === "fill") {
    if (state.chart.mode === "row") {
      // Start a fresh row when there is none, or when the chosen table changed.
      const pool = rowParadigms();
      const offFocus = state.row && pool.length === 1 && state.row.paradigmId !== pool[0].id;
      if (!state.row || offFocus) {
        const target = pickRowTarget("");
        state.row = target ? makeRow(target) : null;
      }
    }
    viewEl.innerHTML =
      state.chart.mode === "row" && state.row ? rowFillView(state) : fillView(state);
  } else if (state.tab === "tables") {
    viewEl.innerHTML = tablesView(state);
  } else {
    viewEl.innerHTML = progressView(state);
  }

  for (const button of tabsEl.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }

  if (state.tab === "practice" && session && !session.finished && session.status === "asking") {
    const input = viewEl.querySelector(".answer-input");
    if (input) requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  paintSaveStatus();
  if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
}

/* ------------------------------------------------------------------- events */

tabsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.tab = button.dataset.tab;
  render();
});

viewEl.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-action]");
  if (!form) return;

  if (form.dataset.action === "set-sync-code") {
    event.preventDefault();
    useCode(new FormData(form).get("code") ?? "");
    render({ scroll: false });
    return;
  }

  if (form.dataset.action !== "submit-answer") return;
  event.preventDefault();
  submitAnswer(new FormData(form).get("answer") ?? "");
});

viewEl.addEventListener("input", (event) => {
  const rowInputEl = event.target.closest(".row-input");
  if (rowInputEl && state.row) {
    const cellId = rowInputEl.dataset.value;
    state.row.entries[cellId] = rowInputEl.value;
    delete state.row.results[cellId];

    const cellEl = rowInputEl.closest(".chart-cell");
    cellEl?.classList.remove("is-correct", "is-wrong");
    cellEl?.querySelector(".chart-fix")?.remove();

    paintRowState();
    return;
  }

  const chartInput = event.target.closest(".chart-input");
  if (chartInput) {
    const cellId = chartInput.dataset.value;
    state.chart.entries[cellId] = chartInput.value;
    delete state.chart.results[cellId];

    const cellEl = chartInput.closest(".chart-cell");
    cellEl?.classList.remove("is-correct", "is-wrong");
    cellEl?.querySelector(".chart-fix")?.remove();

    paintFillMeter();
    queueDraftSave();
    return;
  }

  if (event.target.matches(".answer-input") && state.session) {
    state.session.response = event.target.value;
  }
});

/* Land in a cell the way a click at the end of the word would: the caret sits just
   after the last character, so typing carries on the form instead of replacing it. */
function focusCellAtEnd(input) {
  if (!input) return;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

viewEl.addEventListener("keydown", (event) => {
  if (!event.target.classList?.contains("chart-input") || event.key !== "Enter") return;
  event.preventDefault();
  const inputs = [...viewEl.querySelectorAll(".chart-input")];
  const next = inputs[inputs.indexOf(event.target) + 1];
  if (next) {
    focusCellAtEnd(next);
  } else {
    event.target.closest(".chart-card")?.querySelector("[data-action='check-chart'], [data-action='check-row']")?.focus();
  }
});

/* 1, 2 and 3 jump to the first, second and third cell of the row you are on: the
   three boxes of a blanked row, or the masculine/feminine/neuter cell of the case
   row the cursor sits in. A Latin form never contains a digit, so these keys are
   free to act as shortcuts even while a cell has focus. Asking for the cell you are
   already in is the redo gesture: it selects the whole form so typing replaces it. */
document.addEventListener("keydown", (event) => {
  if (state.tab !== "fill") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const slot = { 1: 0, 2: 1, 3: 2 }[event.key];
  if (slot === undefined) return;

  // Other fields in the app (the sync code, say) still need their digits.
  const field = event.target.closest?.("input, textarea");
  if (field && !field.classList.contains("chart-input")) return;

  const here = event.target.closest?.("tr");
  const mapped = here?.querySelector(".chart-input")
    ? here
    : [...viewEl.querySelectorAll(".chart-table tbody tr")].find((row) =>
        row.querySelector(".chart-input"),
      );
  const target = mapped && [...mapped.querySelectorAll(".chart-input")][slot];
  if (!target) return;

  event.preventDefault();
  if (target === document.activeElement) {
    target.select();
    return;
  }
  focusCellAtEnd(target);
});

/* Space walks the fill exercise, one cell at a time, in both fill styles. Latin
   forms are single words, so a literal space is never worth typing in a cell. */
viewEl.addEventListener("keydown", (event) => {
  if (event.key !== " " && event.code !== "Space") return;
  if (state.tab !== "fill") return;
  const cell = event.target.closest?.(".chart-input");
  if (!cell) return;
  event.preventDefault();

  const cells = [...viewEl.querySelectorAll(".chart-input")];
  const index = cells.indexOf(cell);

  // Nothing written here means the drill has not reached this cell yet, so the
  // space steps back to the one you came from instead of committing a blank.
  if (!cell.value.trim()) {
    focusCellAtEnd(cells[index - 1]);
    return;
  }

  const next = cells[index + 1];
  if (next) {
    focusCellAtEnd(next);
    return;
  }

  // End of the run: a blanked row checks itself, a whole table waits to be asked.
  const check = cell
    .closest(".chart-card")
    ?.querySelector("[data-action='check-row'], [data-action='check-chart']");
  if (!check || check.disabled) return;
  if (state.chart.mode === "row") check.click();
  else check.focus();
});

viewEl.addEventListener("change", async (event) => {
  const input = event.target.closest(".import-input");
  if (!input || !input.files?.length) return;

  try {
    const text = await input.files[0].text();
    input.value = "";
    const backup = readBackup(text);
    const answered = backup.progress.answered;
    if (
      !window.confirm(
        `Replace the progress saved on this device with this backup?\n\n` +
          `Backup: ${answered} answer${answered === 1 ? "" : "s"} over ${backup.progress.sessions} session${
            backup.progress.sessions === 1 ? "" : "s"
          }.\nThis device: ${state.progress.answered} answers over ${state.progress.sessions} sessions.\n\n` +
          "This cannot be undone.",
      )
    ) {
      return;
    }
    state.progress = backup.progress;
    saveProgress(state.progress);
    if (backup.settings) {
      state.settings = backup.settings;
      saveSettings(state.settings);
    }
    render();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "That backup could not be read.");
  }
});

viewEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, value } = target.dataset;

  switch (action) {
    case "set-mode":
      state.settings.mode = value;
      saveSettings(state.settings);
      render();
      break;

    case "toggle-paradigm": {
      const list = state.settings.paradigms;
      state.settings.paradigms = list.includes(value)
        ? list.filter((id) => id !== value)
        : [...list, value];
      saveSettings(state.settings);
      render();
      break;
    }

    case "set-length":
      state.settings.length = Number(value);
      saveSettings(state.settings);
      render();
      break;

    case "start-session":
      startSession(selectedCells().length ? selectedCells() : CELLS, state.settings.length, state.settings.mode);
      break;

    case "drill-weak": {
      const weak = weakestCells(state.progress, CELLS, 8);
      startSession(weak.length ? weak : CELLS, weak.length || 8, "mixed");
      break;
    }

    case "drill-missed": {
      const missedIds = [
        ...new Set(state.session.answers.filter((a) => !a.correct).map((a) => a.cellId)),
      ];
      const cells = missedIds.map((id) => CELLS.find((cell) => cell.id === id)).filter(Boolean);
      startSession(cells.length ? cells : CELLS, cells.length || 8, "mixed");
      break;
    }

    case "go-practice":
      state.session = null;
      state.tab = "practice";
      render();
      break;

    case "choose-option":
      if (state.session?.status === "asking") submitAnswer(Number(value));
      break;

    case "continue":
      advance();
      break;

    case "hint":
      if (state.session) {
        state.session.hint = true;
        render();
      }
      break;

    case "end-session":
      endSession();
      break;

    case "toggle-mask":
      state.masked = !state.masked;
      state.revealed.clear();
      render();
      break;

    case "reveal-cell":
      target.classList.remove("is-masked");
      state.revealed.add(value);
      break;

    case "check-chart":
      gradeChart(value === "all" ? PARADIGMS.map((paradigm) => paradigm.id) : [value]);
      render({ scroll: false });
      break;

    case "set-fill-mode":
      if (state.chart.mode === value) break;
      state.chart.mode = value;
      render();
      break;

    case "focus-paradigm": {
      if (value !== "all" && !PARADIGM_BY_ID.has(value)) break;
      if (state.settings.fillParadigm === value) break;
      state.settings.fillParadigm = value;
      saveSettings(state.settings);
      state.row = null; // render picks the first row inside the chosen table
      render();
      break;
    }

    case "check-row":
      checkRow();
      break;

    case "next-row":
      // detail === 0 means the button was activated from the keyboard.
      nextRow({ focusFirst: event.detail === 0 });
      break;

    case "clear-chart": {
      const paradigm = PARADIGM_BY_ID.get(value);
      if (!paradigm) break;
      const typed = paradigm.cells.filter((cell) =>
        String(state.chart.entries[cell.id] ?? "").trim(),
      ).length;
      if (
        typed &&
        !window.confirm(
          `Clear the ${typed} form${typed === 1 ? "" : "s"} you wrote in ${paradigm.title}?`,
        )
      ) {
        break;
      }
      for (const cell of paradigm.cells) {
        delete state.chart.entries[cell.id];
        delete state.chart.results[cell.id];
        delete state.chart.recorded[cell.id];
      }
      saveDraft(state.chart.entries);
      draftDirty = false;
      render({ scroll: false });
      break;
    }

    case "create-sync-code":
      useCode(createCode());
      render();
      break;

    case "sync-now":
      syncNow();
      break;

    case "copy-sync-link": {
      const link = syncInfo().link;
      if (!link) break;
      copyText(link).then((done) => {
        target.textContent = done ? "Link copied" : "Copy failed — copy it above";
        setTimeout(() => {
          if (target.isConnected) target.textContent = "Copy link";
        }, 1800);
      });
      break;
    }

    case "unlink-sync":
      if (
        window.confirm(
          "Stop syncing this browser?\n\nYour progress stays on this device and on the sync server, it just stops being shared.",
        )
      ) {
        stopSync();
        render();
      }
      break;

    case "export-backup": {
      const blob = new Blob([buildBackup(state.progress, state.settings)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pronomen-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      break;
    }

    case "import-backup":
      viewEl.querySelector(".import-input")?.click();
      break;

    case "reset-progress":
      if (
        window.confirm(
          "Reset every mastery level and statistic? This cannot be undone.",
        )
      ) {
        state.progress = resetProgress();
        state.chart.recorded = {};
        if (state.row) state.row.recorded = {};
        render();
      }
      break;

    case "reset-chart":
      if (
        window.confirm(
          "Clear all three tables and start the fill exercise over? Your mastery progress is kept.",
        )
      ) {
        state.chart = { entries: {}, results: {}, recorded: {} };
        clearDraft();
        render({ scroll: false });
      }
      break;

    default:
      break;
  }
});

/* Enter and Space do the same job: move on. Space has the same guards as Enter,
   so it still types normally inside a field and activates a focused button. */
const isAdvanceKey = (event) =>
  event.key === "Enter" || event.key === " " || event.code === "Space";

document.addEventListener("keydown", (event) => {
  const session = state.session;
  if (!session || session.finished || state.tab !== "practice") return;
  const tag = event.target.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA";

  if (session.status === "asking" && session.questions[session.index].type === "parse") {
    const digit = Number(event.key);
    if (!typing && Number.isInteger(digit) && digit >= 1 && digit <= 4) {
      const options = session.questions[session.index].options;
      if (digit <= options.length) {
        event.preventDefault();
        submitAnswer(digit - 1);
      }
    }
  }

  if (session.status === "answered" && isAdvanceKey(event) && tag !== "BUTTON") {
    event.preventDefault();
    advance();
  }
});

/* Enter or Space moves on from a checked row, the same reflex as the quiz's Continue. */
document.addEventListener("keydown", (event) => {
  if (!isAdvanceKey(event) || state.tab !== "fill" || state.chart.mode !== "row") return;
  const row = state.row;
  if (!row) return;
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
  if (!row.cells.some((cell) => row.results[cell.id] !== undefined)) return;
  event.preventDefault();
  nextRow({ focusFirst: true });
});

render();
startSync({
  apply: applySyncedState,
  editingDraft: () => Boolean(document.activeElement?.closest?.(".chart-input, .row-input")),
});
