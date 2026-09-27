---
id: remote-sensing-tradeoff
title: Revisit, resolution, and spectral bands trade off
type: concept
statement: A satellite can revisit often, see fine detail, or see many wavelengths. Not all three at once.
value: 2
uncertainty: 1
lenses:
  ml: 0.7
  physics: 0.8
  economics: 0.3
restate:
  physics: Orbit sets revisit; aperture sets spatial resolution; detector and cooling set spectral resolution and noise. Geostationary weather satellites take a frame every few minutes with large pixels.
  ml: Fuse the frequent coarse instrument with the rare precise one. Platt's team did this for CO2, using a narrow-swath precise instrument to supervise super-resolution of the coarse frequent one.
source: Platt interview, paraphrased.
---
## Why it is here
Every detection or mapping problem in this neighborhood inherits this constraint. Platt's CO2 example: a narrow accurate instrument on the space station provides strips of truth; the weather satellite gives coarse frames every five minutes; a learned model bridges them.
