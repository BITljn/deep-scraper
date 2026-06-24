#!/bin/sh
set -eu

SERVICE_NAME="tarco-backend.service"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
SERVICE_SOURCE="${SCRIPT_DIR}/${SERVICE_NAME}"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}"

if [ ! -f "${SERVICE_SOURCE}" ]; then
  echo "Service file not found: ${SERVICE_SOURCE}" >&2
  exit 1
fi

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_root install -m 0644 "${SERVICE_SOURCE}" "${SERVICE_TARGET}"
run_as_root systemctl daemon-reload
run_as_root systemctl enable --now "${SERVICE_NAME}"
run_as_root systemctl status "${SERVICE_NAME}" --no-pager
