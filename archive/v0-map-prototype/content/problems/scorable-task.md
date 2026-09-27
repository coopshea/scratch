---
id: scorable-task
title: Map the problem to a scorable task
type: concept
statement: A large share of science can be phrased as "I want a piece of code that maximizes this score." Writing the score is the creative act. The search is mechanical.
value: 4
uncertainty: 2
lenses:
  ml: 1
  physics: 0.4
  economics: 0.3
  narrative: 0.5
restate:
  ml: Given a textual description plus a scoring function, a tree search over candidate notebooks, expanded by an LLM and selected by upper confidence bound, finds a good program. The human writes and repairs the score.
  narrative: The scientist stops writing CSV importers and starts arguing about what "better" means.
source: Platt interview, paraphrased.
---
## Per Platt
ERA keeps hundreds of candidate notebooks in a tree, picks by an optimistic bound rather than the best score, grows about ten leaves at a time so the search can learn from its own history, and occasionally recombines two candidates. The scoring function usually needs several rounds of repair because the search finds ways to cheat it. Scientists using it end up spending their time on what the cost function means, which he calls the essence of the scientific problem.

## Why this node is in a contrails map
Because [[counterfactual-forcing]] was solved by exactly this move. And because this site is built on the bet that the same move works for problems that are not code.
