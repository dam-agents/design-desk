#!/usr/bin/env bash
# desk-service.sh install|check — the Desk server's Login item for an agent created
# without the kit (the kit's startupItems write the same service at create).
# install writes ~/.config/rc/init.d/design-desk-server, links it into the default
# runlevel and starts it; it never replaces a script already there.
set -u
HOME_DIR="${HOME:-/home/agent}"
SVC="$HOME_DIR/.config/rc/init.d/design-desk-server"
case "${1:-check}" in
  install)
    if [ ! -f "$SVC" ]; then
      mkdir -p "$(dirname "$SVC")" "$HOME_DIR/.config/rc/runlevels/default"
      cat > "$SVC" <<SVCEOF
#!/sbin/openrc-run
description="Design Desk: the Desk's store and API on the Artifact API port"
command="$HOME_DIR/desk/serve.sh"
SVCEOF
      chmod +x "$SVC"
      ln -sf "$SVC" "$HOME_DIR/.config/rc/runlevels/default/design-desk-server"
    fi
    rc-service --user design-desk-server start >/dev/null 2>&1 || rc-service --user design-desk-server restart >/dev/null 2>&1 || true
    sleep 1
    if curl -sf --max-time 3 http://127.0.0.1:5555/health >/dev/null; then echo "ok   desk server answers on 127.0.0.1:5555"; else echo "FAIL desk server does not answer — rc-service --user design-desk-server status; log ~/.local/state/rc/design-desk-server.log"; exit 1; fi;;
  check)
    if curl -sf --max-time 3 http://127.0.0.1:5555/health >/dev/null; then echo "ok   desk server answers"; else echo "FAIL desk server does not answer"; exit 1; fi;;
  *) echo "usage: desk-service.sh install|check"; exit 2;;
esac
