# 04 — The dialog: comments on the part; release

**Depends on:** 03-dialog-before-after
**Part of:** an element's before and after — see [README](./README.md)

## Context

Under the pictures, the dialog lists the comments already on the part and lets a person add
one. A comment is posted at once as a note on the part — the same `change` thread the design
workspace makes — since draft comments sent as one review (#175) do not exist yet. This slice
also carries the PR's one version bump.

## Implementation plan

1. **Which notes are the part's.** A helper `notesOn(c, v, e)`: threads of `c.threads` with
   `kind === "change"`, not resolved, whose `anchor.variant === v.id` and, when the part has a
   selector, `anchor.selector === e.selector` — else `anchor.label` naming the part (as the
   prototype's `on()`). Reuse the page's existing note rendering helpers (`noteBy`, the thread
   list the request page already draws) rather than a new list style where one fits.
2. **The list and the box.** Below the pair (and above the states): each note's author, its
   first message on one line, and "N replies"; a click goes to the note (`data-goto` like a
   note's anchor elsewhere). Then a `<textarea id="el-text">` ("What should change here?") and
   **Comment**, for `can("change")` on a request that is not closed (`closed(c)`); a guest or a
   closed request sees the list only.
3. **Posting.** A `data-el-comment` handler: empty → focus and a toast; else
   `api("POST", \`/api/cards/${c.id}/threads\`, {kind: "change", text, anchor})` with `anchor =
   {variant: v.id, selector, text: "", tag: "", view, view_name, label: e.name}` (without
   selector fields when the part has none), as the workspace builds one (see the call near
   `lookText(e)`); then refresh the card and keep the dialog open on the same part (S.el
   survives `renderDetail`). The text goes in the JSON body, never anywhere else.
4. **Mock.** `desk/dev/mock-data.mjs`: one note anchored to a part of the mock request, so the
   list shows; the mock already answers `POST …/threads`.
5. **Release.** `VERSION` minor bump (1.99.0 → 1.100.0, or one above whatever is on `main`
   then) and the `CHANGELOG.md` entry with its **Upgrade** block (§12): nothing to run; the
   Desk server restarts with the kit (say so if the kit's update does that, as earlier entries
   for `desk/` changes do — copy their wording).

## Docs and tests

- `desk/tests/page.test.mjs`: the dialog lists a note on the part and not one on another part
  or option; **Comment** posts a `change` thread with the part's anchor; a guest sees no box.
- `docs/desk-page.md` → the element dialog paragraph from 03: one sentence on comments and
  that they are posted at once (until reviews exist).
- `CHANGELOG.md`, `VERSION`.

## Acceptance criteria

- [ ] The part's open notes show under its pictures; notes on other parts do not.
- [ ] Comment posts a note anchored to the part; it appears in the list and in the design
      workspace on that part.
- [ ] Guests and closed requests get no box.
- [ ] `VERSION` equals the newest `CHANGELOG.md` heading; `bash scripts/tests/run.sh` and
      `bash scripts/validate-definition.sh .` pass.

## Smoke test

`node desk/dev/mock.mjs 5610`, `http://localhost:5610/?role=designer#R-1` → All elements → the
part with the mock note: the note is listed. Write "Make the label shorter", press **Comment**:
it is listed, and **Open in design workspace** shows it as a pin on the part. `?role=guest`:
the list, no box. Then the README's whole-feature smoke test.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
