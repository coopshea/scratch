# Design notes

**Date:** 2026-09-23
**Status:** working notes, first session

## What is actually useful

The concern in the original brief was the combinatorial explosion. Everything connects to everything; a graph of that is noise. The way out is to notice what people come back to. Nobody returns to a graph. Every graph-view feature in note-taking tools gets turned off within a week. People return to one problem they are obsessed with, a place to write about it and be read, and a sense of progress.

So the unit of value is not a node. It is a worked neighborhood: the problem, its sub-problems, what has been tried, why it failed, and where the frontier is. Wiles did not wander the whole map. He lived in one neighborhood for seven years. The engineering-log approach survey with a comparison matrix is already this artifact for a single device. This site is the public, multi-discipline version of that.

Consequences:

- The problem page is the product. The graph is navigation. The lens is a reading mode.
- Do not build the global graph first. Build one problem to full depth with five lenses and a few essays, and see whether anyone wanders.
- Content is markdown files. The writing tool and the map are the same thing. If the map only fills in from writing, it fills in with things someone cared enough to write.

## What the Platt interview gives the design

Not inspiration. Structure.

**The scoring function is the problem.** Platt says the human work is turning a sticky problem into something scorable, and that most iterations go into repairing the score after the search finds a hole. So every problem page carries a field for "how would you know you made progress," plus the known ways that proxy gets gamed. That field is the difference between a wish and a problem.

**Rank by optimism, not by score.** ERA picks the candidate with the highest upper confidence bound, sometimes the fifth best on point estimate, because that is where progress is likely. "Worth wandering" does the same: value plus uncertainty. High value and everyone-already-tried-it is not worth wandering. High value and nobody-has-looked-from-this-angle is.

**Descriptive versus predictive.** Newton's law was about gravity, not apples. A problem page separates what we can predict from what we understand, because the second is what lets you extrapolate to the neighboring problem.

**Always fit linear regression first.** Every problem carries a simple baseline. It is the entry point for a newcomer and the thing the obsessive has to beat.

**Recombination.** ERA occasionally smashes two candidates together. Two lenses applied at once surface the nodes both touch. Those are the cross-disciplinary essay topics.

**Hike even when you can drive.** That is the study tool. Pick a node in your neighborhood, work it without the model, then compare. Hike mode in the prototype folds the answers behind a reveal button.

**Rigor and taste are the two anchors.** Platt's claim about what endures: creativity and philosophy on one side, checking and not fooling yourself on the other. The stated goal of growing people who can do the technical work and also tell the story is the same pair. Essays attached to technical nodes train both at once.

**N-squared integration.** Platt's hope is a tool that reads all the papers and fits the data at once. The site's version: a model proposes decompositions and restatements, a human ratifies. Never let the model write directly to the graph.

## The lens, mechanically

A lens is not a filter. It is a restatement. Contrails under physics is ice supersaturation and absorption at ten microns. Under economics it is who pays the fuel and who gets the local benefit. Under narrative it is "a cheap, local, measurable fix nobody is doing."

Each node carries a weight per lens (how much it matters under that lens) and a restatement per lens (the same problem, asked that way). Switching lenses animates radius and opacity, recolors by dominant lens, and swaps the restatement text. Nodes the lens does not see fade to gray but stay visible, because the point is to notice what the lens hides.

Two lenses at once take the minimum weight, so only nodes both lenses see stay lit.

## Essays on the map

An essay is markdown whose paragraphs link nodes. Opening it draws its path through the graph in order, numbers the nodes, and dims everything else. Hovering a paragraph lights up only the nodes it touches. The reader gets the story and the technical spine at once.

This is also the growth mechanism. Writing an essay that references a node that does not exist yet is the natural prompt to create the node.

## Taming the explosion

- Show one or two hops from the focused node. Never the world.
- Typed edges only: decomposes-into, requires, analogous-to, instance-of, blocks. No "related."
- A lens is a hard cut on what stays lit.
- A model may propose. A human ratifies.
- One neighborhood at a time. Add the second only when the first has essays.

## Open questions

- **Is "value" a property of the node or of the viewer?** A 5 for a climate scientist is a 2 for a mechanical engineer. Probably per-viewer eventually; global for now.
- **Should lens weights be authored or derived?** Authored for now. Could be derived from which lens's restatement exists and how long it is.
- **How do two people's neighborhoods for the same problem merge?** Unsolved. Possibly they do not; possibly the site shows both and the difference is the interesting part.
- **What is the first non-Platt neighborhood?** Something Cooper is already obsessed with, so the writing is real. Candidates: a meniscus repair sub-problem that is safely public, or a Fun-Fit problem, or something from the newsletter reading.
- **Does the phoropter animation earn its cost?** It is the signature interaction. Keep it, but make it fast.

## Things to look at

Existing projects in the same territory, worth a look for what they got right and wrong. None checked this session; treat as a reading list.

- Open Problem Garden (mathematics open problems)
- The Polymath projects (collaborative math on blogs)
- Metaculus (forecasting; the closest thing to a scoring function for open questions)
- Are.na (blocks and channels; a graph people actually return to, because it is a collecting tool first)
- Kaggle (Platt says ERA started as "auto-Kaggle"; the leaderboard is the scoring function)
