#!/usr/bin/env bash
# The fallback theme: Carbon tokens by default, a brand's overrides when given, and
# readable text on every primary/accent it produces.
. "$(dirname "$0")/lib.sh"
need_node
[ -d "$ROOT/toolkit/node_modules/@carbon/themes" ] || { echo "  skip: toolkit not installed (bash scripts/install-toolkit.sh)"; exit 0; }
out="$(node --input-type=module -e "
  const m = await import('$ROOT/toolkit/lib/theme.mjs');
  const c = m.tokens(), b = m.tokens({ colors: { accent: '#8a3ffc', primary: '#161616' }, fonts: { sans: 'Inter' }, radius: '0.5rem' }), y = m.tokens({ colors: { accent: '#f1c21b' } });
  const css = m.themeCss();
  console.log(JSON.stringify({
    carbonAccent: c.light.accent, carbonPrimary: c.light.primary, carbonBg: c.dark.background,
    brandAccent: b.light.accent, brandPrimary: b.light.primary, brandFg: b.light['primary-foreground'], brandSans: b.fonts.sans, brandRadius: b.radius,
    yellowFg: y.light['accent-foreground'],
    contrastOk: [c, b, y].every(t => m.contrast(t.light.primary, t.light['primary-foreground']) >= 4.5 || m.contrast(t.light.primary, t.light['primary-foreground']) >= 3),
    hasTheme: css.includes('@theme inline') && css.includes('--color-primary: var(--primary)') && css.includes('.dark {'),
  }));")"
printf '%s' "$out" | jq -e '.carbonAccent=="#0f62fe" and .carbonPrimary=="#0f62fe" and .carbonBg=="#161616"
  and .brandAccent=="#8a3ffc" and .brandPrimary=="#161616" and .brandFg=="#ffffff" and .brandSans=="Inter" and .brandRadius=="0.5rem"
  and .yellowFg=="#161616" and .contrastOk and .hasTheme' >/dev/null || { echo "  unexpected tokens: $out"; exit 1; }
