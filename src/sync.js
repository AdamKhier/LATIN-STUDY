/**
 * Progress sync between devices.
 *
 * The device stays the source of truth for itself: everything is still written to
 * localStorage first, and the sync server is only a place to meet. Each sync pulls
 * the shared copy, merges it with local data, applies the result and pushes it back,
 * so a pull always happens before a push and no device can erase another's answers.
 *
 * Merge rules:
 *   progress  per form, the record with more attempts wins (then higher box, then
 *             more correct, then most recent); totals are re-derived from the cells.
 *   settings  last writer wins, by the timestamp of the local edit.
 *   draft     same, as one unit; the text you are typing in is never overwritten.
 */

import { loadDraft, loadProgress, loadSettings, normalizeSettings } from "./store.js";

const CONFIG_KEY = "pronomen.sync.v1";
const POLL_MS = 20000;
const PUSH_MS = 700;
const CODE_RE = /^[a-z0-9][a-z0-9-]{3,63}$/;

const WORDS = [
  "tullius",
  "caesar",
  "vergil",
  "ovid",
  "horace",
  "livy",
  "seneca",
  "catullus",
  "puella",
  "agricola",
  "ludus",
  "liber",
  "verbum",
  "littera",
  "schola",
  "magister",
  "lingua",
  "pagina",
  "stilus",
  "carmen",
];

export const count = (value) => Math.max(0, Math.floor(Number(value) || 0));

/** status: off | idle | syncing | ready | error */
let config = readConfig();
let status = config.code ? "idle" : "off";
let error = "";
let busy = false;
let queued = false;
let applying = false;
let pushTimer = 0;
let pollTimer = 0;
let lanHost = "";
let applier = null;
let isEditingDraft = () => false;
let seen = readSeen();
const listeners = new Set();

/* --------------------------------------------------------------------- config */

function readConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return { code: "", settingsAt: 0, draftAt: 0, lastAt: 0 };
    const code = typeof parsed.code === "string" && CODE_RE.test(parsed.code) ? parsed.code : "";
    return {
      code,
      settingsAt: count(parsed.settingsAt),
      draftAt: count(parsed.draftAt),
      lastAt: count(parsed.lastAt),
    };
  } catch {
    return { code: "", settingsAt: 0, draftAt: 0, lastAt: 0 };
  }
}

function writeConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Private mode: sync still works for this tab, it just will not remember the code.
  }
}

function readSeen() {
  return { settings: JSON.stringify(loadSettings()), draft: JSON.stringify(loadDraft()) };
}

/* ---------------------------------------------------------------------- merge */

function normalizeCell(record) {
  return {
    box: Math.min(5, Math.max(0, Math.floor(Number(record.box) || 0))),
    seen: count(record.seen),
    right: count(record.right),
    last: count(record.last),
  };
}

const isCell = (record) => Boolean(record) && typeof record === "object";

/** Which of two records of the same form is further along (and therefore true). */
export function pickCell(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (b.seen !== a.seen) return b.seen > a.seen ? b : a;
  if (b.box !== a.box) return b.box > a.box ? b : a;
  if (b.right !== a.right) return b.right > a.right ? b : a;
  return b.last > a.last ? b : a;
}

/** Union of two progress maps, without ever double-counting an answer. */
export function mergeProgress(local, remote) {
  const a = local && typeof local === "object" ? local : {};
  const b = remote && typeof remote === "object" ? remote : {};
  const localCells = a.cells && typeof a.cells === "object" ? a.cells : {};
  const remoteCells = b.cells && typeof b.cells === "object" ? b.cells : {};

  const cells = {};
  for (const [id, record] of Object.entries(localCells)) {
    if (isCell(record)) cells[id] = normalizeCell(record);
  }
  for (const [id, record] of Object.entries(remoteCells)) {
    if (isCell(record)) cells[id] = pickCell(cells[id], normalizeCell(record));
  }

  // The app keeps answered/correct in lockstep with the per-form counters, so
  // re-deriving them from the merged cells is exact for both devices' answers.
  let answered = 0;
  let correct = 0;
  for (const record of Object.values(cells)) {
    answered += record.seen;
    correct += record.right;
  }

  return { cells, answered, correct, sessions: Math.max(count(a.sessions), count(b.sessions)) };
}

function cleanDraft(raw) {
  const entries = {};
  if (!raw || typeof raw !== "object") return entries;
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "string") entries[id] = value;
  }
  return entries;
}

/** Deterministic last-writer-wins, so both devices pick the same winner. */
function newer(a, b) {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  const keyA = JSON.stringify(a.value ?? null);
  const keyB = JSON.stringify(b.value ?? null);
  return keyA >= keyB ? a : b;
}

export function mergeStates(local, remote) {
  const a = local && typeof local === "object" ? local : {};
  const b = remote && typeof remote === "object" ? remote : {};

  const settings = newer(
    { at: count(a.settingsAt), value: a.settings ?? null },
    { at: count(b.settingsAt), value: b.settings ?? null },
  );
  const draft = newer(
    { at: count(a.draftAt), value: a.draft ?? {} },
    { at: count(b.draftAt), value: b.draft ?? {} },
  );

  return {
    progress: mergeProgress(a.progress, b.progress),
    settings: normalizeSettings(settings.value),
    settingsAt: settings.at,
    draft: cleanDraft(draft.value),
    draftAt: draft.at,
  };
}

function localState() {
  return {
    progress: loadProgress(),
    settings: loadSettings(),
    settingsAt: config.settingsAt,
    draft: loadDraft(),
    draftAt: config.draftAt,
  };
}

/** Compare content only: timestamps differ on every device by design. */
function fingerprint(state) {
  const progress = state?.progress ?? {};
  const cells = progress?.cells ?? {};
  const cellPart = Object.keys(cells)
    .sort()
    .map((id) => {
      const cell = cells[id];
      return `${id}:${count(cell?.seen)}:${count(cell?.right)}:${count(cell?.box)}:${count(cell?.last)}`;
    })
    .join("|");
  const draft = state?.draft ?? {};
  const draftPart = Object.keys(draft)
    .sort()
    .map((id) => `${id}=${draft[id]}`)
    .join("|");
  return [
    cellPart,
    count(progress?.answered),
    count(progress?.correct),
    count(progress?.sessions),
    JSON.stringify(state?.settings ?? null),
    draftPart,
  ].join("//");
}

/* ---------------------------------------------------------------------- links */

function baseOrigin() {
  const { hostname, origin, port, protocol } = window.location;
  const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (loopback && lanHost) return `${protocol}//${lanHost}${port ? `:${port}` : ""}`;
  return origin;
}

export function linkFor(code) {
  return code ? `${baseOrigin()}/#sync=${encodeURIComponent(code)}` : "";
}

async function learnLanHost() {
  try {
    const response = await fetch("/api/lan", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    const address = Array.isArray(data?.addresses) ? String(data.addresses[0] ?? "") : "";
    if (address && address !== lanHost) {
      lanHost = address;
      notify();
    }
  } catch {
    // Served from a host the LAN cannot reach; the copied link stays loopback.
  }
}

/* ------------------------------------------------------------------- network */

class SyncProblem extends Error {}

async function fetchState(code) {
  let response;
  try {
    response = await fetch(`/api/state?code=${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new SyncProblem("Cannot reach the sync server. Is it still running?");
  }
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    throw new SyncProblem("This page has no sync API. Start the app with python3 serve.py.");
  }
  if (!response.ok) throw new SyncProblem(`The sync server answered ${response.status}.`);
  const data = await response.json().catch(() => null);
  return data && typeof data.state === "object" && data.state ? data.state : null;
}

async function pushState(code, state) {
  let response;
  try {
    response = await fetch(`/api/state?code=${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
  } catch {
    throw new SyncProblem("Cannot reach the sync server. Is it still running?");
  }
  if (!response.ok) throw new SyncProblem(`Could not save to the sync server (${response.status}).`);
}

function describeError(err) {
  if (err instanceof SyncProblem) return err.message;
  return "Sync failed. Check that the server is running and try again.";
}

/* -------------------------------------------------------------------- actions */

function notify() {
  for (const listener of listeners) {
    try {
      listener(syncInfo());
    } catch {
      // A broken listener must not take the sync loop down.
    }
  }
}

function setStatus(next) {
  status = next;
  notify();
}

export function syncInfo() {
  return {
    code: config.code,
    status,
    error,
    lastAt: config.lastAt,
    link: linkFor(config.code),
  };
}

export function onSyncChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pull, merge, apply, push. Safe to call at any time; calls coalesce. */
export async function syncNow() {
  if (!config.code) return;
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  setStatus("syncing");
  try {
    const remote = await fetchState(config.code);
    const local = localState();
    let merged = mergeStates(local, remote);

    // Never pull text out from under someone who is typing in a chart cell.
    if (isEditingDraft()) merged = { ...merged, draft: local.draft, draftAt: local.draftAt };

    if (fingerprint(merged) !== fingerprint(local)) {
      applying = true;
      try {
        applier?.(merged);
      } finally {
        applying = false;
      }
    }

    if (!remote || fingerprint(merged) !== fingerprint(remote)) {
      await pushState(config.code, merged);
    }

    config.settingsAt = merged.settingsAt;
    config.draftAt = merged.draftAt;
    config.lastAt = Date.now();
    writeConfig();
    seen = readSeen();
    error = "";
    setStatus("ready");
  } catch (err) {
    error = describeError(err);
    setStatus("error");
  } finally {
    busy = false;
    if (queued) {
      queued = false;
      syncNow();
    }
  }
}

export function createCode() {
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  const word = WORDS[random[0] % WORDS.length];
  return `${word}-${String(random[1] % 10000).padStart(4, "0")}`;
}

/** Link this device to a code. Local progress is merged in, never replaced. */
export function useCode(raw) {
  const code = String(raw ?? "").trim().toLowerCase();
  if (!CODE_RE.test(code)) {
    error = "A code needs at least 4 letters, digits or dashes.";
    setStatus("error");
    return false;
  }
  config = { code, settingsAt: config.settingsAt, draftAt: config.draftAt, lastAt: 0 };
  writeConfig();
  error = "";
  setStatus("idle");
  syncNow();
  return true;
}

export function stopSync() {
  config = { code: "", settingsAt: config.settingsAt, draftAt: config.draftAt, lastAt: 0 };
  writeConfig();
  clearTimeout(pushTimer);
  error = "";
  status = "off";
  notify();
}

export function syncNowManually() {
  return syncNow();
}

/* ---------------------------------------------------------------- local edits */

/** Every store write lands here: timestamp what changed, then sync soon after. */
function noteLocalWrite() {
  if (applying) return;
  const now = Date.now();
  const settings = JSON.stringify(loadSettings());
  if (settings !== seen.settings) {
    seen.settings = settings;
    config.settingsAt = now;
    writeConfig();
  }
  const draft = JSON.stringify(loadDraft());
  if (draft !== seen.draft) {
    seen.draft = draft;
    config.draftAt = now;
    writeConfig();
  }
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), PUSH_MS);
}

/* ------------------------------------------------------------------ lifecycle */

export function startSync({ apply, editingDraft } = {}) {
  applier = typeof apply === "function" ? apply : null;
  if (typeof editingDraft === "function") isEditingDraft = editingDraft;

  window.addEventListener("pronomen:saved", noteLocalWrite);

  window.addEventListener("focus", () => {
    if (config.code) syncNow();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && config.code) syncNow();
  });

  // A second tab on this device writes to the same localStorage: adopt its state.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === CONFIG_KEY) {
      const previous = config.code;
      config = readConfig();
      if (config.code !== previous) {
        error = "";
        status = config.code ? "idle" : "off";
        if (config.code) syncNow();
      }
    }
    if (event.key && !event.key.startsWith("pronomen.")) return;
    if (!applier) return;
    applying = true;
    try {
      applier(localState());
    } finally {
      applying = false;
    }
    seen = readSeen();
    notify();
  });

  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (config.code && document.visibilityState !== "hidden") syncNow();
  }, POLL_MS);

  learnLanHost();

  if (adoptFromHash()) {
    setStatus("idle");
    syncNow();
    return;
  }
  if (config.code) syncNow();
  else setStatus("off");
}

/** Links look like http://192.168.3.91:8123/#sync=tullius-4821 */
export function adoptFromHash() {
  const match = /(?:^|[#&])sync=([a-z0-9-]{4,64})/i.exec(window.location.hash || "");
  if (!match) return false;
  const code = match[1].toLowerCase();
  try {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  } catch {
    // A file:// page may refuse; the code is still adopted below.
  }
  return useCode(code);
}
