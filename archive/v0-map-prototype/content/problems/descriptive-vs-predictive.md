---
id: descriptive-vs-predictive
title: Descriptive models versus predictive models
type: concept
statement: A predictive model fits inputs to outputs. A descriptive model carries the mechanism, so it can extrapolate to the neighboring problem. Newton's law was about gravity, not apples.
value: 4
uncertainty: 2
lenses:
  physics: 1
  ml: 0.9
  narrative: 0.5
restate:
  physics: Consistency with conservation laws and known facts is the prior that turns a fit into a description.
  ml: In data-rich, closed problems like weather or protein folding, a statistical model is enough. In low-data, non-stationary problems like climate it is not, and you cannot wait thirty years to find out you overfit.
source: Platt interview, paraphrased.
---
## Per Platt
A 17th-century machine learning model would predict falling apples and say nothing about planets. Weather is data-rich and its attractor is fixed, so statistical models work. Climate is the attractor itself moving, with maybe fifty data points per location, so whatever you build must be constrained by what is known. His open hope is a tool that reads all the papers and fits the data at once, constrained by both.

## In this neighborhood
[[ice-microphysics]] is the low-data case. [[detect-satellite]] is the data-rich case.
