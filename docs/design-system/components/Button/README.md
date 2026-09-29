# Button

The thing to press. A stage has at most one primary button, so there is never a question of what to do next.

**Variants**
- `.btn-primary`: `ink` fill, `on-ink` label. One per screen: `cut into ideas ⌘↵` on Spill, `Add $10 once` on the account page. Shape and Draft have none; dragging and writing are their actions.
- `.btn-secondary`: `card` with an `edge` border. Moving on (`Shape these ideas →`), saving a key, paying from a notice.
- `.btn-quiet`: no fill until hover (`wash`). Top-bar actions (History, Export), Cancel, Cut.
- `.btn-pencil`: `pencil-soft` fill, `pencil` label. A nudge from Scratch the writer can ignore (`Connect Readwise`). Rare.
- `.btn-sm`: 32px, inside notices, sheets and bars.

**States**: hover darkens (primary to `ink-hover`) or washes; disabled drops the fill for a dashed `line-strong` outline and an `ink-3` label, so it reads as "not yet"; focus is a 2px `focus` ring 2px out.

**Labels**: a lowercase verb phrase for acting on your writing (`cut into ideas`), sentence case for everything else (`Save key`). Put a shortcut in a `KeyHint` after the label. Icons only where they carry meaning (scissors for cutting, arrow for the next stage).

**Don't** put two primary buttons on a screen.
