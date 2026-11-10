import { PARADIGMS as RAW } from "./data.js";

export const CASES = [
  { key: "Nominative", abbr: "nom" },
  { key: "Genitive", abbr: "gen" },
  { key: "Dative", abbr: "dat" },
  { key: "Accusative", abbr: "acc" },
  { key: "Ablative", abbr: "abl" },
];

export const NUMBERS = [
  { key: "singular", label: "singular", abbr: "sg", labelCap: "Singular" },
  { key: "plural", label: "plural", abbr: "pl", labelCap: "Plural" },
];

export const GENDERS = [
  { key: "masculine", label: "masculine", labelCap: "Masculine", short: "m." },
  { key: "feminine", label: "feminine", labelCap: "Feminine", short: "f." },
  { key: "neuter", label: "neuter", labelCap: "neuter", short: "n." },
];

const CASE_ABBR = Object.fromEntries(CASES.map((c) => [c.key, c.abbr]));
const NUMBER_ABBR = Object.fromEntries(NUMBERS.map((n) => [n.key, n.abbr]));

/** Normalise a Latin spelling for comparison: case, accents, u/v-ish j/i. */
export function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/j/g, "i")
    .replace(/v/g, "u")
    .replace(/[\s]+/g, " ")
    .trim();
}

/** "a", "a & b", "a, b & c" */
export function joinList(items, conjunction = "&") {
  const list = [...items];
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} ${conjunction} ${list[list.length - 1]}`;
}

/** Paradigms with flat rows and one entry per (row, gender) form. */
export const PARADIGMS = RAW.map((raw) => {
  const rows = [
    ...raw.singular.map((row) => ({ ...row, number: "singular" })),
    ...raw.plural.map((row) => ({ ...row, number: "plural" })),
  ];
  const cells = rows.flatMap((row) =>
    GENDERS.map((gender) => ({
      id: `${raw.id}:${CASE_ABBR[row.case]}:${NUMBER_ABBR[row.number]}:${gender.short[0]}`,
      paradigmId: raw.id,
      caseKey: row.case,
      number: row.number,
      gender: gender.key,
      form: row.forms[gender.key],
      caseLabel: row.case,
      numberLabel: NUMBER_ABBR[row.number] === "sg" ? "singular" : "plural",
      genderLabel: gender.label,
    })),
  );
  return { ...raw, rows, cells };
});

export const CELLS = PARADIGMS.flatMap((paradigm) => paradigm.cells);
export const CELL_BY_ID = new Map(CELLS.map((cell) => [cell.id, cell]));
export const PARADIGM_BY_ID = new Map(PARADIGMS.map((paradigm) => [paradigm.id, paradigm]));

export function getCell(cellId) {
  return CELL_BY_ID.get(cellId);
}

/** Every cell in the same paradigm that shares this form, e.g. "quibus" -> 6 cells. */
export function cellsForForm(paradigmId, form) {
  const paradigm = PARADIGM_BY_ID.get(paradigmId);
  if (!paradigm) return [];
  const target = fold(form);
  return paradigm.cells.filter((cell) => fold(cell.form) === target);
}

/** Grammar description shared by a set of cells. */
export function describeCells(cells) {
  if (cells.length === 0) return "";
  const cases = CASES.filter((c) => cells.some((cell) => cell.caseKey === c.key)).map((c) => c.key);
  const numbers = NUMBERS.filter((n) => cells.some((cell) => cell.number === n.key));
  const genders = GENDERS.filter((g) => cells.some((cell) => cell.gender === g.key));

  const caseText = joinList(cases);
  const numberText =
    numbers.length === 2 ? "singular & plural" : (numbers[0]?.label ?? "singular");
  const genderText = genders.length === 3 ? "all genders" : joinList(genders.map((g) => g.label));
  return `${caseText} ${numberText} · ${genderText}`;
}

/** Human label for one cell, e.g. "Genitive plural · feminine". */
export function describeCell(cell) {
  return `${cell.caseLabel} ${cell.numberLabel} · ${cell.genderLabel.toLowerCase()}`;
}

/** The (case, number) rows a set of cells belongs to, for explanation tables. */
export function rowsForCells(cells) {
  const seen = new Set();
  const rows = [];
  for (const cell of cells) {
    const key = `${cell.number}:${cell.caseKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const paradigm = PARADIGM_BY_ID.get(cell.paradigmId);
    const row = paradigm.rows.find((r) => r.number === cell.number && r.case === cell.caseKey);
    rows.push({
      caseLabel: cell.caseLabel,
      numberLabel: cell.numberLabel,
      forms: row.forms,
      highlight: new Set(
        cells.filter((c) => c.number === cell.number && c.caseKey === cell.caseKey).map((c) => c.gender),
      ),
    });
  }
  return rows;
}
