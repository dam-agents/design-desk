# 03 — The review on GitHub

**Depends on:** 02-send-review
**Part of:** Reviews — see [README](./README.md)

## Context

A review on a pull request's change is posted to that pull request by the agent, and the
Desk learns the pull request's head commit so it knows when a new version arrived.

## Implementation plan

1. `desk/store.mjs`:
   - `INBOX_KINDS` gains `review`; `sendReview` on a change whose card has `source.pr` enqueues
     `review` with `review: <id>` on the item (`pick()` returns it).
   - `reviewPosted(id, {url})` (agent only): `review.posted = {url, at}`; the item is done
     through the usual `done`.
   - `putGithub` keeps `head` (a 40-hex sha, else dropped) on a `pr` record.
2. `toolkit/bin/desk.mjs`: `ghRecord` reads a pull request's head (`repos/<repo>/pulls/<n>` →
   `head.sha`) and returns `head`; a new `design desk review-posted <N-id> --url <url>`
   command (`/agent/reviews/:id/posted`). Update its `--help` text.
3. `desk/server.mjs`: the `/agent/` route for `review-posted`.
4. `scripts/preflight.sh`: `reviews_due` from `pick(["review"])` in the inbox worklist, with
   `docs/watch.md` in its `read_set`; `scripts/dispatch.sh`: `reviews_due` in both lists
   (the single-unit `del(...)` and the title).
5. `docs/watch.md` → new **Reviews on GitHub** section (the one home): claim; `design desk item
   Q-<n>` gives the review; the pull request merged or closed → done "PR no longer open";
   write the body to a file — first line `<!-- design-desk review=<N-id> -->`, then "**<name>**
   (<role>) reviewed this on the Design Desk: **<verdict in words>**", the note, then each
   comment under its option/part/change name, then the card link when `desk_link` is set;
   `bash scripts/public-check.sh`-style rules of `docs/desk.md` → Writing on the Desk (no
   e-mail address); `gh api -X POST repos/<o>/<n>/pulls/<pr>/reviews -f event=COMMENT -F
   body=@<file>`; then `design desk review-posted <id> --url <html_url>`; `done`. A failed
   post is logged (`logev warn review …`) and the item released for the next run (3 tries,
   then reported in the chat UI). Never `REQUEST_CHANGES` or `APPROVE`; never the CI status.
   Comments on GitHub: the agent's own review (its marker) is "nothing", like its CI comment.
6. `CLAUDE.md` → the whitelisted work: add "post a person's Desk review on its pull request
   ([docs/watch.md](docs/watch.md) → Reviews on GitHub)".
7. Manifest: if a new due key or marker counts as public interface (`docs/manifest.md`), update
   `scripts/tests/fixtures/manifest.json` as `test_manifest.sh` asks.

## Docs and tests

- `docs/watch.md` (the section above), `docs/desk.md` → Reviews (one link to it), `CLAUDE.md` (one clause).
- `desk/tests/store.test.mjs`: the item queued only for a change with a PR, `head` kept,
  `reviewPosted`. `toolkit/tests/` (the test that covers `ghRecord`, if any) for `head`.
- `scripts/tests/test_inbox.sh`: a `review` item lands in `reviews_due` with `docs/watch.md` read.

## Acceptance criteria

- [ ] A review on a change with a PR queues exactly one `review` item; on a request none.
- [ ] `reviews_due` reaches the inbox worklist and `dispatch.sh` handles it.
- [ ] The GitHub copy of a PR keeps `head`; `responsible` clears when it changes.
- [ ] The docs say exactly how the agent posts, as a `COMMENT`, and never touches the check.

## Smoke test

`node --test desk/tests/store.test.mjs` and `bash scripts/tests/run.sh` (test_inbox) pass;
`scripts/precheck.sh inbox` on a test home with a `review` item prints a worklist with `reviews_due`.
