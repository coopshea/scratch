---
id: contrails
title: Persistent contrails warm the planet
type: problem
statement: Condensation trails behind jets sometimes persist for hours and trap outgoing infrared. The fix looks cheap. Why is it not done?
value: 4
uncertainty: 2
lenses:
  physics: 1
  ml: 0.6
  economics: 0.8
  operations: 0.7
  narrative: 1
restate:
  physics: Under what atmospheric conditions does jet exhaust nucleate ice that persists, and what is the net radiative forcing of the resulting cirrus?
  ml: Given satellite imagery and weather fields, where do contrails form, and how much forcing did each one cause relative to a world where it did not?
  economics: Avoiding a contrail costs fuel. What is the cost per unit of avoided warming, and who has an incentive to pay it?
  operations: Can flights drop two flight levels through ice-supersaturated air without breaking air traffic control?
  narrative: A measurable slice of warming with a fix that is cheap, local, and verifiable. Why is nobody doing it?
edges:
  - to: radiative-balance
    type: decomposes-into
  - to: issr
    type: decomposes-into
  - to: avoidance
    type: decomposes-into
  - to: make-the-case
    type: decomposes-into
source: John Platt, Latent Space Science interview (transcript, 2026-09-23). Paraphrased and unverified.
---
## Why it matters
Per Platt, contrails account for roughly one percent of anthropogenic warming. Over Europe, contrail cirrus covers a few percent of the sky and adds about 1 W/m² of local forcing, against roughly 3 W/m² for all anthropogenic warming averaged over the globe.

## How you would know you made progress
Forcing avoided per kilogram of extra fuel burned, measured on real flights against a counterfactual. That needs [[counterfactual-forcing]] to work first.

## Simple baseline
Avoid every forecast ice-supersaturated region regardless of time of day. Burns fuel where it is not needed and misses the layers the weather model cannot see [[humidity-forecast]].

## Ways the metric gets gamed
Counting avoided contrails instead of avoided forcing rewards dodging daytime contrails that may have been cooling. See [[night-vs-day]] and [[goodhart]].

## Predict vs understand
Formation can be predicted reasonably well. Persistence cannot, because it depends on [[ice-microphysics]] that nobody understands.
