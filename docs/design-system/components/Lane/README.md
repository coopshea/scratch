# Lane

One level of your outline as a row: its name at the left, what you've put there on the desk to the right.

`.lane`: a 176px `.lane-head` on `page` with the name in `text-label`, then `.lane-body` on `desk`. A placed group lays out as a row (`.lane-row`): the point first, its ideas flowing to the right, wrapping before the middle of the screen, as the code does.

**States**: empty is just empty desk. Under a drag, `.is-accepting` turns the row `go-soft` and shows a `+` (`.drop-plus`) where it will land. A required level left empty turns its name `objection`, nothing more. The very first time, before anything is placed, the first level alone says "Drag an idea here to start."

**Editing**: double-click a name to rename; drag the head to reorder; `+ Add a level` under the last row opens a picker. **Don't** label rows with counts or instructions, and never refuse a drop.
