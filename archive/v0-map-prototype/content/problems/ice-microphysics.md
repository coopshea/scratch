---
id: ice-microphysics
title: Ice crystal shape and fall speed
type: subproblem
statement: How long a contrail lasts depends on how fast its ice crystals grow, what shape they take, and how fast they fall. None of that is known well.
value: 5
uncertainty: 5
lenses:
  physics: 1
  ml: 0.3
  narrative: 0.3
restate:
  physics: In an ice-supersaturated layer a few hundred meters thick, what sets the crystal habit, the growth rate, the terminal velocity, and the mixing of moist air out of the plume?
  ml: There is little direct data. Process models fit cubics to sparse measurements. This is the low-data regime where a statistical model cannot be trusted to extrapolate.
edges:
  - to: descriptive-vs-predictive
    type: instance-of
source: Platt interview, paraphrased.
---
## Why it matters beyond contrails
Per Platt: the same ice microphysics sits inside every climate model. Uncertainty here propagates into what the models say about clouds generally. Solving it for contrails pays off elsewhere.

## What is known
Per Platt: contrails dissipate as crystals grow large and fall out. Fall speed depends on crystal shape, which is not known. The mixing rate from the moist core outward is approximated, not measured.

## How you would know you made progress
A measured distribution of crystal habit and fall speed inside real contrails at several ages, that a process model reproduces without being tuned to that same data.

## Simple baseline
Spherical crystals, Stokes settling, fixed mixing rate. Wrong, but it is the linear regression of this problem.
