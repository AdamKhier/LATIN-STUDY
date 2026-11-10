import {
  CASES,
  CELLS,
  GENDERS,
  PARADIGMS,
  PARADIGM_BY_ID,
  describeCell,
  describeCells,
  getCell,
  rowsForCells,
} from "./paradigms.js";
import { boxOf, masteryStats, storageState, weakestCells } from "./store.js";
import { explain } from "./quiz.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

const ROMAN = { singular: "sg.", plural: "pl." };
const SHORT_CASE = {
  Nominative: "Nom.",
  Genitive: "Gen.",
  Dative: "Dat.",
  Accusative: "Acc.",
  Ablative: "Abl.",
};

export const MODES = [
  {
    id: "mixed",
    title: "Mixed",
    blurb: "Alternates typing forms and reading grammar.",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>`,
  },
  {
    id: "produce",
    title: "Recall",
    blurb: "You get the grammar, you type the Latin.",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14 6 4 4"/></svg>`,
  },
  {
    id: "parse",
    title: "Recognise",
    blurb: "You see the form, you name its grammar.",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>`,
  },
];

const LENGTHS = [10, 20, 40];

function pillIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18"/></svg>`;
}

/** "just now" / "4 minutes ago" / "12 Mar 2026" — used by the save indicators. */
export function savedAgo(at) {
  if (!at) return "not yet";
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function saveLine() {
  const { ok, at } = storageState();
  if (!ok) {
    return `<p class="save-meta is-error"><span class="save-dot is-error"></span>This browser is blocking local storage — progress will not survive a reload.</p>`;
  }
  return `<p class="save-meta"><span class="save-dot"></span>${
    at ? `Autosaved ${esc(savedAgo(at))}` : "Saves automatically as you practise"
  }</p>`;
}

/* ------------------------------------------------------------------ practice */

export function practiceView(state) {
  const { settings, progress } = state;
  const stats = masteryStats(progress, CELLS);
  const missed = weakestCells(progress, CELLS, 5);
  const selected = settings.paradigms.length;
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;

  const modeCards = MODES.map(
    (mode) => `
      <button class="mode-card ${settings.mode === mode.id ? "is-active" : ""}"
              data-action="set-mode" data-value="${mode.id}"
              aria-pressed="${settings.mode === mode.id}">
        <span class="mode-icon">${mode.icon}</span>
        <span class="mode-title">${mode.title}</span>
        <span class="mode-blurb">${mode.blurb}</span>
      </button>`,
  ).join("");

  const paradigmChips = PARADIGMS.map(
    (paradigm) => `
      <button class="chip ${settings.paradigms.includes(paradigm.id) ? "is-active" : ""}"
              data-action="toggle-paradigm" data-value="${esc(paradigm.id)}"
              aria-pressed="${settings.paradigms.includes(paradigm.id)}">
        <span class="chip-title">${esc(paradigm.title)}</span>
        <span class="chip-sub">${esc(paradigm.meaning)}</span>
      </button>`,
  ).join("");

  const lengthChips = LENGTHS.map(
    (length) => `
      <button class="chip chip-sm ${settings.length === length ? "is-active" : ""}"
              data-action="set-length" data-value="${length}"
              aria-pressed="${settings.length === length}">${length} forms</button>`,
  ).join("");

  return `
    <section class="screen">
      <div class="hero">
        <p class="eyebrow">${pillIcon()} Salvē — ready to drill?</p>
        <h1>Learn your pronouns<br /><em>by heart.</em></h1>
        <p class="lede">
          Ninety forms across three paradigms. Every answer moves a form up or down a
          mastery scale, and the session keeps circling back to the ones you miss.
        </p>
        <dl class="stat-row">
          <div><dt>Mastered</dt><dd>${stats.mastered}<span>/${CELLS.length}</span></dd></div>
          <div><dt>Seen at least once</dt><dd>${CELLS.length - stats.fresh}<span>/${CELLS.length}</span></dd></div>
          <div><dt>Lifetime accuracy</dt><dd>${accuracy}<span>%</span></dd></div>
        </dl>
      </div>

      <div class="panel setup">
        <div class="field">
          <h2 class="field-title">Mode</h2>
          <div class="mode-grid">${modeCards}</div>
        </div>

        <div class="field">
          <h2 class="field-title">Paradigms</h2>
          <div class="chip-row">${paradigmChips}</div>
        </div>

        <div class="field field-inline">
          <h2 class="field-title">Session length</h2>
          <div class="chip-row">${lengthChips}</div>
        </div>

        <div class="cta-row">
          <button class="btn btn-primary btn-lg" data-action="start-session" ${selected ? "" : "disabled"}>
            Begin session
            <span class="btn-hint">${selected * 30} forms in play</span>
          </button>
          ${missed.length ? `<button class="btn btn-quiet" data-action="drill-weak">Review ${missed.length} tricky forms</button>` : ""}
        </div>
        ${selected ? "" : `<p class="warn">Pick at least one paradigm to begin.</p>`}
      </div>
    </section>`;
}

/* ---------------------------------------------------------------------- quiz */

function miniTable(cellIds) {
  const cells = cellIds.map(getCell).filter(Boolean);
  const rows = rowsForCells(cells);
  const body = rows
    .map(
      (row) => `
        <tr>
          <th scope="row">${esc(row.caseLabel)} <span class="dim">${ROMAN[row.numberLabel]}</span></th>
          ${GENDERS.map(
            (gender) => `
            <td class="${row.highlight.has(gender.key) ? "is-target" : ""}">${esc(row.forms[gender.key])}</td>`,
          ).join("")}
        </tr>`,
    )
    .join("");

  return `
    <table class="mini-table">
      <thead>
        <tr><th></th>${GENDERS.map((g) => `<th scope="col">${esc(g.short)}</th>`).join("")}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function quizView(state) {
  const { session } = state;
  const question = session.questions[session.index];
  const total = session.questions.length;
  const score = session.answers.filter((a) => a.correct).length;
  const progressPct = Math.round(((session.index + (session.status === "answered" ? 1 : 0)) / total) * 100);
  const paradigm = PARADIGM_BY_ID.get(question.paradigmId);

  const prompt =
    question.type === "produce"
      ? `<div class="prompt-block">
           <p class="eyebrow">Give the form</p>
           <h2 class="prompt">
             <span class="prompt-case">${esc(question.caseLabel)}</span>
             <span class="prompt-meta">${esc(question.numberLabel)} · ${esc(question.genderLabel.toLowerCase())}</span>
           </h2>
         </div>`
      : `<div class="prompt-block">
           <p class="eyebrow">Name the grammar</p>
           <h2 class="prompt prompt-form">${esc(question.form)}</h2>
           <p class="prompt-meta">of ${esc(paradigm.title)} — “${esc(paradigm.meaning)}”</p>
         </div>`;

  let answerArea;
  if (question.type === "produce") {
    answerArea = `
      <form class="answer-form" data-action="submit-answer" autocomplete="off">
        <input class="answer-input" name="answer" type="text" inputmode="latin"
               placeholder="type the form…" aria-label="Latin form"
               autocomplete="off" autocapitalize="off" spellcheck="false"
               value="${esc(session.response ?? "")}"
               ${session.status === "answered" ? "disabled" : ""} />
        <button class="btn btn-primary" type="submit" ${session.status === "answered" ? "disabled" : ""}>Check</button>
      </form>
      ${
        session.status === "asking"
          ? `<button class="link-btn" data-action="hint">${session.hint ? `Starts with “${esc(question.answer[0])}” · ${question.answer.length} letters` : "Need a hint?"}</button>`
          : ""
      }`;
  } else {
    answerArea = `<div class="option-grid">
      ${question.options
        .map(
          (option, index) => `
        <button class="option ${
          session.status === "answered"
            ? index === question.answerIndex
              ? "is-correct"
              : index === session.response
                ? "is-wrong"
                : "is-muted"
            : ""
        }" data-action="choose-option" data-value="${index}"
          ${session.status === "answered" ? "disabled" : ""}>
          <span class="option-key">${index + 1}</span>
          <span class="option-label">${esc(option)}</span>
        </button>`,
        )
        .join("")}
    </div>`;
  }

  const feedback =
    session.status === "answered"
      ? (() => {
          const info = explain(question);
          const correct = session.result.correct;
          return `
          <div class="feedback ${correct ? "is-correct" : "is-wrong"}" role="status">
            <div class="feedback-head">
              <span class="feedback-badge">${correct ? "Correct" : "Not quite"}</span>
              <span class="feedback-answer">${esc(info.heading)}</span>
            </div>
            ${
              !correct && question.type === "produce"
                ? `<p class="feedback-given">You wrote <span>${esc(session.response || "—")}</span></p>`
                : ""
            }
            <div class="feedback-body">
              ${miniTable(info.cellIds)}
              <p class="feedback-note">${esc(info.note)}</p>
            </div>
            <button class="btn btn-primary btn-lg" data-action="continue">
              ${session.index + 1 >= total ? "See results" : "Continue"}
              <span class="key-cap">↵</span><span class="key-cap">space</span>
            </button>
          </div>`;
        })()
      : "";

  return `
    <section class="screen quiz">
      <div class="quiz-head">
        <div class="quiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}"
             aria-valuenow="${session.index + 1}" aria-label="Session progress">
          <span style="width:${progressPct}%"></span>
        </div>
        <div class="quiz-meta">
          <span>${session.index + 1} / ${total}</span>
          <span class="dot-sep">·</span>
          <span>${score} correct</span>
          <button class="link-btn end" data-action="end-session">End session</button>
        </div>
      </div>

      <div class="card question-card">
        <div class="card-top">
          ${prompt}
          <span class="tag">${esc(paradigm.title)}</span>
        </div>
        ${answerArea}
      </div>

      ${feedback}
      <p class="sr-only" aria-live="polite">${
        session.status === "answered" ? (session.result.correct ? "Correct" : "Incorrect") : ""
      }</p>
    </section>`;
}

/* ------------------------------------------------------------------- summary */

export function summaryView(state) {
  const { session } = state;
  const total = session.answers.length;
  const score = session.answers.filter((a) => a.correct).length;
  const pct = total ? Math.round((score / total) * 100) : 0;
  const missed = session.questions
    .map((question, index) => ({ question, answer: session.answers.find((a) => a.questionIndex === index) }))
    .filter((entry) => entry.answer && !entry.answer.correct);

  const verdict =
    pct === 100
      ? "Impeccable. Nihil erratum est."
      : pct >= 75
        ? "Good session — a few forms still need work."
        : pct >= 40
          ? "Getting there. Repetition is the whole trick."
          : "Steep today — the review queue will fix that.";

  const missedList = missed.length
    ? `<div class="panel">
        <h2 class="field-title">Worth another look</h2>
        <ul class="review-list">
          ${missed
            .map(({ question }) => {
              const info = explain(question);
              return `<li><span class="review-form">${esc(question.type === "produce" ? question.answer : question.form)}</span><span class="review-desc">${esc(info.describe)}</span></li>`;
            })
            .join("")}
        </ul>
      </div>`
    : "";

  return `
    <section class="screen summary">
      <div class="hero hero-center">
        <p class="eyebrow">Session complete</p>
        <h1><span class="score-big">${score}</span><span class="score-total">/${total}</span></h1>
        <p class="lede">${esc(verdict)}</p>
        <div class="summary-stats">
          <div><span>${pct}%</span><small>accuracy</small></div>
          <div><span>${new Set(session.answers.map((a) => a.cellId)).size}</span><small>forms practised</small></div>
          <div><span>${state.progress.sessions}</span><small>sessions logged</small></div>
        </div>
      </div>

      ${missedList}

      <div class="cta-row cta-center">
        ${missed.length ? `<button class="btn btn-primary btn-lg" data-action="drill-missed">Drill what I missed</button>` : ""}
        <button class="btn ${missed.length ? "btn-quiet" : "btn-primary btn-lg"}" data-action="start-session">New session</button>
        <button class="btn btn-quiet" data-action="go-practice">Change setup</button>
      </div>
    </section>`;
}

/* -------------------------------------------------------------------- tables */

export function tablesView(state) {
  const cards = PARADIGMS.map((paradigm) => {
    const rows = paradigm.rows
      .map((row, index) => {
        const groupLabel =
          index === 0
            ? `<tr class="group-row"><th colspan="4">Singular</th></tr>`
            : index === CASES.length
              ? `<tr class="group-row"><th colspan="4">Plural</th></tr>`
              : "";
        const cells = GENDERS.map((gender) => {
          const cell = paradigm.cells.find(
            (c) => c.caseKey === row.case && c.number === row.number && c.gender === gender.key,
          );
          const revealed = state.revealed.has(cell.id);
          return `<td class="form-cell ${state.masked && !revealed ? "is-masked" : ""}"
                      data-action="reveal-cell" data-value="${esc(cell.id)}">${esc(cell.form)}</td>`;
        }).join("");
        return `${groupLabel}<tr><th scope="row">${esc(row.case)}</th>${cells}</tr>`;
      })
      .join("");

    return `
      <article class="panel paradigm-card">
        <header class="paradigm-head">
          <div>
            <h2>${esc(paradigm.title)}</h2>
            <p class="sub">${esc(paradigm.kind)} · “${esc(paradigm.meaning)}”</p>
          </div>
          <span class="tag">${paradigm.cells.length} forms</span>
        </header>
        <div class="table-scroll">
          <table class="paradigm-table">
            <thead>
              <tr><th scope="col"><span class="sr-only">Case</span></th>
              ${GENDERS.map((g) => `<th scope="col">${esc(g.labelCap)}</th>`).join("")}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </article>`;
  }).join("");

  return `
    <section class="screen">
      <div class="page-head">
        <div>
          <h1 class="page-title">The three paradigms</h1>
          <p class="lede">Mask the forms and test yourself from memory — click a hidden cell to reveal it.</p>
        </div>
        <button class="btn btn-quiet ${state.masked ? "is-active" : ""}" data-action="toggle-mask" aria-pressed="${state.masked}">
          ${state.masked ? "Show all forms" : "Mask forms"}
        </button>
      </div>
      <div class="paradigm-grid">${cards}</div>
    </section>`;
}

/* ---------------------------------------------------------------------- fill */

const FILL_MODES = [
  { id: "table", label: "Whole table" },
  { id: "row", label: "One row" },
];

function fillSwitch(active) {
  const buttons = FILL_MODES.map(
    (mode) => `
      <button class="seg-btn ${active === mode.id ? "is-active" : ""}"
              data-action="set-fill-mode" data-value="${mode.id}"
              aria-pressed="${active === mode.id}">${mode.label}</button>`,
  ).join("");
  return `<div class="seg" role="group" aria-label="Fill style">${buttons}</div>`;
}

export function fillView(state) {
  const { chart } = state;
  const written = CELLS.filter((cell) => String(chart.entries[cell.id] ?? "").trim()).length;
  const graded = CELLS.filter((cell) => chart.results[cell.id] !== undefined);
  const right = graded.filter((cell) => chart.results[cell.id]).length;

  const cards = PARADIGMS.map((paradigm) => {
    const tableGraded = paradigm.cells.filter((cell) => chart.results[cell.id] !== undefined);
    const tableRight = tableGraded.filter((cell) => chart.results[cell.id]).length;
    const tableWritten = paradigm.cells.filter((cell) =>
      String(chart.entries[cell.id] ?? "").trim(),
    ).length;
    const complete = tableGraded.length === paradigm.cells.length && tableRight === paradigm.cells.length;
    const badge = tableGraded.length
      ? `${tableRight}/${paradigm.cells.length}`
      : tableWritten
        ? `${tableWritten} typed`
        : "blank";

    const rows = paradigm.rows
      .map((row) => {
        const cells = GENDERS.map((gender) => {
          const cell = paradigm.cells.find(
            (c) => c.caseKey === row.case && c.number === row.number && c.gender === gender.key,
          );
          const value = chart.entries[cell.id] ?? "";
          const result = chart.results[cell.id];
          const modifier = result === true ? "is-correct" : result === false ? "is-wrong" : "";
          return `<td class="chart-cell ${modifier}">
            <input class="chart-input" type="text" value="${esc(value)}" data-value="${esc(cell.id)}"
                   inputmode="latin" autocomplete="off" autocapitalize="off" autocorrect="off"
                   spellcheck="false" aria-label="${esc(describeCell(cell))}" />
            ${result === false ? `<small class="chart-fix">${esc(cell.form)}</small>` : ""}
          </td>`;
        }).join("");
        return `<tr><th scope="row">${esc(SHORT_CASE[row.case] ?? row.case)} <span class="dim">${ROMAN[row.number]}</span></th>${cells}</tr>`;
      })
      .join("");

    return `
      <article class="panel chart-card" data-paradigm="${esc(paradigm.id)}">
        <header class="paradigm-head">
          <div>
            <h2>${esc(paradigm.title)}</h2>
            <p class="sub">“${esc(paradigm.meaning)}”</p>
          </div>
          <span class="chart-score ${complete ? "is-complete" : ""}">${badge}</span>
        </header>
        <div class="table-scroll">
          <table class="chart-table">
            <thead>
              <tr><th scope="col"><span class="sr-only">Case</span></th>
              ${GENDERS.map((g) => `<th scope="col">${esc(g.short)}</th>`).join("")}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="chart-actions">
          <button class="btn btn-quiet" data-action="check-chart" data-value="${esc(paradigm.id)}">Check table</button>
          <button class="btn btn-quiet" data-action="clear-chart" data-value="${esc(paradigm.id)}">Clear</button>
        </div>
      </article>`;
  }).join("");

  return `
    <section class="screen">
      <div class="page-head">
        <div>
          <h1 class="page-title">Fill the blank tables</h1>
          <p class="lede">
            Three empty charts. Write in whatever you know, then check — blanks stay blank, so
            you can build a table up over several passes instead of all at once.
          </p>
        </div>
        <div class="fill-tools">
          ${fillSwitch("table")}
          <div class="cta-row">
            ${written ? `<button class="btn btn-quiet" data-action="reset-chart">Clear all</button>` : ""}
            <button class="btn btn-primary" data-action="check-chart" data-value="all">Check everything</button>
          </div>
        </div>
      </div>

      <p class="fill-meter">
        <span><strong data-fill-written>${written}</strong> of ${CELLS.length} forms written</span>
        ${graded.length ? `<span class="dot-sep">·</span><span><strong>${right}</strong> of ${graded.length} checked are right</span>` : ""}
        <span class="fill-hint">· Enter jumps to the next field</span>
      </p>

      <div class="chart-grid">${cards}</div>
    </section>`;
}

/* ------------------------------------------------------------- fill: one row */

/** The table the learner is focused on, or null for all three at once. */
function focusedParadigm(settings) {
  return PARADIGM_BY_ID.has(settings.fillParadigm) ? PARADIGM_BY_ID.get(settings.fillParadigm) : null;
}

/** "All three" plus one pill per paradigm, with how solid each table already is. */
function paradigmFilter(state) {
  const { progress, settings } = state;
  const focus = focusedParadigm(settings);
  const total = masteryStats(progress, CELLS);
  const items = [
    { id: "all", label: "All three", solid: total.mastered, size: CELLS.length },
    ...PARADIGMS.map((paradigm) => ({
      id: paradigm.id,
      label: paradigm.title,
      solid: masteryStats(progress, paradigm.cells).mastered,
      size: paradigm.cells.length,
    })),
  ];

  const buttons = items
    .map((item) => {
      const active = item.id === "all" ? !focus : focus?.id === item.id;
      return `
        <button class="pick ${active ? "is-active" : ""}" data-action="focus-paradigm"
                data-value="${esc(item.id)}" aria-pressed="${active}"
                aria-label="${esc(item.label)} — ${item.solid} of ${item.size} solid">
          <span>${esc(item.label)}</span>
          <small>${item.solid}/${item.size}</small>
        </button>`;
    })
    .join("");

  return `
    <div class="pick-row" role="group" aria-label="Practise one table at a time">
      <span class="pick-label">Table</span>${buttons}
    </div>`;
}

/**
 * One paradigm, one case-and-number row blanked out, the other nine rows as the
 * model. Three forms to fill, so it rewards reading the table rather than recall.
 */
export function rowFillView(state) {
  const { row } = state;
  const paradigm = PARADIGM_BY_ID.get(row.paradigmId);
  const graded = row.cells.filter((cell) => row.results[cell.id] !== undefined);
  const right = graded.filter((cell) => row.results[cell.id]).length;
  const complete = graded.length === row.cells.length && right === row.cells.length;
  const written = row.cells.filter((cell) => String(row.entries[cell.id] ?? "").trim()).length;
  const rowName = `${row.caseKey} ${row.number}`;
  const score = graded.length ? `${right}/${row.cells.length}` : "new row";

  const body = paradigm.rows
    .map((entry) => {
      const isTarget = entry.case === row.caseKey && entry.number === row.number;
      const cells = GENDERS.map((gender) => {
        const cell = paradigm.cells.find(
          (c) => c.caseKey === entry.case && c.number === entry.number && c.gender === gender.key,
        );
        if (!isTarget) return `<td class="row-form">${esc(cell.form)}</td>`;

        const value = row.entries[cell.id] ?? "";
        const result = row.results[cell.id];
        const modifier = result === true ? "is-correct" : result === false ? "is-wrong" : "";
        return `<td class="chart-cell ${modifier}">
            <input class="row-input chart-input" type="text" value="${esc(value)}"
                   data-value="${esc(cell.id)}" inputmode="latin" autocomplete="off"
                   autocapitalize="off" autocorrect="off" spellcheck="false"
                   aria-label="${esc(describeCell(cell))}" />
            ${result === false ? `<small class="chart-fix">${esc(cell.form)}</small>` : ""}
          </td>`;
      }).join("");

      return `<tr class="${isTarget ? "is-target" : ""}">
          <th scope="row">${esc(SHORT_CASE[entry.case] ?? entry.case)} <span class="dim">${ROMAN[entry.number]}</span></th>
          ${cells}
        </tr>`;
    })
    .join("");

  const tally = row.tally.total
    ? `<span>· <strong>${row.tally.right}</strong> of ${row.tally.total} checked right this visit</span>`
    : "";

  return `
    <section class="screen">
      <div class="page-head">
        <div>
          <h1 class="page-title">Fill the missing row</h1>
          <p class="lede">
            The rest of the table is your model. Read the pattern and fill the blanked row —
            every form you check moves its mastery level.
          </p>
        </div>
        <div class="fill-tools">${fillSwitch("row")}</div>
      </div>

      ${paradigmFilter(state)}

      <p class="fill-meter">
        <span>Row: <strong>${esc(rowName.toLowerCase())}</strong></span>
        <span class="fill-hint">· Enter moves along the row</span>
        ${tally}
      </p>

      <article class="panel chart-card row-card">
        <header class="paradigm-head">
          <div>
            <h2>${esc(paradigm.title)}</h2>
            <p class="sub">“${esc(paradigm.meaning)}”</p>
          </div>
          <span class="chart-score ${complete ? "is-complete" : ""}" data-row-score>${score}</span>
        </header>

        <div class="table-scroll">
          <table class="chart-table row-table">
            <thead>
              <tr><th scope="col"><span class="sr-only">Case</span></th>
              ${GENDERS.map((g) => `<th scope="col">${esc(g.short)}</th>`).join("")}</tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>

        <div class="chart-actions">
          ${
            graded.length
              ? `<button class="btn btn-quiet" data-action="check-row">Check again</button>
                 <button class="btn btn-primary" data-action="next-row">
                   Next row <span class="key-cap" aria-hidden="true">↵</span><span class="key-cap" aria-hidden="true">space</span>
                 </button>`
              : `<button class="btn btn-quiet" data-action="next-row">Next row</button>
                 <button class="btn btn-primary" data-action="check-row" ${written ? "" : "disabled"}>
                   Check row <span class="key-cap" aria-hidden="true">space</span>
                 </button>`
          }
        </div>
      </article>
    </section>`;
}

/* ---------------------------------------------------------------------- sync */

/** Code entry, or the code plus a link the phone can open directly. */
function syncCard(state) {
  const info = state.sync ?? { code: "", status: "off", error: "", link: "", lastAt: 0 };
  const failed = info.status === "error";

  if (!info.code) {
    return `
      <div class="panel sync-panel">
        <div class="panel-split">
          <div>
            <h2 class="field-title">Sync across devices</h2>
            <p class="sub">
              Give this browser and your phone the same code and they share one progress
              record. Both talk through the copy of the app on your computer, so it has to
              be running for them to catch up with each other.
            </p>
          </div>
          <button class="btn btn-quiet" data-action="create-sync-code">Create a code</button>
        </div>
        <form class="sync-form" data-action="set-sync-code">
          <input
            class="text-input"
            name="code"
            placeholder="tullius-4821"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-label="Sync code"
          />
          <button class="btn btn-primary">Use this code</button>
        </form>
        ${
          failed
            ? `<p class="sync-status is-error"><span class="save-dot is-error" aria-hidden="true"></span>${esc(info.error)}</p>`
            : `<p class="sub sync-hint">Create one here and open the link on your phone, or type the code a device already shows.</p>`
        }
      </div>`;
  }

  const statusText =
    info.status === "syncing"
      ? "Syncing…"
      : failed
        ? info.error
        : info.lastAt
          ? `Synced ${savedAgo(info.lastAt)}`
          : "Waiting for the first sync";
  const loopback = /\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(info.link);

  return `
    <div class="panel sync-panel">
      <div class="panel-split">
        <div>
          <h2 class="field-title">Syncing across devices</h2>
          <p class="sub">
            Answers made here and on your phone are merged, never replaced, within a few seconds.
          </p>
        </div>
        <div class="cta-row">
          <button class="btn btn-quiet" data-action="sync-now">Sync now</button>
          <button class="btn btn-primary" data-action="copy-sync-link">Copy link</button>
        </div>
      </div>

      <div class="sync-linked">
        <div class="sync-block">
          <span class="sync-label">Code</span>
          <span class="sync-code">${esc(info.code)}</span>
        </div>
        <div class="sync-block grow">
          <span class="sync-label">Open this on your phone</span>
          <a class="sync-link" href="${esc(info.link)}">${esc(info.link)}</a>
        </div>
      </div>

      <p class="sync-status ${failed ? "is-error" : ""}">
        <span class="save-dot ${failed ? "is-error" : ""}" aria-hidden="true"></span>${esc(statusText)}
      </p>
      ${
        loopback
          ? `<p class="sub">That address only works on this computer — open the app through its network address to reach it from your phone.</p>`
          : ""
      }
      <p class="sub sync-hint">
        <button class="link-btn" data-action="unlink-sync">Stop syncing this browser</button>
      </p>
    </div>`;
}

/* ------------------------------------------------------------------ progress */
export function progressView(state) {
  const { progress } = state;
  const stats = masteryStats(progress, CELLS);
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;
  const weak = weakestCells(progress, CELLS, 8);

  const legend = [
    [0, "New"],
    [2, "Learning"],
    [3, "Familiar"],
    [4, "Solid"],
    [5, "Mastered"],
  ]
    .map(([box, label]) => `<span class="legend-item"><i class="swatch m${box}"></i>${label}</span>`)
    .join("");

  const grids = PARADIGMS.map((paradigm) => {
    const body = paradigm.rows
      .map((row) => {
        const cells = GENDERS.map((gender) => {
          const cell = paradigm.cells.find(
            (c) => c.caseKey === row.case && c.number === row.number && c.gender === gender.key,
          );
          const box = boxOf(progress, cell.id);
          return `<td class="mastery-cell m${box}" title="${esc(cell.form)} — ${esc(row.case)} ${row.number} ${gender.label}">${esc(cell.form)}</td>`;
        }).join("");
        return `<tr><th scope="row">${esc(SHORT_CASE[row.case] ?? row.case)} <span class="dim">${ROMAN[row.number]}</span></th>${cells}</tr>`;
      })
      .join("");

    return `
      <article class="panel paradigm-card compact">
        <header class="paradigm-head">
          <h2>${esc(paradigm.title)}</h2>
          <span class="tag">${masteryStats(progress, paradigm.cells).mastered}/30 mastered</span>
        </header>
        <div class="table-scroll">
          <table class="mastery-table">
            <thead><tr><th></th>${GENDERS.map((g) => `<th>${esc(g.short)}</th>`).join("")}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </article>`;
  }).join("");

  return `
    <section class="screen">
      <div class="page-head">
        <div>
          <h1 class="page-title">Your progress</h1>
          <p class="lede">Each form has its own mastery level. Correct answers push it up; misses drop it two steps.</p>
        </div>
      </div>

      <div class="stat-row big">
        <div><dt>Mastered</dt><dd>${stats.mastered}<span>/${CELLS.length}</span></dd></div>
        <div><dt>Solid</dt><dd>${stats.buckets[4]}</dd></div>
        <div><dt>Familiar</dt><dd>${stats.familiar}</dd></div>
        <div><dt>Learning</dt><dd>${stats.learning}</dd></div>
        <div><dt>Not seen</dt><dd>${stats.fresh}</dd></div>
        <div><dt>Accuracy</dt><dd>${accuracy}<span>%</span></dd></div>
      </div>

      <div class="legend">${legend}</div>
      <div class="paradigm-grid">${grids}</div>

      ${
        weak.length
          ? `<div class="panel">
              <div class="panel-split">
                <div>
                  <h2 class="field-title">Trickiest forms</h2>
                  <p class="sub">Ranked by mastery, then by how often you miss them.</p>
                </div>
                <button class="btn btn-primary" data-action="drill-weak">${
                  weak.length === 1 ? "Drill this form" : `Drill these ${weak.length}`
                }</button>
              </div>
              <ul class="weak-list">
                ${weak
                  .map(
                    (cell) => `<li>
                      <span class="weak-form">${esc(cell.form)}</span>
                      <span class="weak-desc">${esc(describeCells([cell]))}</span>
                      <span class="weak-paradigm">${esc(PARADIGM_BY_ID.get(cell.paradigmId).title)}</span>
                    </li>`,
                  )
                  .join("")}
              </ul>
            </div>`
          : `<div class="panel empty-panel">
              <p>Nothing to criticise yet. Finish a session and your weak spots will surface here.</p>
            </div>`
      }

      <div class="panel save-panel">
        <div class="panel-split">
          <div>
            <h2 class="field-title">Saved on this device</h2>
            <p class="sub">
              Every answer is saved automatically in this browser. Export a backup to keep a copy
              or to carry your progress to another device.
            </p>
          </div>
          <div class="cta-row">
            <button class="btn btn-quiet" data-action="export-backup">Export backup</button>
            <button class="btn btn-quiet" data-action="import-backup">Import backup</button>
          </div>
        </div>
        ${saveLine()}
        <input class="import-input" type="file" accept="application/json,.json" hidden />
      </div>

      ${syncCard(state)}

      <div class="panel danger-panel">
        <div class="panel-split">
          <div>
            <h2 class="field-title">Start over</h2>
            <p class="sub">Clears every mastery level and lifetime statistic stored in this browser.</p>
          </div>
          <button class="btn btn-danger" data-action="reset-progress">Reset progress</button>
        </div>
      </div>
    </section>`;
}
