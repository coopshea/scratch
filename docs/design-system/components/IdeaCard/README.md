# IdeaCard

One idea cut from your spill: its type, a short label, and your own words. It looks like a card because you can pick it up.

`.idea`: `card`, `line` border, `radius-card`, `shadow-card`, `width-card` wide. Top row: `TypeTag` and a grip that darkens on hover. Then the label (`text-label`, `ink`) and your words (`text-words`, serif, three lines).

**Sizes**: `.is-head` is a group's point (full width, `ink` border, 16px label, no tag); `.is-piece` is an idea under a point (label only, up to 184px, flowing side by side); `.is-compact` is a tighter card for lists.

**States**: hover lifts (`shadow-lift`); `.is-selected` gets a 2px `ink` ring and opens the `IdeaSheet`; `.is-dragging` tilts 2° with `shadow-drag`; `.is-offfit` gets a dotted `question` outline when it lands in a level that usually holds other types (it marks, never refuses); `.is-crossed` (Draft) is struck through in `go` once you've written about it.
