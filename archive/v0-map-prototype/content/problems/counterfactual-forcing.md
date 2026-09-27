---
id: counterfactual-forcing
title: Forcing relative to the world without the contrail
type: subproblem
statement: You can measure outgoing radiation where a contrail is. You cannot measure what it would have been without the contrail. Estimating that difference is the whole game.
value: 5
uncertainty: 3
lenses:
  ml: 1
  physics: 0.7
  economics: 0.5
  narrative: 0.4
restate:
  ml: A causal inference problem with confounders in weather, surface, and background cloud. Validate on synthetic contrails injected into real scenes, where the truth is known by construction.
  physics: The longwave counterfactual is tractable. The shortwave one depends on sun angle, surface albedo, and crystal habit, and stayed unsolved for two years.
  economics: Without this number you cannot price a contrail, so you cannot decide which ones are worth fuel to avoid.
edges:
  - to: scorable-task
    type: instance-of
  - to: descriptive-vs-predictive
    type: instance-of
source: Platt interview, paraphrased.
---
## What is known
Per Platt: the team had a working longwave counterfactual model but was stuck on the shortwave one for two years. Their internal tests injected artificial contrails into real data so the true effect was known. Their own models failed those tests. The ERA search found a simple model with a combination of confounders they had not tried, and it passed. In retrospect the model was small and sane.

## How you would know you made progress
Error on injected synthetic contrails, on scenes held out from every iteration of the search. Platt's warning applies: with a relentless search you need hidden holdouts you never look at.

## Simple baseline
Nearest clear-sky pixel at the same time, differenced. Biased by everything that made the contrail form there in the first place.

## Predict vs understand
A model that fits the observed radiances is predictive. One that gets the injected-contrail test right without having seen it is closer to descriptive, because it has to carry the mechanism [[descriptive-vs-predictive]].
