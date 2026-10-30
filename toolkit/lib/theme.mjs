// The fallback design system: a Tailwind v4 theme whose tokens come from Carbon's
// own token package (@carbon/themes, White and G100), so nothing is copied by hand.
// A saved brand (work/brand/brand.json) overrides the accent, ink, fonts and radius.
// Markup uses shadcn-style token classes — bg-background, text-foreground, bg-primary,
// text-primary-foreground, bg-muted, text-muted-foreground, border-border, bg-card,
// bg-accent, text-accent, ring-ring, bg-destructive, text-success, text-warning — so a
// prototype written for Carbon re-skins to a brand with no markup change.
import { req } from "./core.mjs";

const hexToRgb = (h) => { const m = h.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m ? m.slice(1).map((x) => parseInt(x, 16)) : null; };
const lum = (h) => { const c = hexToRgb(h); if (!c) return 0; const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const onColor = (bg) => (contrast(bg, "#ffffff") >= contrast(bg, "#161616") ? "#ffffff" : "#161616");
const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); if (!x || !y) return a; return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join(""); };

export function tokens(brand = null) {
  const { white: w, g100: g } = req("@carbon/themes");
  const accent = brand?.colors?.accent || w.interactive;
  const accentDark = brand?.colors?.accentDark || (brand?.colors?.accent ? mix(brand.colors.accent, "#ffffff", 0.25) : g.interactive);
  const ink = brand?.colors?.ink || w.textPrimary;
  // Carbon's primary button is blue. A brand may make it its ink instead (DAM-style black).
  const primary = brand?.colors?.primary || accent;
  const primaryDark = brand?.colors?.primaryDark || (brand?.colors?.primary ? (brand.colors.primary === ink ? g.textPrimary : mix(brand.colors.primary, "#ffffff", 0.25)) : accentDark);
  const light = {
    background: brand?.colors?.background || w.background, foreground: ink,
    card: w.layer02, "card-foreground": ink, popover: w.layer02, "popover-foreground": ink,
    primary, "primary-foreground": onColor(primary),
    secondary: w.layer01, "secondary-foreground": ink,
    muted: w.layer01, "muted-foreground": w.textSecondary,
    subtle: w.textHelper,
    accent, "accent-foreground": onColor(accent), "accent-soft": mix(accent, "#ffffff", 0.88),
    border: w.borderSubtle00, "border-strong": w.borderStrong01, input: w.borderStrong01, ring: accent,
    destructive: w.supportError, "destructive-foreground": "#ffffff",
    success: w.supportSuccess, warning: "#b28600", info: w.supportInfo,
    layer: w.layer01, "layer-hover": w.layerHover01, highlight: w.highlight,
  };
  const dark = {
    background: brand?.colors?.backgroundDark || g.background, foreground: g.textPrimary,
    card: g.layer01, "card-foreground": g.textPrimary, popover: g.layer02, "popover-foreground": g.textPrimary,
    primary: primaryDark, "primary-foreground": onColor(primaryDark),
    secondary: g.layer01, "secondary-foreground": g.textPrimary,
    muted: g.layer01, "muted-foreground": g.textSecondary,
    subtle: g.textHelper,
    accent: accentDark, "accent-foreground": onColor(accentDark), "accent-soft": mix(accentDark, "#161616", 0.8),
    border: g.borderSubtle00, "border-strong": g.borderStrong01, input: g.borderStrong01, ring: accentDark,
    destructive: g.supportError, "destructive-foreground": "#ffffff",
    success: g.supportSuccess, warning: g.supportWarning, info: g.supportInfo,
    layer: g.layer01, "layer-hover": g.layerHover01, highlight: g.highlight,
  };
  const fonts = {
    sans: brand?.fonts?.sans || "IBM Plex Sans",
    mono: brand?.fonts?.mono || "IBM Plex Mono",
  };
  const radius = brand?.radius ?? "0.25rem"; // Carbon is near-square; a brand may round it
  return { light, dark, fonts, radius };
}

// Tailwind v4 input CSS for the fallback system.
export function themeCss(brand = null) {
  const { light, dark, fonts, radius } = tokens(brand);
  const vars = (o) => Object.entries(o).map(([k, v]) => `  --${k}: ${v};`).join("\n");
  const colorNames = Object.keys(light);
  return `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
:root {
${vars(light)}
  --radius: ${radius};
}
.dark {
${vars(dark)}
}
@theme inline {
${colorNames.map((k) => `  --color-${k}: var(--${k});`).join("\n")}
  --font-sans: "${fonts.sans}", system-ui, sans-serif;
  --font-mono: "${fonts.mono}", ui-monospace, monospace;
  --radius-sm: calc(var(--radius) * 0.5);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) * 1.5);
  --radius-xl: calc(var(--radius) * 2);
}
@layer base {
  * { border-color: var(--color-border); }
  html { font-family: var(--font-sans); color: var(--color-foreground); background: var(--color-background); -webkit-font-smoothing: antialiased; }
  code, kbd, pre, samp { font-family: var(--font-mono); }
}
`;
}

// Inline-style palette for decks and videos (they use inline styles, not classes).
export function palette(brand = null) {
  const { light, dark, fonts } = tokens(brand);
  return {
    canvas: brand?.colors?.canvas || "#f4f4f4", surface: "#ffffff", ink: light.foreground,
    secondary: "#525252", tertiary: "#6f6f6f", hairline: "#e0e0e0",
    accent: light.accent, accentMuted: mix(light.accent, "#ffffff", 0.6), accentOnDark: dark.accent,
    success: light.success, warning: dark.warning, danger: light.destructive,
    sans: fonts.sans, mono: fonts.mono,
  };
}
