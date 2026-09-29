Scratch gets a writer from a tangle of thoughts to a draft in their own words, in three stages: **Spill** (get it all out), **Shape** (give it an order), **Draft** (write it). The design has one job: a writer who has never seen it should know, on every screen, where they are, what goes here and what they can move, without reading instructions.

## Five rules

1. **Less text.** No counts, progress lines, labels that restate the obvious, or commentary on what the tool did. If a word doesn't teach the writer something they need right now, cut it. The only guidance is an `EmptyHint`, and it disappears once the space fills.
2. **If you can move it, it's a card.** Ideas are white `card`s with `shadow-card` and a grip, lying on the `desk`. Groups are recessed `desk-2` trays. Pages (`page`) are where you write, and they don't move. Nothing else gets a shadow.
3. **Blue pencil is Scratch talking to you.** `pencil` is only for guidance in empty spaces, the section you're writing in, the empty-state animation and keyboard focus. Your ideas, their labels and your writing are ink.
4. **One next step at a time.** A stage has at most one primary button. The `StageRail` shows 1 › 2 › 3 with the current stage filled: a toggle you can flip back and forth that still shows the direction.
5. **Mark, never block.** An idea that doesn't usually belong in a level gets a dotted outline; nothing ever refuses a drop, a label or a keystroke.

## Words

- **Plain words**: Spill, Shape, Draft; ideas (not units); groups (not clusters); levels in Shape; `cut into ideas` (the button); credits (not parses, cuts or balance).
- **Buttons that act on your writing are lowercase verb phrases** (`cut into ideas`); everything else is sentence case (`Save key`, `Add a level`).
- **Hints are one short line**, addressed to you, saying what goes here: "Braindump here." "Type, speak or paste everything you're thinking. Fragments are fine." "Ideas gather here in loose groups. Let's get those ducks in a row." "Drag an idea here to start."
- **Errors say what happened, then what's safe, then the fix as buttons**: "Out of credits. Your spill is saved." No apologies or codes.
- **Money is in credits.** Each run of Spill uses about 1 credit; a long spill can use 2 or 3. Paying $5 buys credits. How pricing works (at cost, plus Stripe's card fee) is explained once, on the account page, and nowhere else.
- `Cut`, not delete, for ideas (they stay in History). Gaps to fill later go in square brackets: `[bleed fraction on a modern engine]`.
- No emoji, no "AI", no sparkles.

## Colour

Three grounds: `desk` (the table: the Spill board, Shape, Draft's outline), `page` (where you write, and panels), `card` (what you can move or pick). `desk-2` is a group's tray. Text is `ink`, `ink-2`, `ink-3`, each at least 4.5:1 on every ground. `pencil`, `pencil-soft` and `pencil-line` are guidance. `question` and `objection` colour those two idea types (and low or no credits, and errors); `go` marks where a drop lands and ideas you've written about. `thread` is the welcome page's fat line.

## Type

- **Newsreader** (`serif`) for the writer's words: the draft (`text-page`, 19/32 at a 680px measure), the spill (`text-spill`), your words on cards, notes, the document title.
- **Hanken Grotesk** (`sans`) for the interface: labels, buttons, hints (`text-hint`, italic), type tags (`text-tag`, capitals).
- **Bricolage Grotesque** (`display`) only for the welcome headline (`text-hero`, 800, two short lines).
- **IBM Plex Mono** (`mono`) for key hints and the +N on a folded group.
All four load from Google Fonts.

## Space, shape, depth

A 4px scale (`space-1` to `space-16`). Controls are 40px, 32px small. Corners soften as things grow: `radius-tag` 4, `radius-card` 6, `radius-control` 8, `radius-panel` 12. Depth means "you can pick this up": `shadow-card`, `shadow-lift` on hover and for menus, `shadow-drag` with a 2° tilt in the hand.

## The screens

- **Welcome**: nearly empty. A fat black rope (`thread`) sweeps in from above the screen and hangs in a still, smooth knot, with over-and-under crossings. Scrolling is a pencil point pinned in place with the paper pulled up under it: the knot rises off the top while a straight line trails down to the point. Then the paper stops and the point moves on: down, deflecting right round the top-right corner of "Detangle Your Brain" (low, large, tucked into that corner) and down past its right side, uncovering it line by line. Then one sentence, the three stages as large cards, and sign-in centred beneath them.
- **Spill**: the spill page at the left, the board at the right. Groups pack into masonry columns as the code lays them out (point on top, up to four ideas beneath, the rest as dots with +N; loose ideas in a muted column). One primary button: `cut into ideas ⌘↵`. `Shape these ideas →` once there are ideas.
- **Shape**: the outline chooser (`Segmented`), the outline's levels as `Lane`s on the left half, the `Pool` of unplaced groups in two columns on the right half.
- **Draft**: the `OutlineColumn` at the left (tiles you can open to see your words, and reorder), a plain editor at the right with dividers level with the outline. It starts blank, with one hint: open an idea on the left, then write. Scaffolding from your own spill words waits for a local model; a single Notion-style column is ruled out for now.

## States

Hover: cards lift, quiet buttons get a `wash`. Selected: a 2px `ink` ring 2px out. Focus: a 2px `focus` ring on every control, never removed. Disabled: dashed outline and `ink-3`. Under a drag: `go-soft` and a `+` where it lands. Dimmed (outside a selection): .45, never hidden. Nothing moves the view on its own.

## Iconography

Line icons at 18px (14px small), 1.75 stroke, round caps, in the colour of the text beside them: documents panel, chevron, check, close, plus, grip, arrow (next stage), clock (History), download (Export), scissors (cut into ideas), key (your own key), book (Readwise). Icons sit beside words; icon-only buttons (close, documents) carry an `aria-label`.

## Motion

Short and physical: cards lift in 120ms, a dropped card settles in 200ms, hints fade in 150ms. Two set pieces, both looping or scroll-driven and both off under `prefers-reduced-motion`: the welcome thread, and the dividing cells on the empty Spill board (a group grows, splits into two and then four, ages, and merges back). Nothing else slides, bounces or loops.

## Accessibility

Every text pair meets 4.5:1 on the grounds its note names; control edges (`edge`) and drawn outlines (`pencil-line`) meet 3:1. Idea types carry a word and a mark shape as well as colour. Hover-only affordances (grips, block handles) also show on keyboard focus. Every drag has a keyboard path: the idea sheet's `Move to` menu.
