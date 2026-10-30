#!/usr/bin/env bash
# The Desk server's Login item (kit.yaml → startupItems): openrc's supervise-daemon
# runs this at every boot and restarts it when it exits.
exec node "$HOME/desk/server.mjs"
