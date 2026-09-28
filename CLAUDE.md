# Scratch — project context

Personal project of Cooper Shea. Not JAS Surgical work; keep it separate from that repo.

A three-stage drafting tool: talk (blurt and parse), structure (drag clusters onto outline levels), draft (outline aligned beside a markdown page). Read `docs/rationale.md` first: it holds the philosophy, the decisions and why, how Cooper works, and the technical gotchas. Then `README.md` for the stack and how to run it, and `docs/issues.md` for open work. `docs/article-candidates.md` lists the essays used as test beds; gas turbines is first.

## Working rules
- Get out of the writer's way. Minimal features around a markdown editor, as few clicks as possible. Where the writer puts something, it goes; structure rules suggest and mark, they never block.
- Use drop-in libraries wherever possible instead of building UI primitives. Point out when an existing tool already does what is asked.
- The model never writes prose for the user. It parses, suggests stubs with empty bodies, and flags. Spelling and typos are the only edits it makes in the draft.
- The parser cuts the user's words and never rewords them. The server locates each cut in the raw blurt and flags anything not found verbatim.
- Labels are 3 to 6 words, 40 characters max, enforced on the server.
- Every mutation goes through the server and is logged to `events.jsonl` with its author (human, model, or system). Do not add features that bypass it.
- Model-origin units are marked `origin: model` and `verified: false` until the user fills and verifies them.
- `.env` holds the API key and is gitignored. Never commit it.
- Preview config: `scratch` (port 5178, real parser). `npm run dev:offline` (port 5179) is a sentence-splitting stand-in for UI work only; never leave it open for Cooper, it looks like a broken parser.
