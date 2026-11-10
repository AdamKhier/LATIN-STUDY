# Pronomen — Latin pronoun drills

A small, dependency-free quiz app for the three pronoun paradigms in
`latin_pronoun_tables/`:

- **hic, haec, hoc** — demonstrative, *this*
- **ille, illa, illud** — demonstrative, *that*
- **qui, quae, quod** — relative, *who / which / that*

90 forms in total. No build step, no framework, no dependencies. Offline by
default; optional device-to-device sync runs through the small server below.

## Run it

```bash
python3 serve.py            # http://localhost:8123, and your phone at http://<lan-ip>:8123
python3 serve.py --port 8000
```

The script prints the loopback and network addresses on startup; it binds
`0.0.0.0` so a phone on the same Wi-Fi can open it. The app is plain ES modules,
so `file://` will not load it.

`serve.py` is a static file server plus the tiny sync API (stdlib only, no
installs). Any other static server still runs the app, only without sync:

```bash
python3 -m http.server 8000
```

## How the learning works

Every one of the 90 forms is tracked separately with a mastery level from 0 to 5.

| Answer   | Effect                                   |
| -------- | ---------------------------------------- |
| Correct  | level +1 (capped at 5)                   |
| Incorrect| level −2 (floored at 0)                  |

When a new question is drawn, forms are picked with a weighted random draw:
unseen and low-level forms are up to five times more likely to come up than
forms you already know. Over a few sessions the queue naturally concentrates on
your gaps.

Three practice modes:

- **Mixed** — alternates production and recognition questions.
- **Recall** — you are given case, number and gender, and type the Latin form.
  Accents/macrons and upper case are ignored (`quōrum`, `QUORUM` and `quorum`
  all pass).
- **Recognise** — you see a form and pick its grammar from four options. Options
  are generated from real cells in the same paradigm, so a wrong option is
  always genuinely wrong — never a second correct reading of the same form.

After each answer the app shows the correct form with its row from the paradigm,
highlighting the cell(s) it belongs to, so a miss doubles as a look at the table.

Other screens:

- **Fill** — three blank charts. Type whatever you know, then check a table;
  blanks stay unticked so you can build a table up over several passes. Correct
  cells turn green, misses go red with the right form underneath, and every
  checked form counts towards mastery once. `Enter` jumps to the next field.
  The switch at the top changes the exercise to **One row**: the table is shown
  in full with a single case-and-number row blanked out, so you can read the
  pattern and supply the three gender forms (`Next row` picks a new one,
  favouring rows whose forms are weakest). A row of pills under the heading
  narrows that exercise to **one table at a time** — useful while a paradigm is
  still new — with each pill showing how many of its forms are already solid;
  **All three** mixes them again. That choice is saved with your settings. Both
  exercises feed the same mastery levels.
- **Tables** — all three paradigms side by side, with a *Mask forms* mode for
  self-testing from memory (click a masked cell to reveal it).
- **Progress** — a per-form mastery heatmap for each paradigm, lifetime
  statistics, the forms you miss most, and a button to drill just those.

## Saving

Everything saves itself: each answer writes immediately, chart input is written
~400 ms after you stop typing, and settings save on change. The footer shows the
last save (`Autosaved just now`) with a green dot, or a red dot and a warning if
the browser is blocking local storage.

Storage keys, all local to the browser:

| Key                       | Contents                                  |
| ------------------------- | ----------------------------------------- |
| `pronomen.progress.v1`    | per-form mastery, lifetime counts         |
| `pronomen.settings.v1`    | mode, paradigm selection, session length, the table focused in *One row* |
| `pronomen.chart-draft.v1` | anything half-typed into the Fill charts  |
| `pronomen.saved-at.v1`    | timestamp of the last successful write    |
| `pronomen.sync.v1`        | sync code and the timestamps that settle conflicts |

**Backups.** *Export backup* on the Progress tab downloads a JSON file with your
progress and settings; *Import backup* restores one, after confirming it will
replace what is on the device. Bad files are rejected with a readable message
and leave your progress untouched.
*Reset progress* clears mastery and statistics but keeps settings.

## Sync across devices

Optional, and off until you ask for it. On **Progress → Sync across devices**,
press *Create a code* (`livy-4400` and the like). The card then shows a link —
`http://192.168.3.91:8123/#sync=livy-4400` — which you open on your phone (or you
type the code into another browser). Both devices now share one progress record:
every answer reaches the other within a few seconds, on a timer, on tab focus,
and immediately before the tab closes.

How conflicts are handled, so nothing is ever lost:

| What            | Rule                                                              |
| --------------- | ----------------------------------------------------------------- |
| A single form   | The record with more attempts wins, then the higher level, then more correct answers, then most recent |
| Totals          | Re-derived from the merged per-form records                        |
| Settings / Fill text | Last edit wins; text in the cell you are typing in is never overwritten |

A device always pulls before it pushes, so each write is a merge rather than a
replacement. Local storage stays the source of truth on the device: it works
offline, and a server that is off only means "stale until it is back".

Sync talks to the `serve.py` process, so the computer running it has to be on and
reachable; the phone needs no app and no account. Each code is a separate record,
kept in `.sync/` as a hash of the code — anyone on the same network who knows a
code can read it, so it is a household convenience, not a private vault. *Stop
syncing* unlinks the browser and leaves all progress in place on both sides.

## Nightly backups (server)

`.sync/` holds every shared progress record, so it is the one thing worth
backing up on the machine running `serve.py`. `scripts/backup-sync.sh` archives
it to `~/backups/pronomen/sync-<UTC stamp>.tar.gz`, repoints `latest.tar.gz` at
the newest archive, and deletes archives older than `KEEP` days (default 30).
Each archive is verified with `gzip -t` and a list pass before the run counts, so
a truncated file fails instead of masquerading as a backup.

```bash
./scripts/backup-sync.sh                          # app dir = parent of the script
DEST=/mnt/usb/pronomen KEEP=90 ./scripts/backup-sync.sh
```

`deploy/pronomen-backup.service` and `deploy/pronomen-backup.timer` run it nightly
at 03:30, with `Persistent=true` so a night the box was off is caught up later:

```bash
sudo install -m 644 deploy/pronomen-backup.service deploy/pronomen-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pronomen-backup.timer
sudo systemctl start pronomen-backup.service   # one run now
journalctl -u pronomen-backup -n 20 --no-pager
```

The default destination is on the same disk as the data, which protects against
mistakes and overwrites but not against the disk dying. Point `DEST` at another
mount, or copy the archives off the machine, for that.

## Keyboard

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| `Enter`         | Submit a typed answer / continue             |
| `1`–`4`         | Pick an option in Recognise questions        |
| `Enter`/`Space` | Continue after feedback                      |
| `Enter`         | Jump to the next field while filling a chart or row |
| `1`–`3`         | Jump to that cell in the row you are filling |
| `Space`         | Walk the cells while filling, in either fill style |
| `Space`         | In an empty cell, step back to the cell you came from |
| `Space`         | On the last box of a blanked row, check the row |
| `Enter`/`Space` | After checking a row, move straight on to the next one |

So a whole row can be drilled with one key: type, `Space`, type, `Space`, type,
`Space` (checks the row), `Space` (next row, first box focused).

While filling, `1`, `2` and `3` jump straight to the first, second and third cell
of the row you are on — the three boxes of a blanked row, or the masculine,
feminine and neuter cell of the case row your cursor is in. Digits never appear in
a Latin form, so they work as shortcuts even from inside a cell.

Jumping into a cell puts the caret after whatever is already written, like a click
at the end of the word, so typing continues the form instead of wiping it. Press the
number of the cell you are already in to select the whole form, so the next word you
type replaces it.

`Space` in a fill cell moves on rather than typing, since a Latin form is a single
word. In a cell with nothing in it, the same key steps *back* to the cell you came
from, so a skipped cell never gets checked blank and silently counted. Rows with a
cell you mean to leave empty are checked with `Enter` or the *Check row* button.

On the last cell of a whole table, `Space` hands focus to *Check table* instead of
firing it, so a 90-cell grid is never graded by accident.

A quiz answer box is the one place a space is just a space; when a button has
focus `Space` activates it the browser's usual way.

## Editing the tables

The markdown files are the source of truth. After changing them, regenerate the
app data:

```bash
python3 scripts/build_data.py
```

The script validates each file (title, italic subtitle, `## Singular` and
`## Plural` sections, five cases, three genders) and rewrites `src/data.js`. It
fails loudly rather than emitting half-parsed data.

## Files

```
index.html                 app shell
styles.css                 all styling (light + dark via prefers-color-scheme)
src/main.js                state, session flow, event handling
src/views.js               markup for every screen
src/quiz.js                question generation, distractors, grading
src/paradigms.js           paradigm/cell model and grammar descriptions
src/store.js               mastery, settings, chart draft, backups, save status
src/sync.js                merge rules and the pull/merge/push loop
src/data.js                generated from the markdown tables — do not edit
serve.py                   static server + tiny sync API (creates .sync/)
scripts/build_data.py      markdown → src/data.js
scripts/backup-sync.sh     nightly archive of .sync/
deploy/                    systemd units for the nightly backup
latin_pronoun_tables/      the source tables
```
