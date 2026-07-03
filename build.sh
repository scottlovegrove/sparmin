#!/usr/bin/env bash
# Build Sparmin for both target watches, ready to side-load.
# Outputs bin/Sparmin-<device>.prg. Run ./build.sh (add "test" to also build the
# unit-test binary).
set -euo pipefail
cd "$(dirname "$0")"

SDK="$(head -n1 "$HOME/.Garmin/ConnectIQ/current-sdk.cfg" | sed 's:/*$::')"
KEY="$HOME/.Garmin/ConnectIQ/developer_key"
MC="$SDK/bin/monkeyc"
mkdir -p bin

for dev in vivoactive5 fr745; do
    echo ">> building $dev"
    "$MC" -f monkey.jungle -o "bin/Sparmin-$dev.prg" -y "$KEY" -d "$dev" -w
done

if [ "${1:-}" = "test" ]; then
    echo ">> building unit-test binary (vivoactive5)"
    "$MC" -f monkey.jungle -o "bin/Sparmin-test.prg" -y "$KEY" -d vivoactive5 -w --unit-test
fi

echo "done:"
ls -1 bin/Sparmin-*.prg
