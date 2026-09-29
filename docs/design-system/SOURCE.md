# Scratch design system: the copy in this repo

These files are a copy of the design system at https://claude.ai/artifact/X3VzMr8pquZKpoMbRn42ew, taken on 2026-09-29, kept here so the system is versioned with the code and doesn't depend on claude.ai. The screens drawn with it are at https://claude.ai/artifact/9gVUYbkUAGBKhKj7ZKqt29.

- `README.md`: the rules. Start here.
- `tokens.json`: every colour, text style, space, radius, shadow and fixed size, each with a note on where it is used and, for colours, the contrast it holds.
- `components/<Name>/README.md`: what each component is for, how it behaves and what not to do with it. `preview.html` beside it draws it.
- `components/bundle.css`: the tokens as CSS variables, then the component classes the previews use.
- `design-system.json`: the artifact's index.

The app doesn't load these files. Its tokens are copied at the top of `src/styles.css`, under the same names, and its components follow the rules here. When a value changes, change it in the artifact and in `src/styles.css`, then copy the artifact's files here again.

The previews are fragments: the artifact's page wraps them with `components/bundle.css`. To open one on its own, add `<link rel="stylesheet" href="../bundle.css">` to its `<head>`.
