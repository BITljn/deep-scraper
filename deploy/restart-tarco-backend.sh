#!/bin/sh
set -eu

SERVICE_NAME="tarco-backend.service"

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_root systemctl restart "${SERVICE_NAME}"
run_as_root systemctl status "${SERVICE_NAME}" --no-pager
