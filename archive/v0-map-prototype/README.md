# Open Problems

A map of open problems worth solving, built as a writing tool first and a community tool second.

Started 2026-09-23. Personal project of Cooper Shea. Not affiliated with JAS Surgical or any other employer.

## What it is

A problem is a microscope slide. The map shows its neighborhood: the sub-problems it decomposes into, what it requires, what it is analogous to, and the concepts it is an instance of. A **lens** (physics, statistics & ML, economics, operations, narrative) restates every node from that discipline's point of view and pulls the relevant part of the neighborhood into focus, the way an optometrist swaps lenses. An **essay** is a markdown file that links nodes; opening it superimposes its path on the map.

The bet: to solve a hard problem you have to get into its neighborhood and wander, the way Wiles lived in modular forms for years before Fermat fell. The tool exists to make neighborhoods explicit and to make wandering produce writing.

## Working thesis

1. **The problem page is the product.** The graph is navigation. Nobody returns to a graph. They return to a problem they are obsessed with and a place to write about it.
2. **A lens is a restatement, not a filter.** Same problem, different question. Physics asks about mechanism. Economics asks who pays. Narrative asks for the sentence that makes a stranger care.
3. **Every problem page carries five fields**, borrowed from how John Platt describes AI-for-science work: the statement; how you would know you made progress (the scoring function); the simplest baseline; the ways the metric gets gamed; what we can predict versus what we understand.
4. **"Worth wandering" ranks by an optimistic bound**, value plus uncertainty, the way ERA's tree search picks candidates. High value and unexplored beats high value and crowded.
5. **Neighborhoods, not the world.** Two hops from the focused node stay lit. Typed edges only. A model may propose decompositions; a human ratifies them.
6. **Hike mode** folds the answers (baseline, scoring function, known facts) so you can work a node yourself before reading what is known. Platt: hike up the mountain sometimes, even when you can drive.

See [docs/design-notes.md](docs/design-notes.md) for the reasoning and the open questions.

## Run it

```bash
node scripts/build.mjs
```

```bash
python3 -m http.server 8765 --directory site
```

Then open http://localhost:8765. Rebuild after editing anything in `content/`. No dependencies beyond Node and Python; d3 and marked load from a CDN.

## Layout

```
content/
  lenses/*.md      one file per lens: id, name, color, order, question, body
  problems/*.md    one file per node (problem, subproblem, or concept)
  essays/*.md      markdown essays that link nodes with [[node-id]] or [[node-id|link text]]
scripts/build.mjs  compiles content/ into site/data.json (zero dependencies)
site/              static app: index.html, style.css, app.js, data.json
docs/              design notes
```

## Content schema

Node frontmatter:

```yaml
---
id: issr                       # unique, used in edges and [[links]]
title: Find the ice-supersaturated regions
type: subproblem               # problem | subproblem | concept
statement: One or two sentences. Shown when no lens is active.
value: 5                       # 1-5, value if solved
uncertainty: 3                 # 1-5, how unknown the path to solving it is
lenses:                        # 0-1 per lens; how much this node matters under that lens
  physics: 0.9
  ml: 0.9
restate:                       # the same problem, asked from that discipline
  physics: What controls the persistence, thickness, and extent of the layer?
  ml: Can satellite detections plus persistence map the layers the weather model misses?
edges:
  - to: detect-satellite
    type: requires             # decomposes-into | requires | analogous-to | instance-of | blocks
source: Where this came from, and whether it is verified.
---
## What is known
## How you would know you made progress
## Simple baseline
## Ways the metric gets gamed
## Predict vs understand
## Open questions
```

Body sections are free-form markdown. The headings above are the convention; hike mode folds the ones that give away answers. `[[node-id]]` anywhere in a body becomes a link.

Essay frontmatter: `id`, `title`, `author`, `date`, `lens` (which lens colors the overlay), `summary`. The essay's path is the order in which `[[links]]` appear in the text.

## Keyboard

`1`–`5` switch lens, `0` all lenses, `Esc` clears focus or closes an essay overlay, shift-click or shift-number combines two lenses.

## Status

Prototype, seeded with one neighborhood: persistent contrails, decomposed from the John Platt interview on Latent Space Science. Every factual claim in the seed content is paraphrased from that transcript and unverified. The sample essays are placeholders to exercise the overlay, not finished writing.

## Next

- A second neighborhood that is not from a single source, to see whether the schema holds.
- Combined-lens surfacing: the nodes both lenses see are candidate cross-disciplinary essay topics. Make that a list, not just a visual.
- LLM-proposed decompositions with a ratify step, so the graph grows from writing.
- A neighborhood radius control and a search box once there is more than one neighborhood.
- Community layer (accounts, essays by others, comments on nodes) only after the writing habit holds for one person.
