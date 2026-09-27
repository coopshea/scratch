---
id: detect-satellite
title: Detect contrails in satellite imagery
type: subproblem
statement: Find every contrail, every few minutes, everywhere, from satellites that were not designed for it.
value: 4
uncertainty: 2
lenses:
  ml: 1
  physics: 0.5
  operations: 0.4
  narrative: 0.3
restate:
  ml: Segmentation on geostationary infrared imagery. Labels are hand-drawn, imperfect, and half a pixel off if you are not careful.
  physics: Contrails are cold linear features in the thermal infrared. The signal is there; the pixels are large.
  operations: Continuous monitoring is what makes a reroute recommendation checkable after the fact.
edges:
  - to: remote-sensing-tradeoff
    type: requires
  - to: goodhart
    type: instance-of
source: Platt interview, paraphrased.
---
## What is known
Per Platt: Google built a continuous monitoring system on weather-satellite imagery with convolutional models. They ran a Kaggle competition on it, and competitors beat the internal model partly by discovering a half-pixel offset in the labels, an artifact of whether pixel (0,0) means the corner or the center, and exploiting it.

## How you would know you made progress
Detection recall on held-out days nobody has looked at, scored against labels made after the model was frozen.

## Ways the metric gets gamed
The half-pixel story is the canonical example. Any leaderboard becomes a target and stops being a measure. Keep a truly hidden holdout [[goodhart]].

## Simple baseline
Threshold the brightness-temperature difference between two infrared bands, then run a line detector.
