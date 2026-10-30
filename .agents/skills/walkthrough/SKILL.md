---
name: walkthrough
description: >-
  Build ONE self-contained clickable walkthrough: a step-by-step tour of real screens with
  numbered pins on what changed and a sidebar of plain-language notes. Use for "what's new in
  this release", a feature tour, an onboarding guide, a before/after, or a review of a
  shipped change. With a repo, the screens are rebuilt from its current source and styles;
  without one, from screenshots the user sends, in the saved brand or IBM Carbon.
---

# Walkthrough

A walkthrough replaces a screen recording: a short sequence of steps, each one changed area of
a real screen, with pins on exactly what changed. It uses the same build as the `variants`
skill — read its sections 1, 2, 4 and 7 for the style order, the repo profile, reading the real
UI, and the markup rules. What differs is the shape and the rules below.

## 1. Decide what the steps are

- **A release or a change range** (repo mode): list what shipped. Read the release notes if the
  repo has them, else the merged pull requests between the two tags:
  `gh api "repos/<o>/<r>/compare/<from>...<to>" --jq '.commits[].commit.message'`, then each PR's
  linked issue. Every step names **what a user could not do before**. Internal refactors, test
  and CI changes, and anything behind a feature flag that's off by default are not steps.
- **A feature tour or onboarding:** the path a new user takes, one action per step.
- **4–7 steps, biggest first.** Ask before going past 7; cut rather than cram.

Write the step list as one line each and confirm it with the user before building when there are
more than three, or when you had to judge what counts.

## 2. Build each step

Source file `<slug>-walkthrough.src.html`:

```html
<!doctype html>
<html lang="en" data-tour-title="What's new in 2.4" data-tour-eyebrow="Release walkthrough"
      data-tour-stamp="Released Nov 4 · changes since 2.3 · 5 steps">
<head><meta charset="utf-8" /><title>What's new in 2.4</title><!-- design:css --></head>
<body class="bg-background text-foreground">
  <!-- design:tour -->
  <section data-step="1" data-step-title="Agents list">
    …the real screen's header, sub-nav and surrounding fields, with the change inside…
    <span class="relative …">  <span data-pin="1"></span> …the element that changed… </span>
  </section>
  <template data-notes="1">
    <p><b>Short name.</b> One sentence on what a person can now do.</p>
  </template>
  …
</body></html>
```

- **One changed area per step**, inside enough of its real screen to recognize it (its header,
  its neighbours). No app shell — no global sidebar or top bar; the reader knows them.
- **At most 3 pins per step**, each on the element that changed (`data-pin="1"` inside it;
  `data-pin-side="right"` to put it on the right edge). The notes have one `<p>` per pin, same
  order. Pins come from the build's accent.
- **Notes say what a person can now do**, in the product's own words, one sentence each; the
  `copy` skill applies.
- Repo mode: rebuild every screen from the source at the release's tag (`--ref <tag>`), never
  from memory or an older walkthrough.
- Screenshot mode (no repo): the user's screenshots are the ground truth. Rebuild the screen in
  the style's vocabulary as closely as the shots show, or — when exact fidelity matters more than
  interactivity — embed the screenshot itself (`<img src="data:…">`, base64) inside the step and
  pin on top of it. Say which you did.

## 3. Build, look, deliver

```bash
design build <slug>-walkthrough.src.html <slug>-walkthrough.html --style <style> [--ref <tag>]
design shot <slug>-walkthrough.html shots/      # every step, light and dark
```

Open every screenshot. Check: each pin sits on its element (not floating), the notes match the
pins in number and order, nothing overflows, dark mode works. `?step=3` deep-links a step.

Deliver per docs/requests.md → **Chat and Slack**: the built `.html` as a private artifact; in the message,
the step list, the style (and repo@ref), and anything you left out on purpose (flagged
features, internal changes) so the user can disagree.
