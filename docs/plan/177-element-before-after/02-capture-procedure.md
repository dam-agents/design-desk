# 02 — Capture and the agent's procedure

**Depends on:** 01-store-server
**Part of:** an element's before and after — see [README](./README.md)

## Context

The agent has two new jobs: when it draws `now`, say where each shared part sits in it
(`now.elements`); and when someone presses the dialog's button, take that part from the real
product. `design capture` can only shoot the whole viewport today; this slice lets a recipe
shot crop to one element, and writes both procedures in `docs/requests.md`.

## Implementation plan

1. **`toolkit/bin/capture.mjs`.** In `followRecipe`, a shot may carry `element: "<selector>"`
   (Playwright's, like the steps'): wait for it (`pg.locator(sel).first()`), scroll it into
   view, and take `locator.screenshot()` with a small padding (clip from its bounding box
   grown by 8 px, kept inside the page), JPEG 80 as today; the file is
   `<slug>[-dark]-element.jpg`, and the JSON line gains `element: true` and the box. Missing
   or hidden element → the shot's usual error path (`-stuck.jpg`, `error`). Update the header
   comment and `design.mjs`'s usage line.
2. **`docs/requests.md` → How it looks today.** When drawing `now`, give it the request's
   shared parts as they are today: for each `shared_elements` id whose part exists in the
   product now, `now.elements: [{id, selector, view, view_name}]`, its CSS path in the `now`
   page (`design shot --element` checks it cuts the part). A part the product does not have
   yet gets no entry.
3. **`docs/requests.md` → a new short paragraph "The part before, from the product"**
   (`explore` with `scope: "before"`, `element`): it needs the screens instance
   ([screens.md](../../screens.md)); bring `main` up to date; write a recipe that reaches the
   screen and state the part shows in (the request's screen, `profile.capture.routes`); one
   shot with `element` set to the part's selector in the product's page, `themes: ["light"]`;
   look at the picture (Read it) — a sign-in page or another part is not it; upload with
   `design desk asset <file> --kind screen --card R-<n>`; `design desk upsert` with
   `before_shots: [{id, asset, source: "instance", ref: "main", commit}]`; then compare it with
   the cut from `now` and, when they plainly differ, say so in the done note and redraw `now`
   (its existing "Redraw it when…" rule). Stuck twice or no instance: close the item with a
   plain-words outcome, no picture. Like `scope: "now"`, it is drawn without the decisions
   check and changes nothing else on the card. Keep the recipe under
   `work/output/screens/R-<n>/` for the next press.
4. **`docs/actions.md`**: the `show` row (or `options`) names the button as a start, pointing
   at that paragraph — one line, no restatement.
5. **`.agents/skills/show-me/SKILL.md`**: only if its steps need a line that the crop exists
   (`element` on a shot); otherwise leave it.

## Docs and tests

- `toolkit/tests/capture.test.mjs`: a recipe shot with `element` against a local page writes a
  cropped JPEG whose size matches the element's box (± padding); a missing element reports
  `error` and writes `-stuck.jpg`. Follow the file's existing local-server pattern.
- Docs as in steps 2–4. Size sweep (§9): the new paragraph is the behaviour's single home;
  link to it, do not restate it.

## Acceptance criteria

- [ ] `design capture <url> <dir> --recipe r.json` with `{"shots":[{"name":"x","element":"#card"}]}`
      writes `x-element.jpg` cropped to `#card`.
- [ ] A missing element yields the existing stuck path, not a crash.
- [ ] `docs/requests.md` says how `now.elements` is written and how a `scope: "before"` item is
      worked, end to end, and each other doc links there.
- [ ] `node --test toolkit/tests/capture.test.mjs` and `bash scripts/tests/run.sh` pass.

## Smoke test

```bash
node --test toolkit/tests/capture.test.mjs
```

Then: serve any local HTML with an element `#card` (`python -m http.server` in a temp dir),
run `node toolkit/bin/design.mjs capture http://localhost:8000 /tmp/design-desk-cap --recipe
<recipe.json>` with one `element` shot, and open the JPEG: it is the card alone.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
