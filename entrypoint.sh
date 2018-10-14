#!/bin/sh

set -e

if [ ! -z "${ID_RSA}" ]; then
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
    echo "${ID_RSA}" > "${HOME}/.ssh/id_rsa"
    chmod 600 "${HOME}/.ssh/id_rsa"
    echo "Written '${HOME}/.ssh/id_rsa'"
fi

if [ ! -z "${KNOWN_HOSTS}" ]; then
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
    echo "${KNOWN_HOSTS}" > "${HOME}/.ssh/known_hosts"
    echo "Written '${HOME}/.ssh/known_hosts'"
fi

exec storybook-branches \
    --port "${PORT:-9001}" \
    --sleep "${SLEEP:-60}" \
    --default "${DEFAULT}" \
    --branches "${BRANCHES:-.+}" \
    --dir "${DIR:-.}" \
    "${REPOSITORY}" "${OUTPUT:-dist}"
