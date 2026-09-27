---
id: humidity-forecast
title: Weather models miss cruise-altitude humidity
type: subproblem
statement: Global weather models are excellent at the trajectory of the atmosphere for two weeks, and poor at the thin humidity layers that matter here.
value: 3
uncertainty: 3
lenses:
  ml: 0.9
  physics: 0.7
  operations: 0.5
restate:
  ml: ML weather models were trained on reanalysis data that itself has poor cruise-altitude humidity. Better skill on this target needs a new label source, not a bigger model.
  physics: The layers are thinner than the model's vertical grid. Sub-grid humidity structure has to be inferred, not simulated.
source: Platt interview, paraphrased.
---
## What is known
Per Platt: weather is chaotic past roughly two weeks, and ML weather models built from the 2018-era toolkit plus a lot of data have been a step change for trajectory prediction, including tropical cyclone tracks. That skill does not transfer to ice supersaturation because the layers are not resolved and the training data does not contain them.

## Simple baseline
Use the model humidity anyway and calibrate a bias correction against satellite detections.
