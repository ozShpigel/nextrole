#!/bin/sh
# Render mounts Secret Files with permissions only root can read, but nginx's
# worker processes (which actually check auth_basic_user_file per-request)
# run as the unprivileged `nginx` user — so they get "Permission denied"
# trying to open /etc/secrets/.htpasswd directly. This script runs as root
# (docker-entrypoint.d scripts execute before nginx drops privileges), so it
# can copy the file to a location nginx's worker can read.
set -e
if [ -f /etc/secrets/.htpasswd ]; then
    cp /etc/secrets/.htpasswd /etc/nginx/.htpasswd
    chmod 644 /etc/nginx/.htpasswd
fi
