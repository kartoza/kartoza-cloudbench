#!/bin/bash
set -e

KEY_DIR=/etc/ssh/host-keys
mkdir -p "$KEY_DIR"

# Generate SSH host keys on first start; volume keeps them stable across rebuilds
for type in rsa ecdsa ed25519; do
    key="$KEY_DIR/ssh_host_${type}_key"
    [ -f "$key" ] || ssh-keygen -q -t "$type" -f "$key" -N ""
done

exec /usr/sbin/sshd -D \
    -o "HostKey=$KEY_DIR/ssh_host_rsa_key" \
    -o "HostKey=$KEY_DIR/ssh_host_ecdsa_key" \
    -o "HostKey=$KEY_DIR/ssh_host_ed25519_key"
