#!/usr/bin/env bash
# design build: a Carbon and a wireframe build succeeds and inlines everything; each forbidden shape fails
# with its message. Offline (Carbon needs no repo).
. "$(dirname "$0")/lib.sh"
need_node
[ -d "$ROOT/toolkit/node_modules/tailwindcss" ] || { echo "  skip: toolkit not installed (bash scripts/install-toolkit.sh)"; exit 0; }
T="$SANDBOX"
export DESIGN_DESK_SCRATCH="$T/scratch" DESIGN_DESK_DATA="$T/data"
D="node $ROOT/toolkit/bin/design.mjs"
page() { cat > "$T/$1.src.html" <<H
<!doctype html><html lang="en" data-review-title="t"><head><meta charset="utf-8"><title>t</title><!-- design:css --></head>
<body><!-- design:review-bar --><div data-view="1" data-view-name="A" class="p-4 bg-background">$2</div></body></html>
H
}
fail=0
page ok '<button class="rounded-md bg-primary px-3 text-primary-foreground mb-8 mb-0"><ui-icon name="Add" size="16"/>Add</button>'
if out="$($D build "$T/ok.src.html" "$T/ok.html" --style carbon 2>&1)"; then
  grep -q 'class="rounded-md bg-primary px-3 text-primary-foreground mb-0"' "$T/ok.html" || { echo "  cn() merge not applied"; fail=1; }
  grep -q '<svg' "$T/ok.html" || { echo "  icon not rendered"; fail=1; }
  grep -q 'font-family:"IBM Plex Sans"' "$T/ok.html" || { echo "  fonts not inlined"; fail=1; }
  grep -q '\.bg-primary' "$T/ok.html" || { echo "  utility not compiled"; fail=1; }
  grep -qE 'fonts\.googleapis|unpkg|jsdelivr' "$T/ok.html" && { echo "  references a CDN"; fail=1; }
  grep -q 'data-review-style="Style: IBM Carbon' "$T/ok.html" || { echo "  style label missing"; fail=1; }
else echo "  carbon build failed: $out"; fail=1; fi
page wf '<button class="rounded-md bg-primary px-3 text-primary-foreground">Add</button>'
if out="$($D build "$T/wf.src.html" "$T/wf.html" --style wireframe 2>&1)"; then
  grep -q 'data-review-style="Style: wireframe' "$T/wf.html" || { echo "  wireframe label missing"; fail=1; }
else echo "  wireframe build failed: $out"; fail=1; fi
expect_fail() { # name, markup, message fragment
  page "$1" "$2"
  if out="$($D build "$T/$1.src.html" "$T/$1.html" --style carbon 2>&1)"; then echo "  $1: built, should have failed"; fail=1
  else printf '%s' "$out" | grep -q -- "$3" || { echo "  $1: wrong message: $out"; fail=1; }; fi
}
expect_fail icon '<ui-icon name="NoSuchIconXyz"/>' 'no icon "NoSuchIconXyz"'
expect_fail style '<p style="color:red">x</p>' 'hand styling'
expect_fail block '<style>p{color:red}</style>' 'a <style> block'
expect_fail amp '<p class="[&amp;_svg]:size-4">x</p>' 'write "&" literally'
expect_fail script '<script>if (</script>' 'does not parse'
expect_fail comp '<ui-component src="x.tsx"/>' 'needs --style repo'
exit $fail
