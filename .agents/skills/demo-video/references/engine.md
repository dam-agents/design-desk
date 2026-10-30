# Demo video engine — visual system, motion, shot anatomy

Read before the storyboard. The engine lives in `video.html` (`design video-new`); this file is the system it implements.

## 2. Visual system

Canvas 1920×1080. Everything sits on one light **stage** that never changes between shots, so a cut never flashes:
- Background `#f2f4f8`, 1px grid lines every 64px at `rgba(18,22,25,0.045)` (offset 32px, 26px, so the rail's left edge sits on a line), and a soft white glow near the top left (`radial-gradient(460px 300px at 580px 210px, rgba(255,255,255,.85), transparent 70%)`).
- **Type** IBM Plex Sans (300/400/500/600/700) + IBM Plex Mono (400/500/600). Nothing else. Ink `#121619`, muted `#4d5358`, faint `#8d9196`.
- **One accent** — the style's (`VIDEO.accent`; Carbon blue `#0f62fe` by default) — for the step number, the active progress segment, the focus ring, the title rule, chip dots and the docs link.

**Title card**: the wordmark at 150px/600, centered; a 320×3px blue rule under it that draws out from the center; tagline at 46px/300; then a mono line, 20px, uppercase, 0.2em tracking, muted.

**Step layout**, with the left rail at x=96, 470px wide:
- The wordmark, 44px/600, top left.
- At y=378: eyebrow, a 28×2px blue dash, then mono 20px `STEP 03` in blue and `/ 06` faint. Under it the step title at 60px/400, tracking −0.02em, and under that the body at 24px/400 muted, line-height 1.5.
- At the bottom: the demo label in mono 16px uppercase, 0.12em tracking, and under it one 4px segment per step. Finished steps are ink, the current one fills blue as the step plays, and later ones are `#dde1e6`.
- **Window**: x=635, y=91, 1204×898, white, radius 12, shadow `0 24px 60px rgba(18,22,25,.10), 0 2px 6px rgba(18,22,25,.06)`, hairline `rgba(18,22,25,.06)`. No browser chrome or wallpaper. The product inside is authored at real desktop size, **1280×955**, and framed by a camera (§3).

**Focus ring**: a 2px `#0f62fe` border, 5px outside the element, radius 10, with a `0 0 0 4px rgba(15,98,254,.14)` halo. It goes on whatever is being clicked or typed into, from the click until the step moves on.

**Speed badge**: top right inside the window, a dark pill `rgba(22,22,22,.88)` 44px tall, with a white double-play glyph and `4×` in 22px/600.

**Payoff**: the rail fades out and the window grows to x=291, y=41, 1338×998, centered. Show the result itself, full width.

**End card**: the wordmark at 120px/600, the closer at 46px/300, four chips (white, 1px `#dde1e6`, radius 6, mono 20px, a small blue square before each label), then the link in mono 600 in the accent.

Inline styles only; no CSS classes. Keep data (names, channels, messages) realistic and consistent across shots: the same agent name, channel and user everywhere.

## 3. Motion system

```js
const MOTION = { enter: easeOutCubic, draw: easeInOutQuart, pop: easeOutBack, glide: easeInOutSine };
const tw = (T, start, dur, ease = MOTION.enter) => ease(clamp((T - start) / dur, 0, 1));
```
- **Title card**: wordmark fades and rises 20px, the rule draws out over 0.8s, the tagline follows at 0.6s, the mono line at 1.3s. Fade out over the last 0.4s.
- **First step**: wordmark and footer fade in over 0.6s, and the window rises 24px into place.
- **Between steps** the window frame and rail chrome stay put. Only the rail's step text changes (out over 0.35s, in over 0.5s with a 14px rise) and the window's content crossfades (0.25s).
- **Camera**: `camera: T => [zoom, focusX, focusY]` in app px, keyframed with `keyPath`. Zoom 1 fits the whole app. Use 1.3–1.6 to read a form or a chat message. Pan between targets over 1–1.5s with nothing else moving. Hold still while the cursor works.
- **Payoff**: window grows over 0.9s while the rail fades, then the page scrolls slowly (`translateY` inside the app, 4–5s). For the last 1s it fades out with a 6px blur while the end card fades in, so the two overlap .
- **End card**: wordmark 0.9s, closer at 0.4s, chips staggered 0.1s from 0.8s, link at 1.3s.
- **Cursor**: `LiveCursor` keys are `[t, 'data-t name', dx, dy]` or `[t, x, y]`, re-measured every frame, so it stays on target through scrolls and camera moves. It's drawn at a constant screen size whatever the zoom. Arrive 0.1–0.35s before a click. The click is a 0.45s blue ring plus the arrow at 0.88 scale.
- **Typing**: type only short values (≤20 chars). Longer text, like a prompt or a URL, appears pre-filled or pastes in at once. Precompute per-char times with `typeTimes`. Blinking caret at 2Hz when idle, solid while typing.
- **Speed badge**: `speed: [[start, end, '4×']]` on the shot. It fades in over 0.25s, and the compressed wait plays underneath it.
- **Pacing**: a click lands and its result shows within 0.5s. Hold ~1s after each state change, and up to 2s where there's text to read.
- Never use CSS animations/transitions or `Date.now()`. Everything derives from `T`, so frame N always looks identical.

## 4. Shot anatomy

```jsx
SHOTS.push({
  name: 'Configure', layout: 'step', total: 11,
  step: { title: 'Name it and share it', body: 'Give it a title and choose who can see it.' },
  camera: T => keyPath(T, [[0, 1.5, 640, 260], [5.6, 1.5, 640, 260], [7.0, 1.5, 640, 420]]),
  speed: [],                                    // e.g. [[0.4, 3.4, '4×']] for a boot wait
  Piece() {
    const { T, total } = useShot();
    // derive all state from T: typed text, which screen, scroll offset
    return <AppRoot>{/* 1280x955 UI recreated from the product's source */}
      <Focus t="name" p={tw(T, 1.0, 0.25)} />
      <LiveCursor clicks={[1.0, 8.4]} keys={[[0, 800, 300], [0.85, 'name', 0.3], [8.25, 'create']]} />
    </AppRoot>;
  },
});
```
`layout` is `title | step | payoff | outro`. Put `data-t="name"` on anything the cursor or the focus ring targets. State is computed, not stored: `const picked = T >= cPick; const typed = NAME.slice(0, typedCount(T, start, TT));`. The per-video strings (tagline, mono demo line, rail label, closer, chips, link) live in `VIDEO` at the top of the template.

## 5. Copy guidance

- **Step title**: 2–5 words, starting with a verb ("Pick a template", "Review the plan", "Get the results").
- **Rail body**: one or two short sentences, ≤20 words, saying what happens and the one product fact worth noticing. Bad: "Seamless, secure integrations."
- **Demo line and rail label** name the example, not the product: "DEMO · A PRICING STUDY" / "EXAMPLE · PRICING STUDY".
- **Tagline and closer** come from the product's own positioning (its README, site or the user); ask when there is none rather than writing marketing.
- Use the product's real nouns, and check every claim against the code or the screenshots before it goes on screen.

## 6. Rendering

`design video` drives the page through `window.__ready`, `window.__duration` and `window.__setTime(t)` (a promise that resolves after paint): it sets each frame's time, screenshots at 1920×1080 and pipes the frames to ffmpeg (H.264, yuv420p, CRF 18, faststart), optionally looping and mixing music at 18% with a 2s fade-in and 3s fade-out. 30fps. `?shot=Name` on the page path renders one shot. React, Babel and the fonts come from `vendor/`, so nothing loads from a CDN.
