---
name: demo-video
description: >-
  Produce a polished product demo video (MP4, about 90 seconds): a light gridded stage, a
  numbered step rail on the left, the product's UI recreated in a framed window on the right,
  driven by a deterministic timeline and rendered frame by frame. Use for a demo, product
  walkthrough video, feature or launch clip, or animated explainer. Screens come from the repo's
  source when one is connected, else from screenshots the user sends; colors and fonts from the
  saved brand or IBM Carbon.
---

# Demo video

You build videos as **code, not screen recordings**: every shot is a React component whose
whole frame is a pure function of time `T`. That makes a video pixel-exact, editable per shot,
and renderable to MP4 deterministically. The engine, the visual system and the motion rules are
in [`references/engine.md`](references/engine.md) — read it before the storyboard.

## 0. Golden rules (each one came from a round of corrections)

1. **Ground truth is the product.** Recreate screens from the repo's source (repo mode: the
   `variants` skill's step 4, for the files to read) or from the user's screenshots. Never from
   memory. Record which source each shot was built from.
2. **Never show a feature that doesn't exist.** If it isn't in the code or the screenshots, cut
   it. Keep the product's real *features* apart from the *example task* being shown; the rail
   never presents the example as a feature.
3. **90 seconds, total.** Target 90s, ceiling 95s, title and end card included. Too long → cut
   steps. Never speed up clicks or typing.
4. **Waits are the exception.** Something slow (a build, a long job) may run fast, but only
   under a visible speed badge (`▶▶ 4×`). Nothing the viewer has to read plays under a badge.
5. **Plain language.** No marketing words ("supercharge", "seamless", "unlock"). The rail says
   what this step does in the product's own nouns — the `copy` skill applies.
6. **Real data, or clearly illustrative.** Take numbers, output and results from a real run of
   the product when you can. Never invent a metric that looks real; when data is made up, say so
   in the hand-off.
7. **Keep the camera still.** Zoom 1 for the whole video by default; zoom only when text would be
   unreadable, once, slowly.
8. **Show the user's real decisions** in the real control (a sharing dialog, a setting), not the
   product claiming to do it.
9. **No real people.** Nobody in the video gets a real colleague's name or face.

## 1. Storyboard — get sign-off before building

A table: `# | step title | rail body | duration | what happens in the window | camera | source`,
with the summed total on the last row. Budget:

| Part | Layout | Length |
|---|---|---|
| Title card: wordmark, accent rule, tagline, mono demo line | `title` | 3–4s |
| 5–6 numbered steps following one task end to end | `step` | 6–15s each, ~65s |
| Payoff: the result, full width, scrolled slowly | `payoff` | 8–10s |
| End card: wordmark, closer, three or four chips, link | `outro` | 5–6s |

One action per step. Start each step mid-flow (the page already open). The payoff gets no
number. Don't present a storyboard over 95s.

## 2. Build

```bash
design video-new work/output/<slug>          # video.html + vendor/ (React, Babel, fonts)
```

`video.html` is the engine plus a short neutral example edit. Edit `VIDEO` at the top (wordmark,
tagline, subtitle, label, closer, chips, link — the accent is already the style's), then replace
the example `SHOTS` with yours, one `SHOTS.push({...})` each. Preview by opening the file;
`?shot=Name` plays one shot, `?t=12.5` jumps. The chips name real capabilities only.

In repo mode, take the product's colors and radii from its compiled CSS and its icons from its
icon package (`design icons <package> <Name>` checks names; copy the SVG paths into the shot).
Keep the source split under `src/` with a `build.sh` that concatenates it once the file grows
past a few hundred lines, so one shot can be fixed without touching the rest.

## 3. Review loop

```bash
design stills work/output/<slug>/video.html "Configure" 0.5,3,7.9 stills/
```

Look at the stills at every click and state change: the cursor and focus ring on target from
the first frame, rail text readable for its whole step, nothing invented. Before rendering, have
a subagent compare every recreated screen to its source and list each difference (file:line, or
screenshot region); fix each or list it as a known gap.

## 4. Render

```bash
design video work/output/<slug>/video.html work/output/<slug>/demo.mp4 30 [music.mp3]
```

About 3 seconds of rendering per second of video here; a 90s video takes ~5 minutes — tell the
user before starting. Music is mixed by ffmpeg at 18% with fades, never played in the browser.

## 5. QA, then deliver

- Total ≤95s (aim for 90); step count in the rail = number of step shots.
- Same names, channel, user in every shot; every sped-up wait badged.
- No console errors; fonts loaded before the first frame (the engine waits for them).

Deliver per docs/requests.md → **Chat and Slack**: the MP4 as a private artifact (binary upload), plus a still
of the title or payoff for the chat preview. In the message: total length and the shot list, the
source of every screen, and every gap — approximated screens, made-up data, steps cut from the
source.
