# Issues

Open work, newest first. Delete an item when it ships; git history keeps the record.

## Open

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

**Status (2026-09-27):** The server side is built: `server/readwise.ts`, the `/readwise/status`, `/search` and `/adopt` endpoints, and `npm run check:readwise`. There's no UI yet. Proposed order: frame first (topic, audience, questions), then talk from memory, then opt in to sources, then structure, then draft. Sources come to the writer's claims: each claim is searched in its own words, and one or two candidates appear faintly under it. Nothing is bulk-imported into the map. Next: build that per-claim step, then the Draft reading tray. Labels cut from the first words of a highlight are weak; consider the parser's labeler.

**Library as of 2026-09-27:** 505 highlights in 70 articles, all from Reader. 95% of highlights have notes, many of them 200+ characters of dictated thinking. Tags are almost unused, so tag-to-concept mapping isn't worth building.

Open questions:
- [OPEN] `sourced` vs `verified`. Proposal: imported highlights are `sourced`, and verification stays a human act.
- [OPEN] Ranking weights: more matching highlights and more of the writer's own notes rank an article higher. Tune these against the real library.

### Other reading sources (Obsidian, Apple Notes)
**Added:** 2026-09-27 · **Priority:** only when someone needs it

Each source gets its own module with the same `search / recent / pull` shape as Readwise. When there are two or more sources, send the query to all of them and merge the ranked lists with reciprocal rank fusion. Scores from different sources aren't comparable, but ranks are. A source with no search of its own, such as a folder of Markdown files, gets a local embedding index built inside its module (`@huggingface/transformers`, a small model, brute-force cosine). That keeps embeddings a detail of the sources that need them, not a global layer.

### Smarter reference detection in Draft
**Added:** 2026-09-26 · **Priority:** later

Draft now moves an idea to a section when it is placed there as a chip, and a local keyword match flags ideas mentioned by name but not placed ("move here"). The keyword match misses paraphrase. Options, in order of cost: better local similarity (stemming, synonyms from the vocabulary); Claude Haiku on the paragraph at the cursor, debounced; later a small local model. Suggestions only, never automatic, and never text written into the draft.

### Placeholders while drafting
**Added:** 2026-09-27. Typing `TK` plus a note in the draft creates an evidence stub and keeps the writer writing. `FIG` plus a description creates an artifact stub. Both show as open until filled.

### Draft back to the board
**Added:** 2026-09-27. Select text in the draft and make it a unit (origin: draft), so ideas that appear while writing join the graph.

### Post-hoc evidence label
**Added:** 2026-09-27. Evidence attached to a claim after that claim was placed in the draft is labeled "found after position taken." Information, not an error. The event log already has what is needed.

### Thesis "what would change my mind" field
**Added:** 2026-09-26. The writer's prior, stated before research.

### End-of-draft checks
**Added:** 2026-09-26. Style lint (rules to be written together), coinage prior-art check, coverage check. All flag only.

### Suggestion actions
**Added:** 2026-09-26. Find a source, and find a parallel or example. Each produces an empty stub with a headline and one or two links.
