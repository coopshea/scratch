---
id: avoidance
title: Avoid the bad regions by dropping two flight levels
type: subproblem
statement: The intervention is a small altitude change through a known volume of air. It costs a little fuel. Everything else is deciding which flights, and getting it done.
value: 5
uncertainty: 2
lenses:
  operations: 1
  economics: 0.9
  physics: 0.3
  ml: 0.5
  narrative: 0.8
restate:
  operations: A reroute request has to fit inside existing air traffic control separation rules and pilot workload.
  economics: The fuel cost is small but nonzero and paid by the airline; the benefit is shared. An externality with an unusually cheap fix.
  narrative: Two flight levels. That is the whole intervention.
edges:
  - to: avoidance-cost
    type: decomposes-into
  - to: atc-rerouting
    type: decomposes-into
  - to: ranking-metric
    type: decomposes-into
  - to: incentives
    type: decomposes-into
  - to: issr
    type: requires
source: Platt interview, paraphrased.
---
## What is known
Per Platt: the regions are thin, so dropping two flight levels usually gets under them at a modest fuel cost. Because the effect is local, a country that avoids contrails over its own airspace improves its own climate, unlike CO2 where the benefit is global and diffuse.

## How you would know you made progress
Forcing avoided per kilogram of extra fuel, on real flights, using the [[counterfactual-forcing]] estimate for the flight that was not flown at the original level.

## Simple baseline
Reroute only night flights through the highest-confidence forecast regions. Measure. Expand.
