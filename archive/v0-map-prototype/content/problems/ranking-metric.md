---
id: ranking-metric
title: Which contrails to avoid, and the ranking metric
type: subproblem
statement: There is not enough fuel budget or controller patience to avoid every contrail. Rank them. Then watch the ranking get gamed.
value: 4
uncertainty: 3
lenses:
  ml: 0.9
  economics: 0.9
  operations: 0.8
  physics: 0.4
  narrative: 0.4
restate:
  ml: The score is expected avoided forcing per unit fuel, with uncertainty. Rank by an optimistic bound, not the point estimate, so the program keeps learning where it is unsure.
  economics: This is the price list. Every airline will optimize against it, so it must be robust to that.
  operations: A ranking is only useful if it can become a rule a dispatcher applies in thirty seconds.
edges:
  - to: counterfactual-forcing
    type: requires
  - to: night-vs-day
    type: requires
  - to: goodhart
    type: instance-of
source: Platt interview for the Goodhart and UCB points, paraphrased. The ranking framing is Cooper's.
---
## Why it is hard
Per Platt: any metric that becomes a target stops being a good metric. Once avoidance is rewarded, the reported numbers drift toward whatever is rewarded. The defense is layered: a hidden validation set, periodic re-estimation of the counterfactual, and a rule that only counts confident cases.

## Simple baseline
Night flights through high-confidence regions first, ranked by predicted contrail lifetime. Everything else waits.

## Borrowed from ERA
Platt's search picks the candidate with the highest upper confidence bound, sometimes the fifth best on point estimate, because that is where progress is most likely. A reroute program can do the same: spend some fuel on uncertain cases specifically to learn.
