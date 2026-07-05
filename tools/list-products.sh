#!/usr/bin/env bash
# List every Connect IQ wrist-watch device that (a) supports watch-apps and
# (b) has firmware meeting the manifest minApiLevel, grouped-free and sorted —
# ready to paste into manifest.xml's <iq:products>. Edge cycling computers and
# handheld GPS units are excluded (not "watches"). Old watches whose max CIQ
# firmware is below MIN_API are dropped automatically.
#
# Usage: tools/list-products.sh [minApiLevel]   (default 3.1.0)
set -euo pipefail
MIN="${1:-3.1.0}"
DEVICES="$HOME/.Garmin/ConnectIQ/Devices"
[ -d "$DEVICES" ] || { echo "no SDK Devices dir at $DEVICES"; exit 1; }

MIN="$MIN" python3 - "$DEVICES" <<'EOF'
import json,os,sys
DEV=sys.argv[1]
def vt(s):
    p=[int(x) if x.isdigit() else 0 for x in s.split('.')]
    while len(p)<3: p.append(0)
    return tuple(p[:3])
MIN=vt(os.environ["MIN"])
# Non-watch screen families (Edge / handheld GPS) and watch families with no
# firmware meeting MIN — excluded from the store listing.
NONWATCH={'rectangle-200x265','rectangle-240x320','rectangle-240x400',
          'rectangle-246x322','rectangle-282x470','rectangle-420x600',
          'rectangle-480x800','rectangle-148x205','rectangle-205x148',
          'semiround-215x180'}
out=[]
for d in sorted(os.listdir(DEV)):
    f=os.path.join(DEV,d,'compiler.json')
    if not os.path.isfile(f): continue
    j=json.load(open(f))
    at=j.get('appTypes',[]); names=[a.get('type') for a in at] if at and isinstance(at[0],dict) else at
    if 'watchApp' not in names: continue
    if j.get('deviceFamily') in NONWATCH: continue
    mx=(0,0,0)
    for pn in j.get('partNumbers',[]) or []:
        v=pn.get('connectIQVersion')
        if v: mx=max(mx,vt(v))
    if mx>=MIN: out.append(d)
for d in out:
    print(f'            <iq:product id="{d}"/>')
print(f"<!-- {len(out)} devices -->", file=sys.stderr)
EOF
