---
id: issr
title: Find the ice-supersaturated regions
type: subproblem
statement: Contrails persist only inside invisible pancake-shaped layers of ice-supersaturated air, a few hundred meters tall, that can last for days. Where are they right now?
value: 5
uncertainty: 3
lenses:
  physics: 0.9
  ml: 0.9
  operations: 0.8
  economics: 0.2
  narrative: 0.5
restate:
  physics: Warm moist air injected at the tropopause sits there and slowly dissipates. What controls its persistence, thickness, and horizontal extent?
  ml: Weather models do not resolve cruise-altitude humidity. Can satellite detections of where contrails actually formed, plus persistence, be used to map the layers?
  operations: A dispatcher needs a three-dimensional no-fly volume, updated hourly, that can be avoided by dropping two flight levels.
  narrative: Rock candy in the sky. The air holds more water than it can carry, and any plane that flies through crystallizes it out.
edges:
  - to: humidity-forecast
    type: requires
  - to: detect-satellite
    type: requires
  - to: ice-microphysics
    type: requires
source: Platt interview, paraphrased. The ten-kilograms-per-gram figure is his and unverified.
---
## What is known
Per Platt: the regions behave like a supersaturated sugar solution. For every gram of water or soot a jet emits inside one, on the order of ten kilograms of atmospheric water freezes out. They are pancake shaped, only a few hundred meters tall, and thought to be seeded by warm moist air injected at the bottom of the stratosphere, where it can persist for days.

## How you would know you made progress
Fraction of persistent contrails that formed inside a region the map had flagged in advance, versus outside. Track it daily.

## Simple baseline
Threshold the weather model's relative humidity over ice at cruise altitude. Per Platt this is not accurate enough on its own, which is why [[detect-satellite]] exists.

## Open questions
- How does a layer's lifetime scale with its thickness? [OPEN]
- Can yesterday's detections predict today's layers? Platt says persistence is days-long, so probably. [OPEN]
