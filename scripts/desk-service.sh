#!/usr/bin/env bash
# desk-service.sh install|check — the Desk server's and the Desk Satellite's Login items for
# an agent created without the kit, or before the Satellite (the kit's startupItems write the
# same services at create). install writes ~/.config/rc/init.d/design-desk-server and
# design-desk-satellite, links them into the default runlevel and starts them; it never
# replaces a script already there.
set -u
HOME_DIR="${HOME:-/home/agent}"
service() { # <name> <command> <description>
  local svc="$HOME_DIR/.config/rc/init.d/$1"
  if [ ! -f "$svc" ]; then
    mkdir -p "$(dirname "$svc")" "$HOME_DIR/.config/rc/runlevels/default"
    printf '#!/sbin/openrc-run\ndescription="%s"\ncommand="%s"\n' "$3" "$2" > "$svc"
    chmod +x "$svc"
    ln -sf "$svc" "$HOME_DIR/.config/rc/runlevels/default/$1"
  fi
  rc-service --user "$1" start >/dev/null 2>&1 || rc-service --user "$1" restart >/dev/null 2>&1 || true
}
case "${1:-check}" in
  install)
    service design-desk-server "$HOME_DIR/desk/serve.sh" "Design Desk: the Desk's store and API on the Artifact API port"
    service design-desk-satellite "$HOME_DIR/desk/satellite.sh" "Design Desk: the Desk's MCP server for the owner's other agents (docs/mcp.md)"
    sleep 1
    if curl -sf --max-time 3 http://127.0.0.1:5555/health >/dev/null; then echo "ok   desk server answers on 127.0.0.1:5555"; else echo "FAIL desk server does not answer — rc-service --user design-desk-server status; log ~/.local/state/rc/design-desk-server.log"; exit 1; fi;;
  check)
    if curl -sf --max-time 3 http://127.0.0.1:5555/health >/dev/null; then echo "ok   desk server answers"; else echo "FAIL desk server does not answer"; exit 1; fi;;
  *) echo "usage: desk-service.sh install|check"; exit 2;;
esac
