#!/bin/sh
set -eu

SERVICE_NAME="tarco-backend.service"
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
BACKEND_SOURCE="$(CDPATH= cd "${SCRIPT_DIR}/../backend" && pwd)"
SERVICE_SOURCE="${SCRIPT_DIR}/${SERVICE_NAME}"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}"
TARCO_USER="${TARCO_USER:-kevin}"
TARCO_GROUP="${TARCO_GROUP:-${TARCO_USER}}"
TARCO_USER_HOME="$(getent passwd "${TARCO_USER}" | cut -d: -f6)"
TARCO_HOME="${TARCO_HOME:-${TARCO_USER_HOME}/tarco}"
BIN_DIR="${TARCO_HOME}/bin"
CONF_DIR="${TARCO_HOME}/conf"
LOG_DIR="${TARCO_HOME}/log"
BACKEND_INSTALL="${BIN_DIR}/backend"
VENV_DIR="${BIN_DIR}/venv"
ENTRYPOINT="${BIN_DIR}/tarco-backend"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [ ! -f "${SERVICE_SOURCE}" ]; then
  echo "Service file not found: ${SERVICE_SOURCE}" >&2
  exit 1
fi

if [ ! -d "${BACKEND_SOURCE}" ]; then
  echo "Backend source not found: ${BACKEND_SOURCE}" >&2
  exit 1
fi

if ! getent passwd "${TARCO_USER}" >/dev/null; then
  echo "User not found: ${TARCO_USER}" >&2
  exit 1
fi

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_user() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "${TARCO_USER}" -- "$@"
  else
    "$@"
  fi
}

run_as_root install -d -m 0755 -o "${TARCO_USER}" -g "${TARCO_GROUP}" "${TARCO_HOME}" "${BIN_DIR}" "${CONF_DIR}" "${LOG_DIR}"

if [ ! -d "${VENV_DIR}" ]; then
  run_as_user "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

run_as_user "${VENV_DIR}/bin/python" -m pip install --upgrade pip
run_as_user "${VENV_DIR}/bin/pip" install -r "${BACKEND_SOURCE}/requirements.txt"

rm -rf "${BACKEND_INSTALL}.tmp"
run_as_user mkdir -p "${BACKEND_INSTALL}.tmp"
run_as_user cp -R "${BACKEND_SOURCE}/app" "${BACKEND_INSTALL}.tmp/"
run_as_user cp -R "${BACKEND_SOURCE}/alembic" "${BACKEND_INSTALL}.tmp/"
run_as_user cp -R "${BACKEND_SOURCE}/tools" "${BACKEND_INSTALL}.tmp/"
run_as_user cp "${BACKEND_SOURCE}/alembic.ini" "${BACKEND_INSTALL}.tmp/"
run_as_user cp "${BACKEND_SOURCE}/requirements.txt" "${BACKEND_INSTALL}.tmp/"
run_as_user "${VENV_DIR}/bin/python" -m compileall -q "${BACKEND_INSTALL}.tmp/app" "${BACKEND_INSTALL}.tmp/tools"

rm -rf "${BACKEND_INSTALL}.previous"
if [ -d "${BACKEND_INSTALL}" ]; then
  mv "${BACKEND_INSTALL}" "${BACKEND_INSTALL}.previous"
fi
mv "${BACKEND_INSTALL}.tmp" "${BACKEND_INSTALL}"

if [ ! -f "${CONF_DIR}/backend.env" ]; then
  if [ -f "${BACKEND_SOURCE}/.env" ]; then
    run_as_user cp "${BACKEND_SOURCE}/.env" "${CONF_DIR}/backend.env"
  else
    run_as_user cp "${BACKEND_SOURCE}/.env.example" "${CONF_DIR}/backend.env"
  fi
fi
awk '!/^(TARCO_HOME|LOG_DIR)=/' "${CONF_DIR}/backend.env" > "${CONF_DIR}/backend.env.tmp"
{
  printf 'TARCO_HOME=%s\n' "${TARCO_HOME}"
  printf 'LOG_DIR=%s\n' "${LOG_DIR}"
} >> "${CONF_DIR}/backend.env.tmp"
mv "${CONF_DIR}/backend.env.tmp" "${CONF_DIR}/backend.env"
run_as_root chown "${TARCO_USER}:${TARCO_GROUP}" "${CONF_DIR}/backend.env"
run_as_root chmod 0600 "${CONF_DIR}/backend.env"

cat > "${ENTRYPOINT}" <<'EOF'
#!/bin/sh
set -eu

TARCO_HOME="${TARCO_HOME:-$HOME/tarco}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

cd "${TARCO_HOME}/bin/backend"
exec "${TARCO_HOME}/bin/venv/bin/uvicorn" app.main:app --host "${HOST}" --port "${PORT}"
EOF
run_as_root chown "${TARCO_USER}:${TARCO_GROUP}" "${ENTRYPOINT}"
run_as_root chmod 0755 "${ENTRYPOINT}"

run_as_root install -m 0644 "${SERVICE_SOURCE}" "${SERVICE_TARGET}"
run_as_root systemctl daemon-reload
run_as_root systemctl enable "${SERVICE_NAME}"
run_as_root systemctl restart "${SERVICE_NAME}"
run_as_root systemctl status "${SERVICE_NAME}" --no-pager
