# Studio design system (vendored copy)

ccwatts follows the studio design system. These files are copied as-is from
[holroydchase-afk/hearth `docs/design/`](https://github.com/holroydchase-afk/hearth/tree/main/docs/design),
which is the source until Product Studio moves it to a shared repo.

| File | What it is |
|---|---|
| `STUDIO-CORE.md` | The rules. Section 2 (principles) binds every screen; changing a principle needs Chase's ask. |
| `tokens.json` | Type, space, radius, target sizes and the Paper/Avocado/Pomegranate themes as JSON. |
| `themes.css` | The same themes as CSS custom properties (reference only; the playground inlines its own Paper values). |

- **Copied from:** hearth `58fe9ad` on 2026-11-22. One edit: the link to hearth's own `docs/product/DESIGN-SYSTEM.md` points at GitHub.
- **Refresh:** copy the three files again from hearth `main`, update the commit above, and check the playground still matches (`packages/web/test/design-system.test.ts`, DS-0..DS-9).
- **Don't edit the rules here.** Propose changes in hearth so every product stays one family.
- The playground is a static page with no network requests, so nothing links these files at runtime.
