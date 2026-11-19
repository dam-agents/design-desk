# 06 — The workspace: notes and Your feedback

**Depends on:** 01-feedback-words, 05-element-dialog
**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

The design workspace sends a note to Design Desk at once (**Send to Design Desk**, a `change`
thread) or posts it for the team (**Just comment**). `docs/desk.md` → Reviews says its notes
"go to Design Desk at once, never into a review". That sentence is reversed here: a note in the
workspace is added to the feedback, and the workspace shows the feedback in its side panel.

## Implementation plan

Apply `/frontend-design`; the side panel's tabs follow `desk/guidelines.html` → Tabs and
switchers → "Plain underline tabs".

1. **The boxes** — `wsBox` (`desk/page.html` ~7074: the whole option or state, a part) and the
   pin's pop-up (~7039): **Add to feedback** (primary) and **Comment** replace **Send to Design
   Desk** and **Just comment**, for who may comment or change, as today. In `wsSend(only, from)`
   (~8013): Add to feedback → `addDraft(c, {text, anchor})` with the anchor it builds today
   (option, state, part); Comment → today's comment thread. Nothing in the workspace posts a
   `change` thread any more, except the look panel until slice 07.
   The placeholder for those who may change ("What should change here? e.g. …") stays.
   The part's unsent look edits no longer ride along with a typed note (that was the change
   path); slice 07 brings them into the feedback.
2. **The Your feedback tab** — the side panel's tabs (~6962, `ws-ptabs`): **Comments**,
   **Properties**, and **Your feedback** with its count (`.n`) while drafts wait. Its panel:
   every draft of the viewer on this request, across options, each with what it is about
   (`aboutOf`) and its words, ✕ to remove; a click on one with a part shows its option (and
   state) and selects the part; **Send feedback…** at the end opens `reviewDialog(c)` (the same
   dialog as the page). Empty: "Nothing in your feedback yet. Add to feedback keeps a note here
   until you send it."
3. **Pins**: a draft is not a pin (only sent notes are); the panel is where drafts show.
4. **Hints and help** that describe Send to Design Desk in the workspace (`HINT.wsSend`, the tab
   intro and How it works drawings that mention it): reworded to the feedback.

## Docs and tests

- `docs/desk.md` → Reviews: rewrite "the design workspace's notes go to Design Desk at once,
  never into a review" — the workspace adds to the feedback like every other box.
- `docs/desk-page.md` → the design workspace paragraphs (Select, Comments, the side panel):
  the two buttons, the Your feedback tab.
- `desk/tests/page.test.mjs`: the workspace tests that click **Send to Design Desk** / **Just
  comment** (search `data-ws-send`) — now Add to feedback posts a draft with the anchor and
  Comment a thread; new: the Your feedback tab lists drafts from two options, a click selects
  the part, ✕ removes, Send feedback… opens the dialog.

## Acceptance criteria

- [ ] No box in the workspace offers Send to Design Desk; each offers Add to feedback and Comment.
- [ ] A note added there is a draft with its option, state and part, listed in Your feedback here
      and on the page.
- [ ] Sent with Request changes from the workspace or the page, it becomes a change note on its part.
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/page.test.mjs`. Mock Desk `?role=designer&ws=1#R-1`: **C**, click a
part, type, **Add to feedback** → the Your feedback tab shows 1, the note with its part; switch
to option 2, add one on the whole option → 2; click the first → option 1 with the part selected;
**Send feedback…** → Request changes → two change notes; a change note is claimed after 4 s (the
mock's Design Desk).

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
