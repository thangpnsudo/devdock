#!/bin/sh
set -e

# Ubuntu may restrict unprivileged user namespaces for apps launched by GNOME. Electron then
# requires its packaged SUID sandbox helper; refusing to start is safer than using --no-sandbox.
chown root:root /opt/DevDock/chrome-sandbox
chmod 4755 /opt/DevDock/chrome-sandbox

cat > /usr/bin/devdock <<'EOF'
#!/bin/sh
# DevDock launcher managed by the devdock package.
case "${1:-}" in
  .|agent|codex|claude|claude-code|opencode|help|-h|--help|-help)
    if [ -n "$XDG_CONFIG_HOME" ]; then
      devdock_config_root="$XDG_CONFIG_HOME/@devdock/desktop"
    else
      devdock_config_root="$HOME/.config/@devdock/desktop"
    fi
    ELECTRON_RUN_AS_NODE=1 \
      DEVDOCK_GUI_EXECUTABLE=/opt/DevDock/devdock \
      DEVDOCK_USER_DATA_DIR="$devdock_config_root" \
      DEVDOCK_AGENT_RUNTIME_FILE="$devdock_config_root/agent-runtime.json" \
      exec /opt/DevDock/devdock /opt/DevDock/resources/app.asar/dist-electron/agent-cli.cjs "$@"
    ;;
esac
if [ -n "${DISPLAY:-}" ] && { [ "${XDG_SESSION_TYPE:-}" = "wayland" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
  exec /opt/DevDock/devdock --ozone-platform=x11 --disable-gpu --disable-gpu-sandbox "$@"
fi
exec /opt/DevDock/devdock "$@"
EOF
chmod 0755 /usr/bin/devdock
