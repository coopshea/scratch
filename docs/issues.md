# Issues

Open work, newest first. Delete an item when it ships; git history keeps the record.

## Open

### Readwise import: claims and evidence from annotated sources
**Added:** 2026-09-26 · **Priority:** high, this is the main input path

Cooper reads and annotates in Readwise, using the web clipper and Reader. A highlight is the source's own words. An annotation on a highlight is Cooper's own thinking about it. Both belong in the tool, and the tool is a helper to that reading process, not a replacement for it.

Proposed mapping:
- **Highlight text** becomes an `evidence` unit. The text is verbatim from the source, so it keeps the "cut, never reword" rule for free. It carries the author, title, and URL as its source.
- **Annotation (note on a highlight)** is treated as a blurt and parsed like one, so it becomes claims, questions, and objections in Cooper's words. Each unit parsed from an annotation gets the highlight as its evidence, linked by `home`.
- **Tags** on a highlight become suggested concept labels, reusing the controlled vocabulary.
- **Import scope** is per document in the drafting tool: pick which Readwise books or articles to pull, then re-sync for new highlights only.

Open questions:
- [OPEN] Does an imported highlight count as "source checked"? It is exact text from the source, but the source itself is unvetted. Proposal: mark it `sourced` rather than `verified`, and keep verification a human act.
- [OPEN] Endpoints. Readwise publishes a highlights export API and a separate Reader API. Confirm the current endpoints, authentication, and incremental-sync parameters against the official docs before building. Nothing here has been checked against the live docs yet.
- [OPEN] Token storage: `READWISE_TOKEN` in `.env`, gitignored, same as the Anthropic key.

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
