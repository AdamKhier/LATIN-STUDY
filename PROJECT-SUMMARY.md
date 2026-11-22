# Pronomen — Latin Pronoun Drills

> Reconstructed 22 Nov 2026 from the repository itself, not from chat history.

## What it is
A dependency-free quiz app for the three Latin pronoun paradigms — *hic, haec, hoc*; *ille, illa, illud*; *qui, quae, quod* — 90 forms in total.

Each form is tracked separately with mastery 0–5: correct +1, wrong −2, and new questions are weighted up to 5× toward weak or unseen forms. Modes: Mixed, Recall (type the form), Recognise (pick the grammar), plus Fill charts, One-row drills, Tables with masking, and a Progress heatmap.

## Stack
Plain ES modules, no framework, no build step. `serve.py` (stdlib) serves the app and a small device-to-device sync API; `.sync/` holds shared progress records.

## How to run
```bash
python3 serve.py            # http://localhost:8123, LAN address printed
python3 serve.py --port 8000
```

## Data and backups
- Markdown tables in `latin_pronoun_tables/` are the source of truth; regenerate with `python3 scripts/build_data.py`.
- `scripts/backup-sync.sh` archives `.sync/` nightly; `deploy/` holds the systemd service and timer.

## Gaps
- Sync only works while the machine running `serve.py` is on.
- Not hosted; LAN use only.

## Git
`AdamKhier/LATIN-STUDY` — public. Last code change 29 Oct 2026.
