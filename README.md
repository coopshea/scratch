# Scratch

Blurt, structure, draft. Turns rapid nonlinear thinking into a human-written v1 draft. The model cuts and labels; it never writes your prose. Spec and build plan: [docs/spec-v1.md](docs/spec-v1.md).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5178. Add `?p=<slug>` to switch projects; the default is `scratch`.

`npm run dev:offline` runs on port 5179 with a sentence-splitting stand-in for the parser, for UI work without API calls.

The parser needs `ANTHROPIC_API_KEY` in `.env` (gitignored).

## Stack, drop-in wherever possible

| Piece | Tool |
|---|---|
| App | Vite + React + TypeScript, served by a small Express server that holds the key and writes files |
| Parser | Anthropic SDK, `claude-opus-5`, structured output via Zod, server-side refusal fallback on |
| Cluster graph | `d3-force`, contained and auto-fitted to the pane; no infinite canvas |
| Node notes | BlockNote (rich text, images, slash menu) |
| Draft editor | CodeMirror 6 |
| History | append-only event log, replayed to any moment |

## Data, one folder per project

```
projects/<slug>/
  blurts/*.md     raw blurts, immutable
  units.json      current state of every unit
  meta.json       title
  board.json      lane arrangement for each of the three structures
  draft.md        the prose; sections are <!--s:lane--> markers, ideas are <!--u:id--> anchors
  events.jsonl    append-only log; every action with time and author
  assets/         images pasted into notes
```

## Status

All three stages work.

- **Talk:** blurt, parse, review, contained force graph with no overlapping nodes, rich-text note per unit.
- **Structure:** the Talk graph with the structure's levels as full-width dashed bands, names at far left. Loose clusters float right, faint. Drop a cluster on the left half of a level and it locks there in full ink; drop it on the right half to release it. A unit pulled out of its cluster keeps a dotted thread to its claim, so clusters can span levels. Any unit can go on any level; one that doesn't match the level's usual type gets a faint dotted outline. Levels grow to fit what's placed in them. Switching structure carries the arrangement over by role; empty required levels are red. Claim support marks: ○ no evidence, ◐ evidence not checked or no objection, ● checked evidence and an objection.
- **Draft:** outline on the left, page on the right, one scroll. Each level of the structure is a section: a dashed rule runs across both columns, and each outline section sits level with its text, so writing in one section pushes the later ones down on both sides. The section holding the cursor is highlighted. Drag an idea into the text, or double-click it, to place it; placing it moves it into that section automatically. Mentioning an idea by name without placing it offers "move here". Drag ideas between outline sections to move them. Used ideas are struck through; repeat uses are highlighted as callbacks.
- **Your own outlines:** `+` under the level names adds a level with a combobox (type to filter; Tab takes the top match, Enter keeps what you typed). Common levels number themselves: argument 4, section 2. Built-in outlines are templates, so the first edit saves your own copy ("my paper") with every placement carried over. `+` beside the outline names starts one from a typed list, one level per line; double-click your outline's name to edit or delete it. Stored in `projects/_archetypes.json`, shared across documents.
- **Export:** `export` downloads clean markdown; `copy` puts the same on the clipboard. Section markers drop out, evidence placed in the text becomes numbered footnotes, figures still to make become `*[Figure: …]*`, and other idea chips disappear.
- **Documents:** toggle with ≡ at top left; hidden by default. Each shows its title and its top claim labels.
- **History:** a slider over every event, read-only, in any stage.
