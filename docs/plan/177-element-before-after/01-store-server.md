# 01 — Store and server

**Part of:** an element's before and after — see [README](./README.md)

## Context

The Desk keeps no picture of a part as it is before the design. This slice adds the two places
"before" comes from — `now.elements` (where each shared part sits in the `now` drawing) and
`before_shots` (pictures taken from the product) — and the `take-before` action the dialog's
button calls. The README's **The contract** is the specification; this slice implements it
server-side only.

## Implementation plan

1. **`desk/store.mjs` — `now.elements`.** In `upsert`'s `k === "now"` branch (around the
   `fields.now` check): accept `elements`, clean each entry (`id` in `c.shared_elements`,
   `selector` 1–480 chars, `view` number|null, `view_name` ≤ 80 via `optText`), at most 24,
   duplicates refused. Keep the earlier `elements` when the asset is unchanged and none are
   sent; drop them when the asset changes without them; `now: null` clears all. Use the
   existing `bad()` errors and the `LIMITS` table for the numbers.
2. **`desk/store.mjs` — `before_shots`.** Add `"before_shots"` to `AGENT_FIELDS`. Merge by
   `id` into `c.before_shots`: validate `id` (in `shared_elements`), `asset` (`own(this.db.assets,
   …)` and its kind `screen`), `source === "instance"`, `ref` (≤ 80), `commit`
   (`/^[0-9a-f]{7,40}$/`); stamp `at: this.clock()`; `asset: null` removes the entry; at most 24.
3. **`desk/store.mjs` — the action.** In `act()`: `kinds["take-before"] = "explore"`; accept
   `element` (already a parameter); refuse an id not in `shared_elements` and a closed
   (`declined`) request; busy only against another open `explore` item with `scope: "before"`
   and the same `element` on the card (extend the `draw-now` busy line, so it neither blocks
   nor waits for the options' work — check the other `i.scope !== "now"` guards (lines with
   `["explore", "revise", …].includes(i.kind) && i.scope !== "now"`) also skip `"before"`);
   then `item.scope = "before"; item.element = <id>`.
4. **`desk/store.mjs` — abilities.** `can()`: `case "before": return member;`; add `"before"`
   to `ACTIONS`.
5. **`desk/store.mjs` — `waitingFor()`.** Pass `element` on in each waiting entry (as `variant`
   already is), so the page can tell which part is busy.
6. **`desk/server.mjs`.** In the actions route (`need(...)` mapping near line 392):
   `take-before` needs `before`; refuse 400 with the README's sentence when `s.screens` is
   false; pass `b.element` to `store.act`. Add `before: "take pictures from the product"` to
   the ability words (line ~141). Check the item rate window (`spend(..., "item")`) already
   covers `actions`.
7. **`toolkit/bin/desk.mjs`**: `design desk item` and `upsert` pass fields through — confirm
   `scope`/`element` show and `before_shots` reaches the store; change nothing if they do.

## Docs and tests

- `desk/tests/store.test.mjs`: `now.elements` kept / cleared / refused (unknown id, long
  selector, more than 24); `before_shots` merge, replace, remove, refused (foreign asset, bad
  commit, unknown id); `take-before` queues `explore`/`before` with `element`, refuses an
  unknown id and a closed request, is busy per part, does not block `explore` or `revise`;
  `can("guest", "before") === false`, members true; `waitingFor` carries `element`.
- `desk/tests/server.test.mjs`: `take-before` 400 with screens off, 403 for a guest, 200 for a
  developer with screens on.
- `docs/requests.md` → How it looks today: one sentence on `now.elements`; → The option's
  elements: `before_shots` and the `take-before` item (`explore` with `scope: "before"`), kept
  short — slice 02 writes the agent's procedure. `docs/desk.md` → Roles, if it lists abilities
  per role: the new one.

## Acceptance criteria

- [ ] `upsert` with `now.elements` stores them; the card read back has them; invalid entries
      are refused with a 400 naming the problem.
- [ ] `upsert` with `before_shots` merges by id and stamps `at`.
- [ ] `POST /api/cards/<R>/actions {action: "take-before", element}` queues one
      `explore`/`before` item; a second for the same part is 409; one for another part is not.
- [ ] Guests get 403; with `screens` off everyone gets 400 with the plain sentence.
- [ ] `node --test desk/tests/store.test.mjs desk/tests/server.test.mjs` passes.

## Smoke test

```bash
node --test desk/tests/store.test.mjs desk/tests/server.test.mjs
```

Then by hand: `DESK_PORT=5599 node desk/server.mjs` with a throwaway data dir, upsert a request
with `shared_elements` and `now.elements` through `design desk upsert -` (JSON on stdin), call
the action with `curl` as a developer and as a guest, and read `design desk item Q-<n>`: kind
`explore`, `scope: "before"`, `element` set.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
