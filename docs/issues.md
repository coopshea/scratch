# Issues

Open work, newest first. Delete an item when it ships; git history keeps the record.

## Open

### Words the interface still needs to settle
**Added:** 2026-09-28

The guidance itself shipped with the design system (one blue hint per empty space, gone once it fills). Still open:

- **Headline for the welcome page:** "Detangle Your Brain" is live. Others considered: "From Tangle to Thread", "Untangle What You Think", "Pull the Thread", "Mess In, Draft Out", "A third hand for your brain".
- **The lead under it:** "Scratch turns loose thoughts into pieces you can move around, so going from idea to draft is quick." Cooper: better than earlier tries, not great.
- **Parse button:** "Parse writing" at rest (plain, not loved); the playful words (rummaging…, panning for gold…) only turn over while it works. Money uses credits, never "cut" or "parse".
- **Credit size:** one credit is 8¢ of model time (about one run of Spill; long spills use 2 or 3), with Stripe's fee priced in, so $5 buys credits, not "$4.55". Explained only on the account page.
- **Kept for later:** Dump → Sort → Write; Gather → Arrange → Write; Brainstorm → Outline → Write; "blurt" and "word vomit".

### Draft: scaffolding from your own words
**Added:** 2026-09-28 · **Priority:** later

Pre-fill each empty section with the spill fragments behind its ideas, as grey blocks the writer writes over and that never export. Cooper worries it's too much on screen. Worth another look with a small local model ("Jev") that can tell, as you type, which fragments and ideas you've covered, so they cross off without a paid model call. The existing keyword match already crosses off ideas mentioned by name.

### Red pen: one review pass over the draft
**Added:** 2026-09-28 · **Priority:** later, after the core loop feels right

One button reviews the whole draft on click. Typos are fixed. A `[gap]` or an unsourced factual sentence gets a match from Readwise that can be accepted as a footnote. Factual claims with no match, and wording close to an uncited source, are flagged. There are no fallacy or logic flags. It uses rules where possible and one model call per pass. When there's something to accept, keep the interaction to the fewest possible keys, with no separate review mode.

### Readwise import: suggested reading, pulled in as sourced units
**Added:** 2026-09-26 · **Design settled:** 2026-09-27 · **Priority:** high, this is the main input path

Cooper reads and annotates in Readwise. A highlight is the source's words, and a note on it is his thinking. Finding sources is cataloging, which the tool should do. Choosing which ones matter is judgment, and that stays with the writer.

**What the writer sees.** There's no search panel. One line in Talk suggests up to 7 articles from his reading, ranked against the current document. Each row shows the note of his that matched, so he can see why it's listed. He types `1 2 4` (or clicks) and they're pulled in. On a blank page the document title is the query. As he works, his top claim labels join it.

**What pulling does.** A highlight becomes an `evidence` unit: verbatim, carrying title, author and URL, and marked `sourced`. A note becomes a blurt with its highlight attached as evidence, and goes through the existing parser. That's one call per article, and junk notes produce nothing. Everything goes through the server and `events.jsonl`.

**Design.**
- **Search uses the source's own search.** Readwise already runs a hybrid of vector and full-text search, so we don't run embeddings. In a test, "gas turbines" put *Why Jet Engines Aren't Made in China* first with no shared words.
- **One module per source,** with a source-neutral shape:
  - `search(query) → hits`
  - `recent() → docs`, the fallback
  - `pull(docIds) → docs`, each with its passages (the source's text) and notes (the writer's text)

  `server/readwise.ts` is the only file that knows Readwise exists. Don't build a registry or a dispatcher until a second source exists.
- **Readwise specifics:**
  - Search: `readwise_search_highlights` on the MCP server at `https://mcp2.readwise.io/mcp`, called through `@modelcontextprotocol/sdk`.
  - Pull and sync: REST `GET /api/v2/export/`, which is versioned and stable, returns whole articles, and has a deleted flag.
  - Auth: both use `READWISE_TOKEN` with the header `Authorization: Token <token>`, not `Bearer`. The official `@readwise/cli` is only a wrapper around the MCP server, so we don't use it.
- **Fail soft.** If the search tool is missing or renamed, the line shows the most recently annotated articles instead. With no token, the line never appears.
- **Search sparingly.** Search only when the title changes or a new claim appears, and cache results. Readwise publishes no rate limit for search. Export is 20/min, and one call covers a whole library.
- **Re-pull is incremental.** Keep a map from highlight id to unit id, so a re-pull adds only new highlights. A note edited in Readwise after import flags the unit and never overwrites it. A deletion in Readwise flags the unit and never removes it.

**Status (2026-09-30):** Built. Spill has "pull relevant from Readwise" once something is parsed: each thread (root) is searched on its own, and only passages Readwise ranks near the top by both meaning and words (fused score ≥ 0.02) are offered, at most 3 a thread and 10 in all, listed under the thread that found them. Nothing comes in until the writer picks one (click or 1–9); Cooper asked for this after the unreviewed pull brought in random material. With an idea open in any stage, ⌘⇧E lists 5 related passages; 1–5 files one under that idea's thread. A passage comes in as one idea: the writer's note is its text (their words, where their writing goes), the highlight is `source.quote`, shown below as a yellow highlight so it never reads as theirs, with its title linked under it. There is no "checked" row for these: the linked highlight is the citation. Nothing is parsed, so pulling costs no credits. Without a token the controls show greyed, and hovering says where to connect. **Open:** labels are the note's first words and read badly; a paraphrase is wanted (see below). **Parked:** the suggestion line and the Draft reading tray.

**Library as of 2026-09-27:** 505 highlights in 70 articles, all from Reader. 95% of highlights have notes, many of them 200+ characters of dictated thinking. Tags are almost unused, so tag-to-concept mapping isn't worth building.

Open questions:
- [DECIDED 2026-09-30] A Readwise passage is `verified: true`: the words and the source came from Readwise, so the citation is real. Cooper's call.
- [OPEN] Relatedness is loose: Readwise's score is a rank, not a distance, so anything in a one-field library comes back. Proposal (a model judge that also writes the label): github.com/coopshea/scratch/issues/20.
- [OPEN] Paraphrase: a short summary label for a pulled note, like the parser's labels. Only the label is abstracted; the note and the highlight stay verbatim.
- [OPEN] Ranking weights: more matching highlights and more of the writer's own notes rank an article higher. Tune these against the real library.

### Other reading sources (Obsidian, Apple Notes)
**Added:** 2026-09-27 · **Priority:** only when someone needs it

Each source gets its own module with the same `search / recent / pull` shape as Readwise. When there are two or more sources, send the query to all of them and merge the ranked lists with reciprocal rank fusion. Scores from different sources aren't comparable, but ranks are. A source with no search of its own, such as a folder of Markdown files, gets a local embedding index built inside its module (`@huggingface/transformers`, a small model, brute-force cosine). That keeps embeddings a detail of the sources that need them, not a global layer.

### Smarter reference detection in Draft
**Added:** 2026-09-26 · **Priority:** later

Draft now moves an idea to a section when it is placed there as a chip, and a local keyword match flags ideas mentioned by name but not placed ("move here"). The keyword match misses paraphrase. Options, in order of cost: better local similarity (stemming, synonyms from the vocabulary); Claude Haiku on the paragraph at the cursor, debounced; later a small local model. Suggestions only, never automatic, and never text written into the draft.

### Draft back to the board
**Added:** 2026-09-27. Select text in the draft and make it a unit (origin: draft), so ideas that appear while writing join the graph.

### Post-hoc evidence label
**Added:** 2026-09-27. Evidence attached to a claim after that claim was placed in the draft is labeled "found after position taken." Information, not an error. The event log already has what is needed.

### Thesis "what would change my mind" field
**Added:** 2026-09-26. The writer's prior, stated before research.

### End-of-draft checks beyond the red pen
**Added:** 2026-09-26. Style lint (rules to be written together), coinage prior-art check, coverage check. All flag only. When built, these become more red pen item types, not separate buttons.

### Suggestion actions
**Added:** 2026-09-26. Find a source, and find a parallel or example. Each produces an empty stub with a headline and one or two links.
