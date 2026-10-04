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
- **Paying for parses:** the site runs at cost. Each writer gets `FREE_PARSES` (2), then parses draw down a prepaid balance by what they actually cost (tokens at Anthropic's price for the model, times `USAGE_MARKUP`, default 1), then fall back to the writer's own Anthropic key. A parse costs about 2 to 20 cents on `claude-opus-5-5`. Writers see this as credits (one credit is 8¢ of model time, `CREDIT_MICROS`, about one run of Spill), never dollars. Writers add money through Stripe Checkout (`server/billing.ts`) for any amount from $1 to $100, once or monthly, from the account page or from the out-of-credits notice under the spill, which returns to the document and cuts the spill; Stripe's card fee (2.9% + 30¢) comes out of what is credited. A separate $7 "ream of paper" donation adds nothing to the balance. The webhook at `/stripe/webhook` checks Stripe's signature, applies each event once, and gives the event back if applying fails so Stripe's retry lands; monthly payments are credited from each paid invoice. Blurts are capped at about 5 pages (14,000 characters) because the parser copies every word back and a longer blurt would outrun one response's output ceiling.
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

Vitest runs the suite in under a second, and CI runs it with the typecheck on every PR. Tests never call the Anthropic or Readwise APIs, and they never touch `projects/`. The parser runs offline or as a stand-in, Readwise answers come from recorded responses, and each test file writes to its own temporary folder (`SCRATCH_DATA`). Most tests guard a rule from `CLAUDE.md`: cuts are verbatim, labels stay within limits, every change is logged with its author, model-written evidence is never counted as checked, and keys never reach the repo. `npm run test:watch` reruns tests on save.

`npm run test:e2e` runs the browser flows in `e2e/` with Playwright (Chromium; `npx playwright install chromium` once): spill into cards, drag a cluster onto a level, the draft's outline and chips, and export. It starts its own server on port 5193 with the offline parser, no sign-in and no keys, writing to a temporary folder it deletes afterwards. CI runs it as its own job. `npm run audit:parse` runs the CAD talk fixture through the real parser (one API call) and reports how it clustered; use it to compare prompt changes.

## Stack, drop-in wherever possible

| Piece | Tool |
|---|---|
| App | Vite + React + TypeScript, served by a small Express server that holds the key and writes files |
| Parser | Anthropic SDK, `claude-opus-5-5` at low effort, structured output via Zod, server-side refusal fallback on. `npm run compare:parse` benchmarks other models and effort levels |
| Cluster layout | deterministic: masonry cards in Spill, one line per cluster in Shape; no physics, no infinite canvas |
| Node notes and the draft | BlockNote (rich text, images, slash menu); the draft is one editor per outline section |
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

All three stages work. The stepper at the top reads 1 Spill → 2 Shape → 3 Draft; History, Copy and Export sit at its right.

- **Spill:** blurt (type, paste, or speak), then Parse writing (⌘↵). The parser is `claude-opus-5-5`; it cuts the blurt verbatim into typed ideas with short labels. Each cluster is a card, its root on top and pieces beneath, packed into masonry columns that fill the pane; lone roots and loose pieces get their own muted column at the right. A card shows its root and up to four pieces; the rest fold to dots behind +N. Same content, same layout, every time. Rich-text note per idea in a resizable sheet on the right.
- **Readwise:** with a token, "pull relevant from Readwise" under the spill searches each thread and offers matching passages under the thread that found them; nothing comes in until the writer picks one (click or 1–9). With an idea open in any stage, ⌘⇧E lists 5 related passages; 1–5 files one under that idea's thread. A passage comes in as one idea: the writer's note is its text, the highlight shows as a quote with its source linked. No parse, no credits. Without a token the controls show greyed and say where to connect.
- **Shape:** the outline's levels as rows down the left half, names at far left; Ideas, the loose pool, on the right as the same cluster cards in masonry. Placed rows are laid out, not simulated: each cluster is one line, root at the left, pieces running right and wrapping under the first piece. Drop a cluster on the left half of a level to place it; drop it on the right half to release it. A piece placed away from its root keeps a dotted thread back to it, so clusters can span levels. Any idea can go on any level; one that doesn't match the level's usual type gets a faint dotted outline. Levels grow to fit what's placed in them. Switching outline carries the arrangement over by role; empty required levels are red. Claim support marks: ○ no evidence, ◐ evidence not checked or no objection, ● checked evidence and an objection.
- **Levels, edited in place:** click a level's name to rename it, drag it to reorder, × to remove it (its ideas return to the pool). Hover between levels to insert one; `+` under the last adds one with a combobox (type to filter; Tab takes the top match, Enter keeps what you typed). Common levels number themselves: argument 4, section 2. Built-in outlines are templates, so the first edit saves your own copy ("my paper") with every placement carried over. `+` beside the outline names starts one from a typed list, one level per line; double-click your outline's name to edit or delete it. Stored in `projects/_archetypes.json`, shared across documents.
- **Draft:** outline on the left, page on the right, one row per level, each side as tall as the taller, so they line up. Each section is its own BlockNote editor; arrow keys, undo and a second ⌘A work across sections. The section holding the cursor is highlighted. Click an idea in the outline to open it and its note; press, hold and drag to move it into the text as a chip (double-click does the same at the cursor), or to another section. Placing a chip moves the idea to that section. Chips work both ways: hovering a chip lights its idea in the outline and the reverse; clicking a chip opens the idea. Mentioning an idea by name without placing it offers "move here". Used ideas are struck through; repeat uses show ×N.
- **Export:** `Export` downloads clean markdown; `Copy` puts the same on the clipboard. Section markers drop out, evidence placed in the text becomes numbered footnotes, figures still to make become `*[Figure: …]*`, and other idea chips disappear.
- **Documents:** the panel button at top left opens the list; hidden by default. Each shows its title, when it changed, and its top claim labels. Delete asks twice (× turns into "delete?") and moves the folder to `projects/.trash`; nothing is erased.
- **History:** a slider over every event, read-only, in any stage.
- **Hosted:** a welcome page and Clerk sign-in, then the app; credits in the top bar and an account page for keys, Readwise and payments (see Hosting).
- **Help:** `?` at top right. "Open an example" copies `examples/gas-turbines/` (a sample spill, parsed, shaped and partly drafted; same layout as a project folder) into your own documents as a fresh copy each time, logged as `project.fromExample` by `system`; no parse runs. One more spill waits open in the box: parsed exactly as shipped, it gets the stored result in `example-parse.json` (logged by `system`, no credit); any edit makes it a normal parse. "Keyboard shortcuts" lists the ones that exist.
