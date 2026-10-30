# Class vocabulary for brand and Carbon mode

Read when building without a repo (`--style brand` or `--style carbon`). In repo mode use the
repo's own classes instead — they are already in its CSS.

The fallback system is Tailwind v4 with every default utility, plus these tokens. They come from
Carbon's own token package (White and G100 themes); a saved brand replaces the accent, ink,
primary, fonts and radius. Write markup with these names and the same file re-skins between
brand and Carbon with no change.

| Use | Class |
|---|---|
| Page background, text | `bg-background text-foreground` |
| Raised surface (cards, panels, popovers) | `bg-card text-card-foreground`, `bg-popover` |
| Quiet surface (sidebars, wells, table headers) | `bg-muted`, `bg-layer`, hover `hover:bg-layer-hover` |
| Secondary text | `text-muted-foreground`; helper/caption `text-subtle` |
| Hairlines | `border-border`; inputs `border-input`; emphasis `border-border-strong` |
| Primary action | `bg-primary text-primary-foreground` (Carbon: blue; a brand may make it its ink) |
| Accent: links, active nav, selected | `text-accent`, `bg-accent text-accent-foreground`, soft fill `bg-accent-soft` |
| Focus | `ring-ring` (`focus-visible:ring-2 ring-ring`) |
| Danger | `bg-destructive text-destructive-foreground`, `text-destructive` |
| Status | `text-success`, `text-warning`, `text-info`; highlight fill `bg-highlight` |
| Radius | `rounded-sm` `rounded-md` (the base) `rounded-lg` `rounded-xl` |
| Type | `font-sans` (body), `font-mono` (ids, code, numbers — add `tabular-nums`) |

Dark mode: `.dark` on `<html>` (the review bar's toggle) swaps every token; never write `dark:`
color overrides for these tokens.

## Carbon's taste, when the style is Carbon

- **Near-square corners** (`rounded-sm`/`rounded-md` are 2–4px). Don't round Carbon into pills.
- **Primary is blue; one primary button per view.** Secondary actions are `bg-layer` or a
  `border-border-strong` ghost.
- **Color has meaning:** blue = interactive, red = error and destructive, green = success,
  yellow/amber = warning. A risky-but-reversible action is a warning (amber icon, normal
  button), never red.
- **Type does the hierarchy:** IBM Plex Sans; light (300) for large display text, 400 body,
  600 for headings and emphasis — never bold a whole paragraph. Mono for anything a machine
  produced.
- **Spacing on an 8px grid** (`p-2` `p-4` `p-6` `p-8`, `gap-2` `gap-4`); 16px page gutters on
  narrow views, 32px on wide.
- **Restraint:** the smallest clean change; no gradients, no decorative shadows, no emoji.

## A brand's taste

Read `design brand show`. Use its accent for one thing per view (the primary action or the
active state), its radius as given, its fonts everywhere. If the brand has a notes field, it
outranks this file.
