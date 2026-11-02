# Changelog

**Migration instructions, not a change log.** Per version, the idempotent **Upgrade**
steps a deployed instance applies when crossing it — what to run, update, or change
(schedules, config keys, state formats). Most versions need nothing. What changed and
why lives in the PR and commit history, not here. Consumed by the version check
([docs/persistence.md](docs/persistence.md) → **Definition version & upgrade**);
authoring rules: [docs/self-modification.md](docs/self-modification.md) §12.

## 1.3.1 — 2026-11-02

**Upgrade:**
Nothing — `~/bin/design` runs the toolkit from the checkout, so the new build check applies
once the change is pulled. A page it now refuses is a source missing one of its two
placeholders (`<!-- design:css -->`, `<!-- design:review-bar -->`), so fix the source, not
the build.

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
