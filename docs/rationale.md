# Scratch — rationale for agents

Why Scratch is shaped the way it is. Read this before changing behavior. `docs/issues.md` is the open work. Earlier plans and the first prototype are in git history.

Last updated 2026-09-27, after the first build session with Cooper.

---

## What it is, and who it is for

Scratch is a local tool for getting from a brain dump to a human-written draft, then editing it. Cooper is the user. He reads and annotates in Readwise, thinks out loud (often by dictation), and writes essays, including worked technical pieces and opinion pieces. Scratch is a helper to that process, not a replacement for it.

Three stages, as tabs, not doors:

1. **Talk.** Blurt freely. A parser cuts the blurt into typed units in Cooper's own words, each with a 3–6 word concept label. Units cluster around claims in a force graph.
2. **Structure.** The same graph laid over an outline's levels. Dragging a cluster onto a level locks it there. This turns nonlinear thinking into a linear outline.
3. **Draft.** An outline column beside a plain markdown page, aligned row by row, so there is never a blank page.

## How it got here

It started as a public "map of open problems worth solving" with disciplinary lenses (physics, economics, narrative) that restyled a problem graph. It was prompted by a John Platt interview on AI for science: turning a problem into something scorable, ranking by optimistic bounds, the gap between understanding and predicting, taste versus rigor. It is in git history.

It pivoted because a map is a destination. Nobody returns to a graph. People return to a problem they are stuck on and a place to write about it. The useful product is the path from capture to structure to draft. Any map of problems should emerge later from the units and vocabulary that writing leaves behind.

## Units

Every unit has exactly one type. The parser assigns it; the writer can change it.

| Type | What it is |
|---|---|
| claim | Something asserted that could be wrong. Claims are cluster roots. |
| evidence | A data point, result, citation, or source. |
| story | An anecdote or concrete example. |
| question | Something not yet known. |
| objection | A case against a claim, including the writer's own doubts. |
| concept | A term that needs defining. |
| coinage | A phrase, analogy, or acronym the writer wants to stick. It carries a prior-art field: who named something similar first. Citing an established idea beats inventing a grand new name. |
| artifact | A figure, code block, or demo, described now and built later. |

Every non-claim unit belongs to one claim or is loose. Units are cut, never deleted; cuts stay in history.

---

## Principles, most important first

**1. The writer writes.** The model never writes prose into the draft. It parses, suggests stubs with empty bodies, and flags. Spelling and typos are its only edits to the draft. The reasons: the voice has to be Cooper's, the writing is the thinking, and he has to trust the tool enough to keep blurting into it.

**2. Cut, never paraphrase.** Parsed units are verbatim slices of the blurt. The server finds each slice in the raw text and flags anything the model reworded. Only the label is abstracted: "law of the minimum", not a summary of the sentence.

**3. Get out of the writer's way.** Keep the features minimal and the clicks few. Scratch is basically a markdown editor with just enough around it. When the writer puts something somewhere, it goes there. Structure rules may mark and suggest, but they never block. This was learned the hard way: the first version had rigid type rules per level and single-item slots. Cooper hit them immediately ("it won't let me") and asked for them to go. Now an off-type item gets a faint dotted outline and a hover note, and nothing is refused.

**4. If it isn't clear from using it, it isn't clear.** No helper copy, no instructions on screen, no legends, no counts or commentary. Cooper removed "Fix types, labels, and homes. The words are yours and stay as written" and the color legend on sight. Put meaning in the design (cards you can pick up, a tag's colour and mark), not in sentences. The one exception, from 2026-09-28: each empty space says in one short blue line what goes there, and the line goes once the space has something in it ("Braindump here.", "Drag an idea here to start."). New writers couldn't tell what to do; tours and pop-ups are still out.

**5. Everything stays readable.** Text never shrinks below a readable floor. The Talk map fills the pane when it can; when even the floor overflows, the map pans (drag the background, or scroll) rather than shrinking. This replaced the earlier "no infinite canvas" rule on 2026-09-28, because with ten times the clusters, fitting everything meant unreadable text. Selecting a node never moves the view; it dims the rest and opens the note beside the map. No two nodes ever overlap.

**6. Honest provenance.** Every mutation goes through the server and is appended to `events.jsonl` with its author: `human`, `model`, or `system`. Automatic moves are logged as `system`, so history never credits Cooper with something the tool did. History is read-only replay with no restore button. Cut things disappear from the working view but stay in history. Model-origin units are `origin: model, verified: false` until Cooper fills and verifies them. Evidence found after a position was taken should be labeled as such (not built yet).

**7. Local and private.** Cooper's writing lives in `projects/`, which is gitignored. The public repo is code and docs only. The API key is in `.env`, also gitignored.

**8. Drop-in libraries over hand-built primitives.** d3-force for layout, BlockNote for rich-text notes, CodeMirror 6 for the draft, Downshift for the combobox, the official Anthropic SDK for the parser. Point out when an existing tool already does what is asked (Heptabase, Gingko Writer, Obsidian Canvas, and Scrivener each overlap one stage).

**9. The look: the design system.** Since 2026-09-28 the app follows the Scratch design system (https://claude.ai/artifact/X3VzMr8pquZKpoMbRn42ew; screens at https://claude.ai/artifact/9gVUYbkUAGBKhKj7ZKqt29). The sepia notebook is only its loose inspiration. Its rules: things you can move are white cards with a slight shadow, on a warm grey desk; pages you write on are flat. The writer's words are Newsreader (serif); the interface is Hanken Grotesk; blue pencil means Scratch talking (hints, where a drop lands, focus), never the writer's material. Only questions and objections get their own colour, on the type tag. The stages are a 1 › 2 › 3 rail with the current one filled: a toggle you can flip either way. Tokens live at the top of `src/styles.css`. A copy of the system's files (rules, `tokens.json`, each component's guidelines and preview) is in `docs/design-system/`. Less is more.

---

## Decisions, and the reasons behind them

### Talk
- **Cluster cards in masonry, not a force graph (2026-09-28).** Where a cluster sat relative to other clusters meant nothing: the physics only pushed clusters apart, and it cost jiggle, drift and dead space (the blob rarely matched the pane, so text shrank). Now each cluster is a card (root on top, pieces flowing beneath), packed into masonry columns chosen to fill the pane at the largest scale. Lone roots and loose pieces are a muted column on the right. Unfolding a card (+N) keeps the columns and scale, so only cards below it move. React Flow was rejected earlier for the same reason: it zoomed to a node and lost everything else.
- **Controlled vocabulary.** The parser must reuse an existing label when a unit expresses the same concept. Labels are the join key for clustering and for the future map. They are limited to 6 words and 40 characters, enforced on the server.
- **One home, many references.** A non-claim unit belongs to one claim or is loose. The same idea can be placed in several sections of the draft by reference.
- **No review step (2026-09-28).** Parsed units land as accepted, straight into the map. The structure is only a trace and is allowed to be wrong. The writer corrects it by dragging in Structure, and how clusters get stretched there shows where the parse was wrong. Those moves are already in `events.jsonl`, which is the data for tuning the parser later. An approve/reject list, and a keyboard review mode to speed it up, were designed and dropped as friction.
- **Clusters: roots plus four, one level deep (2026-09-28).** Claims and questions are the guiding primitives. One that belongs to nothing is a root, and any piece can sit under it, including a supporting claim or a sub-question. A piece under a root never holds pieces itself; if the parser nests deeper, the server moves the piece up to the root. The map shows each root plus at most 4 pieces, chosen by a rule, not by quality: one of each type first, then blurt order. The rest collapse to dots, and hovering the cluster lists them above the root. Borrowed from affinity diagrams (KJ: groups are found, headed by a short phrase), IBIS (questions as roots), Minto (a handful of groups, each summarized by the idea above it) and Toulmin (claim, grounds, rebuttal). The four comes from working memory (Cowan 2001, about four chunks). The aim is a cluster readable at a glance. Deciding where each piece really goes happens by dragging in Structure, which still shows every piece.
- **The parser prefers fewer, broader roots,** about 3 to 7 threads for a page of notes. `npm run audit:parse` measures the result on the CAD talk fixture. The old prompt gave 19 roots, most of them alone; the new one gave 7, most gathering six pieces, with 19 of 27 pieces joining a root farther away than the nearest one (association by meaning, not by position).
- **Parser model: Claude Opus 5.5 at low effort (2026-09-28).** Measured with `npm run compare:parse` on the CAD talk, two runs each. Opus 5.5 low: about 24 seconds, 6 to 7 roots, every root gathering pieces, nothing loose, nothing reworded. Higher effort doubled the time without better clusters. Haiku 4.5 was no faster (about 26 seconds) and lumped unrelated ideas together. Sonnet 5 at low duplicated roots and left more loose. Parse time is mostly writing the answer (every cut is copied out verbatim, about 2,000 to 3,000 tokens), not reasoning, which is under about 1,000 tokens at low effort. Fast mode costs twice as much and is not worth it here.
- **The note editor takes focus on open,** and the blurt box takes it back on close. Cooper dictates, so the cursor must already be blinking where text should land.

### Structure (page 2)
- **The same graph as page 1,** with full-width levels drawn as dashed dividers and level names at far left. Clusters sit *between* the dividers, not on them. This matches Cooper's sketch. A card-and-tray version was built first and replaced.
- **Locking.** Drop a cluster on the left half of a level and it locks there, full ink, pulled left. Loose clusters float on the right, faint. Drop on the right half to release.
- **Stretched clusters are fine.** A unit pulled out of its cluster onto another level keeps a faint dotted thread back to its claim. Cooper wants these kept visible and weak. Do not hide them. Edge repulsion was considered and rejected, because it fights the locks and would make pinned items jitter.
- **Levels grow** to fit what is placed in them. Placed claims pin to the top of their level so their children stack below.
- **Outlines.** Paper, persuasive, and teaching are templates. The first edit to a built-in saves the writer's own copy ("my paper") with every placement carried over. The "+" under the level names opens an editable combobox: type to filter, Tab takes the top match, Enter keeps exactly what was typed. Common levels number themselves (argument 4). Don't subdivide levels further; an argument level holding its claim, evidence, and objections is already the subitem structure. Custom outlines are stored in `projects/_archetypes.json`, shared across documents.
- **Support marks on claims** are mechanical, never a model's opinion: ○ no evidence, ◐ evidence not checked or no objection, ● checked evidence plus an objection.

- **Structure uses the same cards (2026-09-28).** The loose pool on the right is two masonry columns of cluster cards; the placed rows on the left keep one line per cluster and wrap before the pool.

### Draft (page 3)
- **Starts blank (2026-09-28).** The outline sits at the left with its ideas as tiles you can open (your words) and reorder; the editor on the right has only the dividers and one hint: open an idea on the left, then write. Two other approaches were drawn and set aside: filling each section with the ideas' own spill words as grey scaffolding (worth trying later with a local model, "Jev", to tell which parts are used), and a Notion-style single column where you write under each idea tile (ruled out for now; Cooper wants a designer's view first).
- **Aligned rows plus cursor follow.** The draft holds `<!--s:lane-->` section markers, rendered as dashed rules across both columns. Each outline section sits level with its text, and whichever side is shorter gets a spacer. The section holding the cursor is highlighted. This comes from the sketch, where the divider under "hook" crosses into the editor.
- **Anchors are HTML comments too** (`<!--u:id-->`). They render as quiet chips, and exported markdown stays clean.
- **The writer's placement wins.** Placing an idea in a section, by drag or double-click, moves it there with no type or slot rules. A local keyword match flags ideas mentioned by name but not placed, and offers "move here". A model or small local model for paraphrase detection is a later option (see issues). It should only ever suggest.
- **No unplaced pile in Draft.** Out-of-bounds material stays in Structure.
- **Strikethrough on use, highlight on callback, hover to find.** These run off explicit anchors, never inferred links. Loose semantic linking was too fuzzy in Cooper's past tools.

### Later: the red pen
- **Evidence, spelling and attribution checks come later,** as one button that reviews the whole draft on click. Gaps are written in square brackets: `[GE9X test hours]`. That is the only place Readwise should touch the draft. Until then, the core is input, structure, then writing. Details are in the issues doc.

### Export
- **Clean markdown for a reader.** Section markers drop out. Evidence placed in the text becomes numbered footnotes quoting it. Figures still to make become `*[Figure: …]*`. Other chips disappear, leaving only prose.

### Name
- **"Scratch"** began as the default document's slug and became the product name.

---

## Staying out of the rabbit hole

Cooper's failure mode is researching instead of writing. The tool should make writing the default:

- **Drafting has no research in it.** A gap becomes a placeholder and the writing continues.
- **State the prior before searching:** what would change the writer's mind.
- **Research is one budgeted pass after the first draft.** Claims still unsupported after the budget become objections or get cut.
- **Describe figures now, build them later.**
- **v1 is done when every section has prose,** whatever the support marks say.

Motivated reasoning (taking a position, then finding evidence) is allowed because it gets writing done. It should be visible, not blocked. The placeholders, the prior field, and the post-hoc evidence label are open issues.

---

## Working with Cooper

- **Direction by use.** He tries the tool, reacts, and sometimes sends a sketch. Build what he describes, verify it in the browser, and report plainly.
- **"Brainstorm with me" means options plus a recommendation, not a build.** Wait for his pick on anything that changes how the tool feels.
- **Back to basics (2026-09-28):** talk and get a trace of structure, fix it in Structure, write. Resist designing edge cases. Evidence, spelling and similar checks come later.
- **Readwise is the main input path.** The server side exists. Pulling annotations into Talk is the likely first UI.
- **Git.** Commit and push only when asked. The repo is public: `github.com/coopshea/scratch`.
- **Previews.** Never leave the offline stand-in parser running for him; it looks like a broken parser.

## Technical gotchas that cost time

- **Hidden tabs pause `requestAnimationFrame`.** The preview pane is often in the background. Any layout that only moves on animation frames renders as nothing. Both graphs run a synchronous up-front layout (tick the simulation directly) on first view and on resize.
- **d3 tick handlers are created once.** They must read geometry from refs, not from closed-over React state, or they keep using the first render's sizes.
- **React runs layout effects before normal effects.** Anything the first layout effect needs, such as the simulation, must be created in an earlier layout effect.
- **CodeMirror refuses dispatch inside its measure pass.** Defer with `queueMicrotask`. Block widgets must come from a `StateField`, not a view plugin.
- **The overlap resolver respects per-axis pins** (`fx` and `fy`). Page 2 alternates region clamping with overlap passes, then stacks leftovers downward within each region. The generic push can shove nodes out of a level.
- **Server changes need a restart.** `tsx` is not watching. Vite hot-reloads the client only.
- **Preview screenshots in the small pane sometimes show a half-painted frame.** Trust DOM measurements over the image.
