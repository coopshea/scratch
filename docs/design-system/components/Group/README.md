# Group

A point and the ideas under it, in a recessed tray: how Spill shows your ideas, and what you drag into Shape.

Laid out exactly as the code does it (`src/cards.ts`): the point (`.idea.is-head`) on top; up to four ideas (`.is-piece`) flowing beneath it left to right, indented 10px, wrapping at the tray's width, chosen by rule (one of each type first, then spill order); the rest as dots on their own line, with a `+N` pill (`.unfurl`) on the tray's corner that unfolds them. Trays pack into masonry columns, each into the shortest column. Points with nothing under them, and loose ideas, sit in their own muted column on the right (`.solo-col`).

**Behaviour**: drag the tray to move the group, a card to move one idea. Selecting an idea dims the other trays; nothing is hidden or moved by selecting. The same content always lands in the same place.
