#!/usr/bin/env bash
# Peer check: a changed used trigger is reported as work for the operator, never
# silently adopted; an unchanged published card passes.
. "$(dirname "$0")/lib.sh"
mkdir -p "$WORK_DIR/peers" "$SANDBOX/bin"
cp "$ROOT/scripts/tests/fixtures/manifest.json" "$WORK_DIR/peers/karel.json"
old="$(bash "$ROOT/scripts/manifest-check.sh" stamp "$WORK_DIR/peers/karel.json")"
cp "$WORK_DIR/peers/karel.json" "$SANDBOX/live.json"
cat > "$SANDBOX/bin/curl" <<EOF
#!/usr/bin/env bash
while [ \$# -gt 0 ]; do case "\$1" in -o) out=\$2; shift 2;; --max-time|--max-filesize) shift 2;; *) shift;; esac; done
cp "$SANDBOX/live.json" "\$out"
EOF
chmod +x "$SANDBOX/bin/curl"
cat > "$WORK_DIR/PEERS.md" <<EOF
| name | role | manifest_url | pinned_version | uses |
|------|------|--------------|----------------|------|
| karel | implementer | https://example.test/karel/raw | $old | chat-request |
EOF
out="$(PATH="$SANDBOX/bin:$PATH" WORK_DIR="$WORK_DIR" AGENT_HOME="$ROOT" bash "$ROOT/scripts/peer-check.sh" "$WORK_DIR/PEERS.md")" || true
printf '%s' "$out" | jq -e '.ok == 1 and .fail == 0 and (.peers[0].status == "ok")' >/dev/null || { echo "  x unchanged peer should pass: $out"; FAILS=$((FAILS+1)); }
jq '.triggers["chat-request"].value = "a changed request"' "$SANDBOX/live.json" > "$SANDBOX/new.json"
mv "$SANDBOX/new.json" "$SANDBOX/live.json"
bash "$ROOT/scripts/manifest-check.sh" stamp "$SANDBOX/live.json" >/dev/null
out="$(PATH="$SANDBOX/bin:$PATH" WORK_DIR="$WORK_DIR" AGENT_HOME="$ROOT" bash "$ROOT/scripts/peer-check.sh" "$WORK_DIR/PEERS.md")" && { echo "  x a changed used id must fail: $out"; FAILS=$((FAILS+1)); }
printf '%s' "$out" | jq -e '.fail == 1 and .peers[0].status == "fail"' >/dev/null || { echo "  x the failure must name the peer: $out"; FAILS=$((FAILS+1)); }
finish
