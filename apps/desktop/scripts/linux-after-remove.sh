#!/bin/sh
set -e

if [ -L /usr/bin/devdock ] && [ "$(readlink /usr/bin/devdock)" = "/opt/DevDock/devdock" ]; then
  rm -f /usr/bin/devdock
elif [ -f /usr/bin/devdock ] && grep -q "DevDock launcher managed by the devdock package" /usr/bin/devdock; then
  rm -f /usr/bin/devdock
fi
