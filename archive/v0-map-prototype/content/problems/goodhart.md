---
id: goodhart
title: Goodhart's law
type: concept
statement: When a measure becomes a target, it stops being a good measure.
value: 3
uncertainty: 1
lenses:
  ml: 1
  economics: 0.9
  operations: 0.5
  narrative: 0.4
restate:
  ml: Every leaderboard, holdout, and scoring function is eventually optimized against. The defense is rigor: hidden holdouts you never look at, and re-checking the score itself.
  economics: Any price list gets gamed by the people it prices.
source: Platt interview, paraphrased.
---
## In this neighborhood
- The Kaggle half-pixel exploit [[detect-satellite]].
- ERA's search finding holes in a scoring function, forcing the humans to fix the score [[scorable-task]].
- Avoided-contrail counts versus avoided forcing [[ranking-metric]].

## Per Platt
The relentless search makes this worse, not better. You now have to be more careful, not less.
