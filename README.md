# Scratch

Blurt, structure, draft. Turns rapid nonlinear thinking into a human-written v1 draft. The model cuts and labels; it never writes your prose. Design rationale: [docs/rationale.md](docs/rationale.md).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5178. Add `?p=<slug>` to switch projects; the default is `scratch`.

`npm run dev:offline` runs on port 5179 with a sentence-splitting stand-in for the parser, for UI work without API calls.

## Hosting

The hosted site is the same app with sign-in turned on. It turns on when `CLERK_SECRET_KEY` is set; without it, everything below works as a local tool.

- **Sign-in:** Clerk. The server checks the session on every `/api` and `/projects` request.
- **Accounts:** Postgres, one `accounts` table (`server/accounts.ts`). Only the first `MAX_ACCOUNTS` (50) writers are admitted. Own Anthropic keys are stored encrypted with `KEY_ENCRYPTION_SECRET` and never sent back to the browser. `ADMIN_EMAILS` are exempt from every limit below.
- **Paying for parses:** the site runs at cost. Each writer gets `FREE_PARSES` (2), then parses draw down a prepaid balance by what they actually cost (tokens at Anthropic's price for the model, times `USAGE_MARKUP`, default 1), then fall back to the writer's own Anthropic key. A parse costs about 2 to 20 cents on `claude-opus-5-5`. Writers add money through Stripe Checkout (`server/billing.ts`) for any amount from $1 to $100, once or monthly; Stripe's card fee (2.9% + 30¢) comes out of what is credited. A separate $7 "ream of paper" donation adds nothing to the balance. The webhook at `/stripe/webhook` checks Stripe's signature, applies each event once, and gives the event back if applying fails so Stripe's retry lands; monthly payments are credited from each paid invoice. Blurts are capped at about 5 pages (14,000 characters) because the parser copies every word back and a longer blurt would outrun one response's output ceiling.
- **Writing:** still files, one folder per writer at `$SCRATCH_DATA/u/<clerk user id>/`, on a Railway volume.
- **Limits:** 600 requests a minute per address, 300 per writer, 6 parses a minute and 100 a day per writer, 60 uploads and 60 new documents an hour.
- **Readwise:** each writer adds their own token on the account page. It's checked with Readwise, stored encrypted like their Anthropic key, and only ever used for their own highlights; the server's `READWISE_TOKEN` is never used when hosted.

`npm run build` then `npm start` runs the production server. It refuses to start without `CLERK_SECRET_KEY` and `DATABASE_URL`.

## Keys

Keys live in `.env`, which is gitignored. Start from the template:

```bash
cp .env.example .env
```

- `ANTHROPIC_API_KEY` is required for the parser. Get one at https://console.anthropic.com/settings/keys.
- `READWISE_TOKEN` is optional and is used for importing Readwise highlights. Get it at https://readwise.io/access_token while logged in to Readwise. One token covers both the Readwise highlights API (v2) and the Reader API (v3).

Check that the Readwise token works and that search is reachable:

```bash
npm run check:readwise
```

Never paste a key into `.env.example`, an issue, or a commit. If a key leaks, revoke it and make a new one: Anthropic keys at the console link above, Readwise tokens at the access-token page.

## Tests

```bash
npm test
```

Vitest runs the suite in under a second, and CI runs it with the typecheck on every PR. Tests never call the Anthropic or Readwise APIs, and they never touch `projects/`. The parser runs offline or as a stand-in, Readwise answers come from recorded responses, and each test file writes to its own temporary folder (`SCRATCH_DATA`). Most tests guard a rule from `CLAUDE.md`: cuts are verbatim, labels stay within limits, every change is logged with its author, sourced is not verified, and keys never reach the repo. `npm run test:watch` reruns tests on save. `npm run audit:parse` runs the CAD talk fixture through the real parser (one API call) and reports how it clustered; use it to compare prompt changes.

## Stack, drop-in wherever possible

| Piece | Tool |
|---|---|
| App | Vite + React + TypeScript, served by a small Express server that holds the key and writes files |
| Parser | Anthropic SDK, `claude-opus-5-5` at low effort, structured output via Zod, server-side refusal fallback on. `npm run compare:parse` benchmarks other models and effort levels |
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
