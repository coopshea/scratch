---
id: night-vs-day
title: Night contrails warm; day contrails are uncertain
type: subproblem
statement: The warming is constant. The cooling happens only with the sun up and at a good angle. Which contrails are confidently bad?
value: 3
uncertainty: 2
lenses:
  physics: 0.8
  ml: 0.5
  economics: 0.6
  operations: 0.6
  narrative: 0.9
restate:
  physics: Shortwave reflection depends on solar zenith angle and surface albedo; longwave trapping does not. When is the two-sigma bound on net forcing clear of zero?
  economics: If avoidance costs fuel, spend it only where the sign of the forcing is certain. Night flights are the cheap wins.
  operations: A rule that only reroutes night flights is simpler to adopt than one that needs a radiative model per flight.
  narrative: Nobody argues about the night flights. Start there.
source: Platt interview, paraphrased.
---
## What is known
Per Platt: many contrails, mostly at night, are warming with high confidence. Very few are confidently cooling, essentially only over the poles in polar summer, where there are almost no flights. A program that avoids only the confident cases still captures most of the benefit.

## Simple baseline
Avoid persistent contrails formed between local sunset and sunrise. Ignore daytime until the shortwave model is trustworthy.

## Ways the metric gets gamed
If the target is "contrails avoided," an operator hits it by dodging daytime contrails that might have been cooling. Score avoided forcing, not avoided contrails [[goodhart]].
