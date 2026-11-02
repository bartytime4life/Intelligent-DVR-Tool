#!/usr/bin/env bash
# Open the local training workspace. Camera access still requires a user action.
exec bash "$(dirname -- "$0")/scripts/run-linux.sh" --train "$@"
