#!/usr/bin/env bash
# Build Sparmin, ready to side-load. Outputs bin/Sparmin-<device>.prg.
#
#   ./build.sh          build the primary side-load targets (vivoactive5, fr745)
#   ./build.sh test     + the unit-test binary (bin/Sparmin-test.prg)
#   ./build.sh fleet    compile-check ONE device per screen family (all 15)
#   ./build.sh all      fleet + test
#
# "fleet" verifies every resources-<deviceFamily>/ folder resolves and the app
# compiles across the whole supported range without building all 120 products.
set -euo pipefail
cd "$(dirname "$0")"

SDK="$(head -n1 "$HOME/.Garmin/ConnectIQ/current-sdk.cfg" | sed 's:/*$::')"
KEY="$HOME/.Garmin/ConnectIQ/developer_key"
MC="$SDK/bin/monkeyc"
mkdir -p bin

# Devices actually side-loaded onto a real watch.
PRIMARY=(vivoactive5 fr745)

# One representative device per screen family — a proxy for every device sharing
# its resources-<deviceFamily>/ folder. Keep in sync with tools/rasterise-icons.sh.
FLEET=(
    venusq venusq2 venux1                                  # rectangle 240 / 320x360 / 448x486
    fr55 fenix5s fr745 fenix7 fenix7x                      # round 208 / 218 / 240 / 260 / 280
    venu2s vivoactive5 venu2 fr965                         # round 360 / 390 / 416 / 454
    instinct2s instincte40mm instinct2                     # semioctagon 163 / 166 / 176
)

build() {
    local dev="$1"
    echo ">> building $dev"
    "$MC" -f monkey.jungle -o "bin/Sparmin-$dev.prg" -y "$KEY" -d "$dev" -w
}

mode="${1:-}"
case "$mode" in
    fleet|all) for dev in "${FLEET[@]}"; do build "$dev"; done ;;
    *)         for dev in "${PRIMARY[@]}"; do build "$dev"; done ;;
esac

if [ "$mode" = "test" ] || [ "$mode" = "all" ]; then
    echo ">> building unit-test binary (vivoactive5)"
    "$MC" -f monkey.jungle -o "bin/Sparmin-test.prg" -y "$KEY" -d vivoactive5 -w --unit-test
fi

echo "done:"
ls -1 bin/Sparmin-*.prg
