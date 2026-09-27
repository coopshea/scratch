# Drafting tool — v1 spec and build plan

**Owner:** Cooper Shea
**Date:** 2026-09-26
**Status:** Draft for decision. Supersedes the lens-map prototype in `archive/v0-map-prototype/`.

---

## Objective

Get from rapid nonlinear thinking to a human-written v1 draft as fast as possible, then iterate. The tool structures; the human writes. The model never writes prose.

Primary use: essays aimed at AI safety hiring. That means worked examples with code and figures (teaching, paper) and stated opinions (persuasive).

## The three stages

```
1. TALK        blurt freely  ->  parser cuts into units  ->  loose cluster graph
2. STRUCTURE   drag clusters into the slots of a scaffold (paper | persuasive | teaching)
3. DRAFT       Cornell layout: outline on the left, blank markdown editor on the right
```

Stages are tabs, not doors. You can go back at any time, and the draft can send new units back to the board.

---

## Rigid classification

Everything resolves to the scaffold through three fixed rules. No fuzzy matching decides where anything lives.

### Rule 1: every unit has exactly one type

| Type | What it is | Example |
|---|---|---|
| claim | Something you assert and could be wrong about | "Reward models overfit to length" |
| evidence | A data point, citation, or result | "RLHF paper, table 3" |
| story | An anecdote or example, concrete and specific | "The half-pixel Kaggle exploit" |
| question | Something you do not know yet | "Does this hold at 70B?" |
| objection | The strongest case against a claim | "Length is a proxy for helpfulness" |
| concept | A term that needs defining | "Goodhart's law" |
| coinage | A pithy phrase, analogy, or acronym you want to stick | "Hike the mountain" |
| artifact | A figure, code block, or notebook, described now and built later | "FIG: reward vs length scatter" |

Coinage has a required `prior_art` field: who named something similar first. Empty prior art is flagged at the end.

### Rule 2: every non-claim unit has exactly one home

- A claim is a cluster root. Every other unit belongs to exactly one claim, or sits in the **unassigned tray**.
- One home, many references. A story that fits two places lives under one claim and is *referenced* from the other. Moving it changes its home; references follow.
- The parser proposes a home. You confirm or drag it elsewhere. Nothing is permanently misfiled because nothing is merged.

### Rule 3: every scaffold slot has a fixed role

Roles are a closed set:

| Role | Accepts | Notes |
|---|---|---|
| hook | story, question, coinage | Opens the piece |
| context | concept, evidence, story | What the reader must already know |
| thesis | claim | Exactly one. Carries the required "what would change my mind" field |
| point | claim (with its cluster) | The numbered paragraphs: P1, P2, P3 |
| example | story, artifact | Worked example; code and figures live here |
| objection | objection | Strongest counter, with the response |
| footnote | any | Asides you want to keep but not in the main line |
| close | claim, question, coinage | Call to action, open questions, or summary |

Plus two bins that exist in every structure: **unassigned** and **cut**. Nothing is ever deleted from the board, only cut.

### The three structures are role sequences

| Paper | Persuasive | Teaching |
|---|---|---|
| hook (question) | hook (story) | hook (question) |
| context (prior work) | context (stakes) | context (what you already believe) |
| thesis | thesis | concept |
| point × 2–4 | point × 3 | example (worked, code/figure) |
| example | objection | objection (the common misconception) |
| objection (limitations) | close (call to action) | point (check question) |
| close (open questions) | footnote | close (where next) |
| footnote | | footnote |

**Switching structures** re-slots every cluster by role. Required roles left empty show as red gaps. This is how a persuasive draft reveals where an academic version needs evidence.

---

## Stage 1: Talk

- One large text box. Type or paste. Voice-to-text is whatever the OS provides.
- Raw blurts are saved immutably. The parser never edits them.
- **Parser output per unit:** type, a label, the original text span (your words, trimmed, never reworded), a proposed home claim, and a pointer to the character offsets in the raw blurt.
- **Label rules:** 3–6 words, max 40 characters, heavily abstracted to the idea ("law of the minimum", not "the thing about plant fertilizer and the scarcest nutrient"). Enforced at save; over-length labels are rejected, not truncated.
- A **review list** after parsing: every unit in a row, type and label editable inline, keyboard-driven. This is the only place you correct the parser.
- The graph shows clusters around claims, labels only. Navigation is drag to pan and click to open. Hover shows the original span. No zoom controls, search, lenses, or side panels.

## Stage 2: Structure

- Top: the cluster graph. Bottom: the scaffold as horizontal lanes ("energy levels"), one per slot.
- Drag a claim into a lane; its whole cluster follows. Drag a single unit to rehome it.
- Relationships are shown by position, not lines. Units stacked under a claim support it. An objection sits on the claim's right edge with a red border.
- **Claim color** is mechanical and readable:
  - red: no evidence attached
  - amber: evidence attached but unverified, or suggested by the model
  - green: verified evidence plus at least one objection addressed
- Structure switcher at the top. Switching never loses anything; clusters with no fitting role land in unassigned.

## Stage 3: Draft

- Left column, Cornell style: the scaffold as an outline, lane by lane. Each unit shows its label; a disclosure triangle reveals the original blurt text so you can reread it while rewriting.
- Right column: a plain markdown editor. Headings are pre-filled from the scaffold so the page is never blank. Code blocks and images are plain markdown.
- **Linking is explicit.** Drag a unit from the left into the editor, or type a trigger key and pick it. Either inserts an anchor that renders as a quiet chip. The model may suggest a link; a link exists only when you confirm it.
- **Using ideas:**
  - first use: the unit is struck through on the left
  - reuse: a callback highlight appears in the editor
  - hover a unit on the left: every place it is used in the draft highlights, and the editor scrolls to the first one
- **Reverse flow:** select text in the draft and make it a unit. It lands on the board with origin = draft.
- **Placeholder markers:** typing `TK` followed by a note creates a red evidence stub on the board and keeps you writing. `FIG` followed by a description creates an artifact stub. See "Staying out of the rabbit hole."
- The model does spelling and typos only in this stage.

---

## Model boundaries

The model does exactly three things:

1. **Parse** (stage 1): cut, type, label, propose a home. Never rewords your text.
2. **Suggest** (stage 2): v1 ships two actions on a claim or cluster, *find a source* and *find a parallel or example*. The result is a stub unit with a headline of 6 words or fewer, 1–2 links, `origin: model`, `verified: false`, and an **empty body only you can fill**.
3. **Check** (end of drafting): flags only, never rewrites. See end checks.

Model-origin units render differently everywhere (hollow outline) until you have written their body and marked them verified.

## Version control and replay

- Every action is an event in an append-only log: blurt, parse, relabel, rehome, slot, switch structure, suggest, accept, verify, and draft snapshot.
- Each event records time and author (human or model).
- Draft text is snapshotted when you pause typing, not on every keystroke.
- Git auto-commits at each stage change and on demand.
- **Replay:** a scrubber over the event log. Press play on a finished draft and watch it assemble from blurt to board to prose.
- **Post-hoc evidence flag:** evidence attached to a claim *after* that claim was placed in the draft is labeled "found after position taken." This is information, not an error. It keeps motivated reasoning visible without stopping you from writing.

## End checks

Run on demand. All three only flag.

1. **Style lint** against a rule set we write together (sentence length, hedges, undefined terms, passive voice). Deterministic code wherever possible.
2. **Coinage and prior art:** every coinage and every novel-sounding term is listed. Any with empty `prior_art` is flagged, with the prompt "who named this first?" Preferring an established theory by a known author over your own new name is the default.
3. **Coverage:** units never used, claims still red, required roles still empty, TK and FIG stubs still open.

---

## Staying out of the rabbit hole

The tool enforces most of these by mode, so willpower isn't the only defense.

- **Draft pass has no research.** In stage 3 the suggest actions are disabled. A gap becomes `TK` and you keep writing. The journalist's convention exists for exactly this.
- **Write your prior before you search.** The thesis "what would change my mind" field is required before the evidence pass opens.
- **Budget the evidence pass.** One pass after the v1 draft, capped per claim, for example 15 minutes and two sources. Red claims that stay red after the budget become objections or get cut.
- **Describe figures, build later.** `FIG` stubs let you write around a figure without making it.
- **v1 is done when every lane has prose,** regardless of color. Evidence and figures are v2.

---

## Cut from scope

The lens system, value and uncertainty scoring, the worth-wandering ranking, hike mode, the essay path overlay, the community aggregator, typed edges, live semantic auto-linking, keystroke-level replay, a model-scored strength number, and graph zoom and search. Archived in `archive/v0-map-prototype/`.

---

## Build plan

| Phase | Deliverable | Rough effort |
|---|---|---|
| 0 | git init; project folder layout; event log writer; local Node server with no dependencies | half a day |
| 1 | Talk: blurt box, parser call, review list, cluster graph | 2 days |
| 2 | Structure: lanes, drag and drop, three structure templates, claim colors, bins | 2–3 days |
| 3 | Draft: Cornell column, editor with anchors, strike and callback highlights, hover-to-find, TK and FIG stubs, reverse flow | 3 days |
| — | **Dogfood gate:** write one real AI safety piece end to end before continuing | — |
| 4 | Replay scrubber, post-hoc evidence flag, three end checks | 2 days |
| 5 | Two suggest actions | 1 day |

### Proposed storage, one folder per essay

```
projects/<slug>/
  blurts/<timestamp>.md     raw, immutable
  units.json                current state of all units (derived from the log)
  board.json                structure choice, lane assignments
  draft.md                  the prose, with anchors
  events.jsonl              append-only log; the source of truth
```

## Progress

- **2026-09-26:** Phases 0 and 1 built. Stack chosen per the drop-in rule (see README). Node notes are rich text via BlockNote, per Cooper's request that every unit can be expanded like a small note. Parser verified against the API up to billing: the account needs credit before live parses work. Offline mode verified end to end.

## Decisions needed

1. ~~Editor~~ Decided: drop-in tools; CodeMirror 6 for the draft, BlockNote for node notes.
2. ~~Parser key~~ Decided: local `.env`, gitignored.
3. **Anchor syntax in `draft.md`.** Recommend an HTML comment such as `<!--u:7f3a-->` so the exported markdown stays clean anywhere.
4. **Role set.** Confirm the eight roles and the three sequences above, or edit them.
5. **Style rules.** Write the lint rule set together before phase 4.
6. **First real essay** for the dogfood gate.
