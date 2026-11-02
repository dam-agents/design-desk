# Changelog

**Migration instructions, not a change log.** Per version, the idempotent **Upgrade**
steps a deployed instance applies when crossing it — what to run, update, or change
(schedules, config keys, state formats). Most versions need nothing. What changed and
why lives in the PR and commit history, not here. Consumed by the version check
([docs/persistence.md](docs/persistence.md) → **Definition version & upgrade**);
authoring rules: [docs/self-modification.md](docs/self-modification.md) §12.

## 1.13.1 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Until then, the page keeps its
narrow text and list columns on a wide window.

## 1.13.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A picture now keeps `marks` (from
`design diff`'s new `marks`, [docs/screens.md](docs/screens.md)) and an impact place its
`card`; older cards stay as they are and show no outline.

## 1.12.0 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The server is unchanged.

## 1.11.1 — 2026-11-02

**Upgrade:**
Nothing — `~/bin/design` runs the toolkit from the checkout, so the new build check applies
once the change is pulled. A page it now refuses is a source missing one of its two
placeholders (`<!-- design:css -->`, `<!-- design:review-bar -->`), so fix the source, not
the build.

## 1.11.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A change card's text is now capped and
every section needs `source.label` ([docs/watch.md](docs/watch.md) step 7); older cards stay
as they are. New key `change_due_days` (`21`, [docs/config.md](docs/config.md)): nothing to add.

## 1.10.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server first: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

Every row in New and Requests shows where it came from and who started it. Requests filed
before keep what their `origin` already says.

## 1.9.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server first: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

Elements and screens start keeping their earlier looks from their next redraw; older ones
come only from *Draw how it looked before* ([docs/catalog.md](docs/catalog.md) → History). No scheduled work is added.

## 1.8.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

New and Requests get a **Needs a designer** filter, and New opens on **All**. Change cards
written before this version have no `attention`, so they stay out of that filter.

## 1.7.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`) and republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Add `- slack_council: disabled` and
`- council_sync_min: 30` to `work/CONFIG.md` when missing, then re-run
`bash "$HOME/scripts/verify-onboarding.sh" --config`. Offer the operator `slack_council:
enabled` (needs a bound Slack channel): anyone in a request's Slack thread asks for design
changes and gets each new option or version back there as a before/after picture
([`slack-council`](.agents/skills/slack-council/SKILL.md)). While a thread is open, one inbox
run every `council_sync_min` minutes reads it.

## 1.6.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

## 1.5.0 — 2026-11-02

**Upgrade:**
Nothing — docs and the bundled skills are read from the checkout. A design asked for in Slack
now becomes a request on the Desk, and its options go back to the thread (the
`request-intake` action).

## 1.4.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Designers now add a screen or a
part with **+ Add** in Product; a screen needs `screens: enabled`.

## 1.3.2 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Until then, the Requests tab counts only the requests that wait for an answer.

## 1.3.1 — 2026-11-02

**Upgrade:**
1. Restart the Desk server: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

Both steps are safe to repeat. They cover the Desk server restart and the page republish
of every crossed block ([docs/persistence.md](docs/persistence.md) → **Migration**, step 1).

## 1.3.0 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**), then restart the Desk server
(`rc-service --user design-desk-server restart`). From now on `design desk agenda` only
suggests a card; a designer puts it on the next call. Cards already on it stay.

## 1.2.1 — 2026-11-01

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Until then, its dialogs send nothing.

## 1.2.0 — 2026-11-01

**Upgrade:**
Nothing — docs are re-read per run. The configuration keys moved from `CLAUDE.md` to
[docs/config.md](docs/config.md); `work/CONFIG.md` does not change.

## 1.1.1 — 2026-11-01

**Upgrade:**
Nothing — the test runner and docs are read from the checkout.

## 1.1.0 — 2026-11-01

**Upgrade:**
Republish the Desk page ([docs/desk.md](docs/desk.md) → **Publishing the page**): its header gains a day / night switch.

## 1.0.1 — 2026-10-31

**Upgrade:**
Nothing — the test runner and docs are read from the checkout.

## 1.0.0 — 2026-10-31

**Upgrade:**
Nothing — initial version; onboarding records it (`work/VERSION`).
