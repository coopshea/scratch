---
id: atc-rerouting
title: Rerouting inside air traffic control
type: subproblem
statement: A flight level is not a free choice. Controllers separate traffic vertically. A contrail reroute is a request into a system built for safety, not climate.
value: 3
uncertainty: 3
lenses:
  operations: 1
  economics: 0.4
  ml: 0.3
restate:
  operations: What is the latency from a detected region to an approved level change, and how many such requests can a sector absorb per hour before controllers refuse them?
  economics: Controller workload is the scarce resource, not fuel.
source: Not in the Platt interview. Cooper's framing.
---
## Open questions
- Is the reroute requested by the dispatcher before departure, or by the pilot in flight? [OPEN]
- How far ahead must the ice-supersaturated map be trusted for pre-departure planning to work? See [[issr]]. [OPEN]

## Simple baseline
Pre-departure only, using the forecast map. No in-flight changes. Simpler, and it loses the flights where the forecast was wrong.
