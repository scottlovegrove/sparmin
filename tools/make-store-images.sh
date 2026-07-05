#!/usr/bin/env bash
# Generate the Connect IQ Store listing images from the app art:
#   submission/hero.png   1440x720  (hero banner, <2 MB)
#   submission/cover.png  1440x720  (cover image, <300 KB — same design)
#
# Dark spa banner: the blue/orange split-drop brand mark (from icons/app_icon.svg)
# + "Sparmin" wordmark + tagline, over a band of the real activity icons on
# app-style tiles, laid out hot -> cold. Uses rsvg-convert (ImageMagick's SVG
# renderer drops the icon strokes). Re-run after changing icons/app_icon.svg or
# the activity icons.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found"; exit 1; }

# Activity icons shown in the band, ordered hot -> cold.
BAND=(finnish_sauna steam_room hydro_pool outdoor_cold_plunge ice_cave heated_loungers)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for ic in "${BAND[@]}"; do
    rsvg-convert -w 236 -h 236 "icons/$ic.svg" -o "$tmp/$ic.png"
done

# Build the master SVG (tiles + icon <image> refs injected by geometry).
BAND="${BAND[*]}" TMP="$tmp" python3 - <<'PY'
import os
band=os.environ["BAND"].split(); tmp=os.environ["TMP"]; n=len(band)
x0,y=110,410; tile=170; gap=(1440-2*x0-n*tile)/(n-1); icon=118; pad=(tile-icon)/2
rows=""
for i,name in enumerate(band):
    x=x0+i*(tile+gap)
    rows+=f'    <rect x="{x:.0f}" y="{y}" width="{tile}" height="{tile}" rx="24" fill="#161d24" stroke="#26323b" stroke-width="1.5"/>\n'
    rows+=f'    <image x="{x+pad:.0f}" y="{y+pad:.0f}" width="{icon}" height="{icon}" xlink:href="{tmp}/{name}.png"/>\n'
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1440" height="720" viewBox="0 0 1440 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1e28"/><stop offset="1" stop-color="#04080b"/>
    </linearGradient>
    <radialGradient id="warm" cx="0.12" cy="0.18" r="0.5">
      <stop offset="0" stop-color="#F5822A" stop-opacity="0.16"/><stop offset="1" stop-color="#F5822A" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cool" cx="0.9" cy="0.85" r="0.6">
      <stop offset="0" stop-color="#37A6E0" stop-opacity="0.18"/><stop offset="1" stop-color="#37A6E0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1440" height="720" fill="url(#bg)"/>
  <rect width="1440" height="720" fill="url(#warm)"/>
  <rect width="1440" height="720" fill="url(#cool)"/>
  <g transform="translate(96,74) scale(1.75)">
    <path d="M32 6 A 26 26 0 0 1 32 58" fill="none" stroke="#37A6E0" stroke-width="9" stroke-linecap="round"/>
    <path d="M32 6 A 26 26 0 0 0 32 58" fill="none" stroke="#F5822A" stroke-width="9" stroke-linecap="round"/>
    <path d="M32 24 C 37 32 40 36 40 40 A 8 8 0 1 1 24 40 C 24 36 27 32 32 24 Z" fill="#FFFFFF"/>
  </g>
  <text x="232" y="182" font-family="DejaVu Sans" font-weight="bold" font-size="118" fill="#FFFFFF" letter-spacing="1">Sparmin</text>
  <text x="100" y="300" font-family="DejaVu Sans" font-size="42" fill="#A9BCC6">Sauna, steam, plunge, pool — logged as a Garmin activity.</text>
  <g id="band">
{rows}  </g>
  <text x="720" y="662" text-anchor="middle" font-family="DejaVu Sans" font-size="30" fill="#7C93A0">One lap per activity  ·  live heart rate  ·  end-of-session breakdown</text>
</svg>'''
open(os.path.join(tmp,"hero.svg"),"w").write(svg)
PY

mkdir -p submission
rsvg-convert -w 1440 -h 720 "$tmp/hero.svg" -o submission/hero.png
cp submission/hero.png submission/cover.png
echo "generated:"
for f in submission/hero.png submission/cover.png; do
    echo "  $f  $(magick identify -format '%wx%h' "$f") $(du -k "$f" | cut -f1)kB"
done
