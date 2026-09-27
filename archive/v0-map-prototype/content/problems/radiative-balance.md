---
id: radiative-balance
title: Net forcing, longwave trapping vs shortwave reflection
type: subproblem
statement: A contrail reflects some sunlight by day but absorbs and re-emits outgoing infrared all day and all night. Which effect wins, and by how much?
value: 4
uncertainty: 3
lenses:
  physics: 1
  ml: 0.5
  economics: 0.3
  narrative: 0.7
restate:
  physics: Earth radiates as a blackbody near 300 K, peaking around 10 microns. Contrail cirrus has very low albedo there, so it absorbs outgoing infrared and re-emits it in both directions. What is the net of that against daytime reflection of sunlight?
  ml: Two effects, one observable. How do you separate the longwave and shortwave contributions from satellite radiances?
  narrative: The contrail is a blanket at night and a parasol by day. The blanket is on 24 hours; the parasol only when the sun is up.
edges:
  - to: night-vs-day
    type: decomposes-into
  - to: ice-microphysics
    type: requires
  - to: counterfactual-forcing
    type: requires
source: Platt interview, paraphrased. Values unverified.
---
## What is known
Per Platt: contrails are thin white clouds that reflect sunlight by day, and are nearly black at the 10 micron wavelengths where Earth radiates, so they trap outgoing heat around the clock. Net effect is warming.

## How you would know you made progress
A per-contrail estimate of net forcing with error bars, validated against injected synthetic contrails where the truth is known by construction. That is the [[counterfactual-forcing]] problem.

## Simple baseline
Assume every persistent contrail is net warming, weighted by lifetime. Wrong for polar summer and for some daytime cases [[night-vs-day]], but a usable first cut.

## Predict vs understand
The longwave side is well understood. The shortwave side depends on crystal habit and how the contrail spreads, which is [[ice-microphysics]] and is not.
