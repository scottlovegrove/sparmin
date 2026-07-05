# CODEBASE.md — Repo Map

> **Purpose:** a compact orientation file so Claude (and humans) can navigate
> this repo without exploring. Describes _what is where_.
> [AGENTS.md](./AGENTS.md) covers the **rules** (how to change things);
> `README.md` is the human-facing build/run + design-decisions doc. Update when
> structure shifts, not on every file.

## What this project is

**Sparmin** — a personal Garmin **Connect IQ watch app** (Monkey C) for logging
thermal spa sessions (saunas, cold plunges, pools). It records the whole visit
as a real **FIT activity** via `ActivityRecording`, marks a **lap per station**,
tags each lap with the station via a **FitContributor** developer field, shows
live HR, and (deferred) can POST a summary to a backend for Strava labelling.

- **Type:** `watch-app`. **Targets:** vívoactive 5 (390px AMOLED, touch) and
  Forerunner 745 (240px MIP, 5 buttons) — deliberately opposite ends of the
  input/display spectrum. Manifest `minApiLevel 3.1.0`.
- **SDK:** Connect IQ 9.2.0. Signed with `~/.Garmin/ConnectIQ/developer_key`.
- **Design axiom:** the recorder-agnostic **core is free of device APIs** so it
  is unit-testable; only `Recorder`, views, and samplers touch Toybox device
  APIs. Custom-drawn views adapt from `DeviceSettings` — **no `if device == …`**.

## Top-level layout

```
/
├─ source/                    # All Monkey C. See tree below.
├─ resources/                 # SHARED: strings/ + settings/ only (no drawables)
├─ resources-vivoactive5/     # 390px drawables: 64px icons + 56px launcher
├─ resources-fr745/           # 240px drawables: 44px icons + 40px launcher
├─ icons/                     # SVG source art (10 stations + app_icon) — see note
├─ docs/store-submission.md   # How to publish to the Connect IQ Store
├─ manifest.xml               # app id (permanent UUID), products, permissions
├─ monkey.jungle              # build config (per-device dirs auto-selected)
├─ build.sh                   # builds both watches -> bin/Sparmin-<device>.prg
├─ README.md                  # build/run, tests, design decisions
└─ .vscode/extensions.json    # recommends garmin.monkey-c
```

Per-device drawables use Connect IQ **resource qualifiers**: a folder named
`resources-<deviceId>` is auto-merged for that device (no jungle wiring). There
is **no shared drawable fallback**, so adding a device to the manifest requires
giving it a `resources-<deviceId>` folder (see docs/store-submission.md §2).

## `source/` tree

```
source/
├─ SparminApp.mc          # AppBase entry. Owns the single SessionManager;
│                         # getInitialView() -> StripView + StripDelegate. getApp().
├─ SessionManager.mc      # THE state machine (§ below) + in-memory model +
│                         # aggregation + payload + Storage persistence.
│                         # Also holds `class StationAggregate`.
├─ Recorder.mc            # ONLY ActivityRecording/FitContributor wrapper.
│                         # SPORT/SUB_SPORT constants live here (Breathwork).
│                         # Lap-scope "station" field + session-scope "summary".
├─ Station.mc             # module: immutable 10-station catalogue (ids/names/
│                         # short labels). Canonical ids — never remap.
├─ StationConfig.mc       # module: hide/reorder visible ids in Storage; pure
│                         # toggle()/move() helpers (unit-tested).
├─ TouchConfig.mc         # module: "water-safe touch" flag in Storage + pure
│                         # confirmsTap() double-tap rule (unit-tested).
├─ StripController.mc     # pure strip nav: focus cursor + visible window +
│                         # edge-slide rule. idAtIndex() for animated render.
├─ Segment.mc             # one lap: stationId(null=transition), times, HR stats,
│                         # foldHr(), toDict()/segmentFromDict() (crash-resume).
├─ HrSampler.mc           # module: live-vs-display HR, invalid-sample rejection.
├─ BackendClient.mc       # PARKED: POST + offline queue. Unwired (backend deferred).
├─ Fmt.mc                 # module: duration ("m:ss") + hr formatting.
├─ Uuid.mc / Iso.mc       # module: session id (v4) + ISO-8601 UTC.
├─ Tests.mc               # 20 (:test) cases + FakeRecorder. Run in the simulator.
└─ views/
   ├─ StripView.mc        # home screen (IDLE/TRANSITION/STATION_ACTIVE): strip,
   │  StripDelegate.mc    # timers, HR, icons, drag-scroll animation, focus label
   ├─ ConfirmEndView.mc   # guarded end: tick/cross drawn as line shapes (MIP-safe)
   │  ConfirmEndDelegate.mc
   ├─ SummaryView.mc      # scrollable per-station breakdown
   │  SummaryDelegate.mc
   └─ ConfigView.mc       # MoveModeView (reorder). ConfigDelegate.mc holds the
      ConfigDelegate.mc    # Menu2 hub + HideMenuDelegate (checkbox) + MoveModeDelegate
```

## The state machine (SessionManager — the heart of it)

Five states drive **both the UI and the FIT recorder**:

```
IDLE ──start/select──▶ TRANSITION ──select station──▶ STATION_ACTIVE
                          ▲  │  ▲                          │  (select other
                          │  │  └──────── stop ────────────┘   = auto-switch)
                          │  │ stop
                  cancel  │  ▼
                       CONFIRM_END ──confirm(save FIT)──▶ SUMMARY ──dismiss──▶ IDLE
```

- **Lap contract:** the `station` FitContributor field is set to the *closing*
  lap's label immediately before each `addLap()`/`finish()`, so every lap
  carries its own station. Transition periods are their own laps. On `finish()`
  a session-scope `summary` field also gets `SessionManager.summaryText()` (one
  compact line: total, per-station time/visits/HR, transitions).
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
scroll; top-right button `KEY_ENTER`(4) = Stop; bottom-right `KEY_ESC`(5) = Back;
idle footer tap = Settings. **FR745** buttons — Up(13)/Down(8) = focus;
Start `KEY_ENTER`(4) = select; Back/Lap `KEY_ESC`(5) = Stop/Back; **hold-Up →
`KEY_MENU`(7)** = Settings.

**Water-safe touch** (`TouchConfig`, opt-in Settings toggle, touch devices only):
guards a wet screen from stray droplet taps. When on, a tile/tick actuates only
on a *second* tap of the same target within `DOUBLE_TAP_MS`, and mid-session
`KEY_ESC` (bottom-right) toggles a **touch-lock** — while locked `StripDelegate`
swallows all touch and `StripView` shows a padlock; the physical Stop button
still works. Off = single-tap, `KEY_ESC` a mid-session no-op (unchanged).

## Icons / resources

Station tiles render bitmaps (dark tile so the icons pop). `StripView` maps
`stationId -> Rez.Drawables.st_<id>` and lazy-loads/caches them. PNGs are
rasterised from `icons/*.svg` with **`rsvg-convert`** (ImageMagick's internal
SVG renderer drops strokes, which these icons are mostly made of): 64px for VA5,
44px for FR745, plus 56/40px launchers. Re-run those conversions if the SVGs
change.

## Testing

- **Runner:** the Connect IQ simulator. `./build.sh test` builds
  `bin/Sparmin-test.prg`, then `monkeydo bin/Sparmin-test.prg vivoactive5 -t`.
- **What's covered (16 tests, `Tests.mc`):** state transitions + no-ops,
  zero-gap auto-switch, aggregation w/ repeat visits, transition time, HR folding
  (null/invalid rejection), FIT lap-label order, payload shape, station-config
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
  (Station, StationConfig, HrSampler, Fmt, Uuid, Iso) are lower-utility.
- Light type annotations; dynamic dictionaries cast to `Lang.Dictionary`/`Array`
  to avoid "container access" warnings — **builds must stay 0-warning**.
- `stationId`s are canonical and permanent — reordering/hiding never remaps them.
- The recorder-agnostic core stays device-API-free (inject `Recorder`).

## Deferred / on-device-validation (not done in the sim)

- **Sport/sub-sport** = `SPORT_TRAINING`/`SUB_SPORT_BREATHING` (Breathwork). It
  also governs whether Garmin Connect renders the station lap field — re-verify
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
