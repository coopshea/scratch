---
id: the-scoring-function-is-the-problem
title: The scoring function is the problem
author: Sample essay drafted from the Platt interview
date: 2026-09-23
lens: ml
summary: What a relentless search changes about doing science, and what it does not.
---
John Platt's team at Google spent two years stuck on one number: how much sunlight a contrail reflected, compared with a world in which that contrail never formed. They had the longwave half. They could not get the shortwave half through their own tests. Then a search that [[scorable-task|treats a science problem as code plus a score]] found a small, sane model with a combination of confounders nobody had tried, and [[counterfactual-forcing|it passed]].

The interesting part is not the search. It is where the humans ended up. They stopped writing importers and started arguing about what the score should mean. That argument is the science. When the search found a way to cheat the score, they had to repair the score, which meant understanding the problem better.

This has a cost. A search that never sleeps will find every hole in your evaluation. The defense is not cleverness but rigor: a holdout you genuinely never look at. Platt's phrase is that the tool can slice your fingers off. The [[ranking-metric|contrail ranking]] has the same shape. The moment it decides which flights move, airlines optimize against it and [[goodhart|the number drifts]].

None of this replaces the person who decides whether the model is about apples or about gravity. A fit that matches the data is predictive. A model that survives a test it has never seen, because it carries the mechanism, is [[descriptive-vs-predictive|descriptive]], and only the second kind gets you to the next problem over.
