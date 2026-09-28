AI for CAD talk
need to turn into slides
the audience in hardware FYI audience. 

need to make a concept map loosely than try to turn it into a useful narrative

CAD AI is following the path of coding.

For a long time, AI was capable of editing CAD, but couldn’t see well enough to validate it was doing what was expected. on top of this, spatial reasoning, self intersections, etc were not something LLM systems were able to reason through.

In the last couple weeks, models that can natively do computer use have gotten much better. this is a combination of a few factors. Better operator (can call functions, like fusion MCP or onshore API), better spatial reasoning (higher fidelity objective), and better verification (more capable of seeing that the goal was obtained)

of course, we are no where near a general engineering model. but we are pretty close to a general CAD/CAM/CAE operator model.

There are a number of superb startups working to crack this through a combination of clever niche training, cracking open the closed ecosystems of CAD tools, and also working on the harness (what other tools does the AI

Oddly enough, a lot of the reaction I’ve found sounds very familiar to when I showed talented ML researchers back in 2023. I couldn’t code for shit, but was able to use these tools to start to built small tools for myself. When i showed this to the engineers, they pointed out how much better they are, all the bugs, etc. I’m not sure how to describe this reaction. Ostrichlike? 

In the ensuing years, it has become very apparent that if you can write a benchmark for a task, and have some reasonable manner of running a CI/CD loop on it, it can be solved. This simple process is the root of all the advances in coding harnesses today, and will continue to advance them to be better at writing maintainable code, clean code, etc.

Physical engineering is beginning to see similar loops be spun up.

A lot of these startups forget that CAD is one part of a much bigger CI/CD loop that involves lead times, skinning you knuckles, and frying a couple boards. Spending more time reasoning as a human comes with diminishing returns, especially as a high paid engineer. it is often much cheaper to design and test a bad design in order to answer specific questions than it is to think it through ahead of time. I am very bad at this myself and often overanalyze instead of just paying 50 bucks to get a part and figure out what went wrong.

A lot of the reaction ive seen to developments in LLMs being applied to design and physical engineer tasks is that it can’t do most of the job. And I agree. looks like we have a few years to wait before a united can open a send cut send box and check a part with some calipers before accidentally dropping it on its flip flop shod foot.

So how do we think about this problem?

Let’s talk about the law of bottlenecks. This is true of any process that goes from one state to another. seed to plants are limited by whatever nutrient it runs out of, other clear example, and engineers (like most people) have a thousand things to get done in about 40 hours/week. 

What i hear is that no matter how good an AI system is it will be bottlenecked by physical reality. I tend to agree with this. But i think the follow up question is often not there, which is: how much does that matter now, in a month, in a year, etc?  There used to be draftsmen. Then engineers became draftsmen as well as the software and demands of industry collapsed that collaboration into a single person. I don’t think it’s unreasonable to expect that these tools are going to take what they can take. maybe not everything, but how much does it turn and engineer into a technician? if relied upon, mentally. if economically viable, it will functionally.

There is no guarantee that the mix of jobs that an engineer does will remain the same. it never has. better tools, calculators, higher level of abstraction lead to specialization and changing requirements of what an engineer has to do. The day job changes with the tools. And these tools are getting really fkn good, and there is no reason to believe that spatial reasoning is beyond LLMs if they can operate a 3D harness (CAD) like a human.  I would argue that spatial reasoning, while extremely powerful in people, is rarely utilized to its maximum extent. in most designs, at a local view, only basic 3d logic is necessary. tolerance stack up. DFM, etc. All of these slices taken together are complex. and perhaps understanding the whole of a complex assembly may remain more human dominated. but i dont believe we have found  bottleneck to faster designs.

—

premise:
tools are getting better. people are trying to cope and move goalposts. physical ai will not be like coding AI, but there are lessons we can pull. why did coding AI work so well? where did it not? compare and contrast these systems to physical AI through the lens of bottleneck and the actual job of an engineer. where are there bottlenecks. where aren’t there? This is a lens to make predictions about what will happen. we can’t really know when.

talk about the rungs analogy of thinking through this

What matters to Siemens? or Aecom? or an architecture firm? the economics of tasks. at what point is it valuable to have claude be good at CAD? maybe not until the physical CI/CD loop is there. But i think thinking in these rigid blocks is probably not smart. if you can train it on 3d, it will be better in general. that is the goal of these companies. to make generally capable things. it won’t one day suddenly do everything. it will slowly get better at it, then other things will become possible, then this will exert pressure on businesses and people to change what they do. and then it will get better at something else.

This is very depressing as an individual. it can be, i should say. in that