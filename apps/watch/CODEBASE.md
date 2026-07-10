# CODEBASE.md — Repo Map

> **Purpose:** a compact orientation file so Claude (and humans) can navigate
> this repo without exploring. Describes _what is where_.
> [AGENTS.md](./AGENTS.md) covers the **rules** (how to change things);
> `README.md` is the human-facing build/run + design-decisions doc. Update when
> structure shifts, not on every file.

## What this project is

**Sparmin** — a personal Garmin **Connect IQ watch app** (Monkey C) for logging
thermal spa sessions (saunas, cold plunges, pools). It records the whole visit
as a real **FIT activity** via `ActivityRecording`, marks a **lap per activity**,
tags each lap with the activity via a **FitContributor** developer field, shows
live HR, and (deferred) can POST a summary to a backend for Strava labelling.

- **Type:** `watch-app`. **Primary hardware:** vívoactive 5 (390px AMOLED,
  touch) and Forerunner 745 (240px MIP, 5 buttons) — deliberately opposite ends
  of the input/display spectrum, and the two devices side-loaded/tested.
  **Store range:** 94 Connect IQ wrist watches submitted (of 120 SDK-eligible
  meeting `minApiLevel 3.1.0`; the newest 26 are deferred by Store-catalogue lag
  — see docs/store-submission.md §1), covered by 15 screen-family resource
  folders. Nothing is device-hardcoded, so widening is a resources + manifest
  change only.
- **SDK:** Connect IQ 9.2.0. Signed with `~/.Garmin/ConnectIQ/developer_key`.
- **Design axiom:** the recorder-agnostic **core is free of device APIs** so it
  is unit-testable; only `Recorder`, views, and samplers touch Toybox device
  APIs. Custom-drawn views adapt from `DeviceSettings` — **no `if device == …`**.

## Top-level layout

This app is the `apps/watch` workspace of the Sparmin monorepo; the tree below
is rooted at `apps/watch/` (the sibling `apps/web/` holds the marketing site).
All build tooling self-locates, so paths here are relative to this directory.

```
apps/watch/
├─ source/                    # All Monkey C. See tree below.
├─ resources/                 # SHARED: strings/ + settings/ only (no drawables)
├─ resources-<deviceFamily>/  # 15 per-screen-family drawable folders, e.g.
│                             # resources-round-390x390, resources-round-240x240,
│                             # resources-rectangle-240x240, resources-semioctagon-176x176
│                             # — each: right-sized activity icons + launcher.
├─ icons/                     # SVG source art (10 activities + app_icon) — see note
├─ tools/                     # rasterise-icons.sh (regen family folders),
│                             # list-products.sh (regen manifest device list)
├─ docs/store-submission.md   # How to publish to the Connect IQ Store
├─ manifest.xml               # app id (permanent UUID), 94 products (of 120 eligible)
├─ monkey.jungle              # build config (family dirs auto-selected)
├─ build.sh                   # ./build.sh (primaries) | fleet | test | all
├─ README.md                  # build/run, tests, design decisions
└─ .vscode/extensions.json    # recommends garmin.monkey-c
```

Drawables use Connect IQ **resource qualifiers by screen family**: a folder
named `resources-<deviceFamily>` (the `deviceFamily` from each device's SDK
`compiler.json`, e.g. `round-390x390`) is auto-merged for **every device in that
family** — no jungle wiring, no per-device folders. There is **no shared
drawable fallback**: every supported device must belong to a family that has a
folder. `tools/rasterise-icons.sh` regenerates all 15 folders from the SVGs;
`tools/list-products.sh` regenerates the manifest's `<iq:products>` list. Adding
a device that lands in an existing family needs only a manifest entry; a device
in a new family also needs a new size row in `rasterise-icons.sh`.

## `source/` tree

```
source/
├─ SparminApp.mc          # AppBase entry. Owns the single SessionManager;
│                         # getInitialView() -> StripView + StripDelegate. getApp().
├─ SessionManager.mc      # THE state machine (§ below) + in-memory model +
│                         # aggregation + payload + Storage persistence.
│                         # Also holds `class ActivityAggregate`.
├─ Recorder.mc            # ONLY ActivityRecording/FitContributor wrapper.
│                         # SPORT/SUB_SPORT constants live here (Cardio training).
│                         # Lap-scope "activity" field + session-scope "summary".
├─ SpaActivity.mc         # module: immutable 10-activity catalogue (ids/names/
│                         # short labels). Canonical ids — never remap.
├─ ActivityConfig.mc      # module: hide/reorder visible ids in Storage; pure
│                         # toggle()/move() helpers (unit-tested).
├─ TouchConfig.mc         # module: "water-safe touch" flag in Storage + pure
│                         # confirmsTap() double-tap rule (unit-tested).
├─ StripController.mc     # pure strip nav: focus cursor + visible window +
│                         # edge-slide rule + trailing End/Exit slot (touch
│                         # button fallback). idAtIndex() for animated render.
├─ ButtonHints.mc         # module: native-style bezel arc + glyph physical-button
│                         # hints (touch wet-fallback); StripView + ConfirmEndView.
├─ Segment.mc             # one lap: activityId(null=transition), times, HR stats,
│                         # foldHr(), toDict()/segmentFromDict() (crash-resume).
├─ HrSampler.mc           # module: live-vs-display HR, invalid-sample rejection.
├─ BackendClient.mc       # PARKED: POST + offline queue. Unwired (backend deferred).
├─ Fmt.mc                 # module: duration ("m:ss") + hr formatting.
├─ Uuid.mc / Iso.mc       # module: session id (v4) + ISO-8601 UTC.
├─ Tests.mc               # 20 (:test) cases + FakeRecorder. Run in the simulator.
└─ views/
   ├─ StripView.mc        # home screen (IDLE/TRANSITION/IN_ACTIVITY): strip,
   │  StripDelegate.mc    # timers, HR, icons, drag-scroll animation, focus label
   ├─ ConfirmEndView.mc   # guarded end: tick/cross drawn as line shapes (MIP-safe)
   │  ConfirmEndDelegate.mc
   ├─ SummaryView.mc      # scrollable per-activity breakdown
   │  SummaryDelegate.mc
   └─ ConfigView.mc       # MoveModeView (reorder). ConfigDelegate.mc holds the
      ConfigDelegate.mc    # Menu2 hub + HideMenuDelegate (checkbox) + MoveModeDelegate
```

## The state machine (SessionManager — the heart of it)

Five states drive **both the UI and the FIT recorder**:

```
IDLE ──start/select──▶ TRANSITION ──select activity──▶ IN_ACTIVITY
                          ▲  │  ▲                          │  (select other
                          │  │  └──────── stop ────────────┘   = auto-switch)
                          │  │ stop
                  cancel  │  ▼
                       CONFIRM_END ──confirm(save FIT)──▶ SUMMARY ──dismiss──▶ IDLE
```

- **Lap contract:** the `activity` FitContributor field is set to the *closing*
  lap's label immediately before each `addLap()`/`finish()`, so every lap
  carries its own activity. Transition periods are their own laps. On `finish()`
  a session-scope `summary` field also gets `SessionManager.summaryText()` (one
  compact line: total, per-activity time/visits/HR, transitions).
- **Timekeeping:** every transition takes an explicit `now` (epoch seconds);
  durations are derived from boundaries, never a ticking counter — correct
  across suspend/resume. Tests pass fixed timestamps; the app passes
  `Time.now().value()`.
- **Persistence:** a snapshot is written to `Storage` on every transition
  (`hasSessionSnapshot()`/`loadSessionSnapshot()`/`restore()`), cleared on
  confirm. `reset()` deliberately does NOT clear it (so it survives construction
  and is detectable on launch). Resume prompt + FIT reconnect are **deferred**.

## Views & input (important gotcha)

Views are **custom-drawn** in `onUpdate(dc)` (no layout XML) and size from
`dc.getWidth()/getHeight()`. Input uses **raw `WatchUi.InputDelegate`**
(`onTap`/`onKey`/`onSwipe`/`onDrag`), **NOT `BehaviorDelegate`** — on a touch
device BehaviorDelegate translates a tap into the SELECT *behaviour* and drops
the coordinates, so coordinate-based tile selection can't work. This was a real
bug; don't switch back.

Key map (from on-device testing): **VA5** touch — tap tile = select; drag =
scroll; idle footer tap = Settings. The two buttons are the **wet fallback** (a
wet finger can't tap): top-right `KEY_ENTER`(4) = **Next** (cycle the focus
highlight, loops); bottom-right `KEY_ESC`(5) = **Select** (commit it). The
highlight cycle ends on a trailing **End/Exit tile**, so ending needs no
dedicated gesture — the vívoactive 5 reserves the top-button *hold* for its own
controls menu, so app gestures are short-press only. **FR745** buttons —
Up(13)/Down(8) = focus; Start `KEY_ENTER`(4) = select; Back/Lap `KEY_ESC`(5) =
Stop/Back; **hold-Up → `KEY_MENU`(7)** = Settings.

Button hints are drawn as native-style **bezel arcs** at the two right-side
buttons (`ButtonHints`, touch devices only): green ▸ Next / ● Select on the strip
(Select turns red ⏹ on the End tile), green ✓ / red ✕ on CONFIRM_END.

**Water-safe touch** (`TouchConfig`, opt-in Settings toggle, touch devices only):
guards a wet screen from stray droplet taps on the *touch* path — a tile/tick
actuates only on a *second* tap of the same target within `DOUBLE_TAP_MS`. The
buttons commit in one press regardless (the real wet answer), so there is no
touch-lock. Off = single-tap.

## Icons / resources

Activity tiles render bitmaps (dark tile so the icons pop). `StripView` maps
`activityId -> Rez.Drawables.st_<id>`, lazy-loads/caches them, and draws each at
native px centred in its tile — so **icon size must scale with the screen**.
`tools/rasterise-icons.sh` rasterises `icons/*.svg` with **`rsvg-convert`**
(ImageMagick's internal SVG renderer drops the strokes these icons are made of),
one size per screen family: `icon = round(0.133·minDim + 12)`, which passes
through the two hand-tuned originals (44px @ 240px, 64px @ 390px). The
**launcher** is the only manifest-declared (size-sensitive) asset — it's set to
each family's most-common launcher size, with `round-390x390`/`round-240x240`
pinned to the exact vívoactive 5 / FR745 sizes so `./build.sh` stays 0-warning.
Other devices get a benign "will be scaled" note. Re-run the script if the SVGs
or the supported families change.

## Testing

- **Runner:** the Connect IQ simulator. `./build.sh test` builds
  `bin/Sparmin-test.prg`, then `monkeydo bin/Sparmin-test.prg vivoactive5 -t`.
- **What's covered (16 tests, `Tests.mc`):** state transitions + no-ops,
  zero-gap auto-switch, aggregation w/ repeat visits, transition time, HR folding
  (null/invalid rejection), FIT lap-label order, payload shape, activity-config
  (default/hide-last-guard/reorder), strip window-sliding, persist→restore.
- `FakeRecorder` (in `Tests.mc`) stands in for `Recorder`, so the state machine
  runs without `ActivityRecording`. The device-dependent bits (FIT reconnect,
  sport rendering, MIP colours) can only be validated on the physical watch.

## Build & run

- **Build both watches:** `./build.sh` → `bin/Sparmin-vivoactive5.prg`,
  `bin/Sparmin-fr745.prg`. Add `test` for the unit-test binary.
- **Simulator (WSL):** the SDK Manager and simulator need an old webkit stack
  noble dropped; launch via `~/connectiq-sdkmanager/run-simulator.sh` (extracted
  libs on `LD_LIBRARY_PATH`), then `monkeydo bin/Sparmin-<device>.prg <device>`.
- **Side-load:** copy `bin/Sparmin-<device>.prg` to the watch's `GARMIN/APPS/`.

## Conventions

- **Filenames = class name**, PascalCase `.mc` (`SessionManager.mc`). `module`s
  (SpaActivity, ActivityConfig, HrSampler, Fmt, Uuid, Iso) are lower-utility.
- Light type annotations; dynamic dictionaries cast to `Lang.Dictionary`/`Array`
  to avoid "container access" warnings — **builds must stay 0-warning**.
- `activityId`s are canonical and permanent — reordering/hiding never remaps them.
- The recorder-agnostic core stays device-API-free (inject `Recorder`).

## Deferred / on-device-validation (not done in the sim)

- **Sport/sub-sport** = `SPORT_TRAINING`/`SUB_SPORT_CARDIO_TRAINING` (Cardio). It
  also governs whether Garmin Connect renders the activity lap field — re-verify
  labels on-device if it changes (`Recorder.mc`).
- **Crash resume** — persistence is done; the resume prompt + FIT reconnect are
  parked (only testable on hardware).
- **Backend sync** (Strava labels) — `BackendClient` is written but unwired.

## Start here if new

1. `source/SparminApp.mc` — entry + what owns what
2. `source/SessionManager.mc` — the state machine + model (the core)
3. `source/views/StripView.mc` + `StripDelegate.mc` — the main screen + input
4. `source/Tests.mc` — what behaviour is pinned
5. `README.md` — build/run + design decisions; `docs/store-submission.md` — publishing
