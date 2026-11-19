# 01 — Feedback words

**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

#175 named the thing a person collects and sends a *review*. From now on every word a person
reads says **feedback**; the code, the API and the data keep `review`. This slice changes words
only, so later slices write their new UI in the new words.

## Implementation plan

Apply `/frontend-design` for wording only; no layout changes.

1. `desk/page.html` — every string a person reads (labels, button text, `title`/`aria-label`,
   toasts, dialog titles, hints in `HINT`, empty states, the bell's event names, the flow
   drawings' captions that mention a review). Find them with
   `grep -nE '[Rr]eview' desk/page.html` and keep those that are identifiers. The map:
   - **Add to review** → **Add to feedback**; **Your review · n** → **Your feedback · n**;
     **Send review…** → **Send feedback…**; dialog title **Send your review** → **Send your feedback**;
     button **Send review** → **Send feedback**.
   - **Comment now** → **Comment** (`reviewBox`, the `draftNow` hint).
   - Toasts: "Added to your review (…)" → "Added to your feedback (…)"; "Review sent. …" →
     "Feedback sent. …".
   - The sent block (`reviewBlock`, `REVIEW_SAYS`): keep the verdict words (**Changes
     requested**, **Approved**, **Comments**); its `aria-label`/title say feedback.
   - The bell: **Review sent** → **Feedback sent** (the event kind's key stays).
   - The verdicts stay **Request changes**, **Approve**, **Comment only**.
2. `desk/store.mjs` / `desk/server.mjs` — error messages a person reads (`Send your review
   first.` → `Send your feedback first.`, and the like); `grep -n '[Rr]eview' desk/store.mjs
   desk/server.mjs` for strings inside `bad(...)` only.
3. `desk/guidelines.html` → Comments → "A review, and a draft not sent yet": its heading and
   sample words; regenerate nothing (its CSS is unchanged).
4. `docs/watch.md` → Reviews on GitHub, step 1: the body's first line reads "**<name>** (<role>)
   gave feedback on this UI change on the Design Desk: …".

## Docs and tests

- Docs: `docs/desk-page.md` → Simple mode (the Reviews paragraph and full mode's sentence after
  it) and Notifications (the bell's table); `docs/desk.md` → Reviews: its opening line says what a
  person sees is called feedback, the section keeps its name and anchors. `docs/watch.md` as above.
- Tests: update the strings in `desk/tests/page.test.mjs` (review boxes, the dialog, the bell),
  `desk/tests/server.test.mjs` / `store.test.mjs` where they match an error text, and
  `desk/tests/guidelines.test.mjs` if it names the comment sample.

## Acceptance criteria

- [ ] `grep -nE '>[^<]*\b[Rr]eview' desk/page.html` finds no word a person reads, other than
      code identifiers and the verdict words.
- [ ] A box under an option or a change reads **Add to feedback** and **Comment**.
- [ ] The API paths, the store's keys and `U-<n>` are unchanged; no stored data changes.
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs`; then on the mock Desk
(`node desk/dev/mock.mjs`), simple mode: open a request with options, type a note, **Add to
feedback** → toast "Added to your feedback (1 comment)…", **Your feedback · 1**, **Send
feedback…** opens "Send your feedback".

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
