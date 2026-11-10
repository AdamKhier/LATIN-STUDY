import {
  cellsForForm,
  describeCell,
  describeCells,
  fold,
  getCell,
  PARADIGM_BY_ID,
} from "./paradigms.js";
import { weightFor } from "./store.js";

function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Weighted sampling; repeats only once the pool is exhausted. */
export function pickCells(pool, count, progress) {
  if (pool.length === 0) return [];
  const picked = [];
  let available = [...pool];

  while (picked.length < count) {
    if (available.length === 0) available = [...pool];
    const weights = available.map((cell) => weightFor(progress, cell.id));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = Math.random() * total;
    let index = available.length - 1;
    for (let i = 0; i < available.length; i += 1) {
      target -= weights[i];
      if (target <= 0) {
        index = i;
        break;
      }
    }
    picked.push(available[index]);
    available.splice(index, 1);
  }
  return picked;
}

function parseOptions(cell) {
  const paradigm = PARADIGM_BY_ID.get(cell.paradigmId);
  const truth = cellsForForm(cell.paradigmId, cell.form);
  const truthIds = new Set(truth.map((c) => c.id));
  const answer = describeCells(truth);

  const used = new Set([answer]);
  const distractors = [];
  for (const other of shuffle(paradigm.cells)) {
    if (distractors.length >= 3) break;
    if (truthIds.has(other.id)) continue;
    const label = describeCells([other]);
    if (used.has(label)) continue;
    used.add(label);
    distractors.push(label);
  }

  const options = shuffle([answer, ...distractors]);
  return {
    options,
    answerIndex: options.indexOf(answer),
    answer,
    truthIds: [...truthIds],
  };
}

/** Turn a cell into either a "give the form" or a "parse the form" question. */
export function makeQuestion(cell, type) {
  const paradigm = PARADIGM_BY_ID.get(cell.paradigmId);
  const base = {
    cellId: cell.id,
    paradigmId: cell.paradigmId,
    paradigmTitle: paradigm.title,
    paradigmMeaning: paradigm.meaning,
  };

  if (type === "parse") {
    const { options, answerIndex, answer, truthIds } = parseOptions(cell);
    return {
      ...base,
      type: "parse",
      form: cell.form,
      options,
      answerIndex,
      answer,
      truthIds,
    };
  }

  return {
    ...base,
    type: "produce",
    caseLabel: cell.caseLabel,
    numberLabel: cell.numberLabel,
    genderLabel: cell.genderLabel,
    answer: cell.form,
    cue: describeCell(cell),
  };
}

export function buildSession({ cells, count, progress, mode }) {
  const picked = pickCells(cells, count, progress);
  const types =
    mode === "mixed"
      ? shuffle(
          picked.map((_, index) => (index % 2 === 0 ? "produce" : "parse")).slice(0, picked.length),
        )
      : picked.map(() => mode);

  return picked.map((cell, index) => makeQuestion(cell, types[index]));
}

export function isCorrect(question, response) {
  if (question.type === "produce") {
    return fold(response) === fold(question.answer);
  }
  return response === question.answerIndex;
}

export function explain(question) {
  const cell = getCell(question.cellId);
  const paradigm = PARADIGM_BY_ID.get(question.paradigmId);
  const note = `${paradigm.title} · ${paradigm.kind.toLowerCase()}: ${paradigm.meaning}`;

  if (question.type === "parse") {
    const truth = question.truthIds.map(getCell);
    const describe = describeCells(truth);
    return {
      heading: `${question.form} — ${describe}`,
      describe,
      note,
      cellIds: truth.map((c) => c.id),
    };
  }

  const describe = describeCell(cell);
  return {
    heading: `${question.answer} — ${describe}`,
    describe,
    note,
    cellIds: [cell.id],
  };
}
