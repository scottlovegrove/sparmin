# Sparmin

> For repo structure, where things live, and the module catalogue, read
> [CODEBASE.md](./CODEBASE.md) first. This file covers the **rules** (how to
> change things); CODEBASE.md is the **map** (what is where). `README.md` is the
> human-facing build/run + design-decisions doc.

A personal Garmin **Connect IQ** watch app (Monkey C) for logging thermal spa
sessions as a FIT activity, one lap per activity. Targets the vívoactive 5 (390px
touch) and Forerunner 745 (240px, 5 buttons).

## Build & Run

```bash
./build.sh                 # primary side-load watches (vivoactive5, fr745)
./build.sh fleet           # compile-check one device per screen family (15)
./build.sh test            # primaries + the unit-test binary (bin/Sparmin-test.prg)
./build.sh all             # fleet + test

# single device (debug):
monkeyc -f monkey.jungle -o bin/x.prg -y ~/.Garmin/ConnectIQ/developer_key -d vivoactive5 -w
```

Run it in the simulator (on WSL the simulator needs the extracted webkit libs):

```bash
~/connectiq-sdkmanager/run-simulator.sh &         # launch the simulator
monkeyc ... && monkeydo bin/Sparmin-<device>.prg <device>
```

**Verify changes in the simulator (or on-device) before committing** — a clean
build is not proof it behaves. Side-load by copying `bin/Sparmin-<device>.prg`
to the watch's `GARMIN/APPS/`.

## Rules when changing code

- **Input — `InputDelegate`, not `BehaviorDelegate`.** Custom-view delegates
  extend `WatchUi.InputDelegate` and handle raw `onTap`/`onKey`/`onSwipe`/
  `onDrag`. `BehaviorDelegate` translates a touch tap into the SELECT *behaviour*
  and drops the coordinates, so coordinate-based tile selection silently breaks.
  Menus (`Menu2`/`CheckboxMenu`) keep `Menu2InputDelegate` — they handle their
  own input.
- **Zero warnings.** Both device builds must compile with **0 warnings**. Cast
  dynamic dictionaries/arrays to `Lang.Dictionary` / `Lang.Array` and annotate
  return types to avoid "container access" warnings. `hidden`/`class`/etc. are
  reserved words — don't name locals after them.
- **A release = version bump + changelog entry, together.** Anything a user would
  notice — a feature, a fix, a behaviour change — ships as a release, and a
  release is always both halves:
  1. Bump `Version.APP` in `source/Version.mc` (semver: patch for a fix, minor for
     a feature). It's the only record of the app's version — a v3 manifest has no
     version field — and it's what the Settings → About page shows and what you
     type into the store dashboard.
  2. Add the matching note in the `apps/marketing` workspace: a new
     `apps/marketing/src/content/changelog/<version>.md` (frontmatter `version` +
     `summary`, then user-facing bullets — copy the newest file).

  Either half without the other is a bug: an un-bumped version means nobody can
  tell what's on the watch, and a missing changelog entry means nobody knows what
  changed. This is the one change that deliberately spans both workspaces.
  Internal-only work (refactors, tests, docs, tooling) is not a release — leave
  the version alone.
- **Canonical activity ids.** `activityId`s in `SpaActivity.mc` are permanent.
  Hiding/reordering (`ActivityConfig`) is a pure display layer — it must never
  remap or drop an id. The id written to the FIT lap field and the backend
  payload always comes from the catalogue.
- **Keep the core device-API-free.** `SessionManager` and the duration/
  aggregation logic must not call Toybox device APIs — inject a `Recorder`
  (tests pass a `FakeRecorder`). Only `Recorder`, the `views/`, and `HrSampler`
  touch device APIs.
- **Timekeeping.** Pass an explicit `now` (epoch seconds) into every state
  transition; derive durations from boundaries. Never accumulate a ticking
  counter — it drifts across suspend/resume.
- **FIT lap labelling.** Set the `activity` FitContributor field to the *closing*
  lap's label immediately before each `addLap()`/`finish()`, so every lap
  carries its own activity.
- **No device hardcoding.** Adapt from `System.getDeviceSettings()` (touch vs
  buttons, width) — never `if (device == …)`.
- **Per-family resources.** Drawables resolve by **screen family**, not device:
  `resources-<deviceFamily>/` (e.g. `resources-round-390x390/`) covers every
  device in that family. There is no shared drawable fallback, so a device in a
  new family needs a new folder — generate all folders with
  `tools/rasterise-icons.sh` (a size row per family) and regenerate the manifest
  device list with `tools/list-products.sh`. Icons are rasterised from
  `icons/*.svg` with **`rsvg-convert`** (ImageMagick's built-in SVG renderer
  drops strokes). See `docs/store-submission.md §2`.

## Testing

The Connect IQ **simulator** is the test runner.

```bash
./build.sh test
monkeydo bin/Sparmin-test.prg vivoactive5 -t
```

- Tests live in `source/Tests.mc` as `(:test)` functions, with `FakeRecorder`
  standing in for `Recorder` so the state machine runs without
  `ActivityRecording`.
- **When you add or change core logic, add/adjust a test.** The whole point of
  the device-API-free core is that it's pinned by unit tests.
- **Device-dependent behaviour is NOT sim-testable** — sport/sub-sport rendering
  and activity labels in Garmin Connect, MIP colour legibility (FR745), memory
  headroom, and the crash-resume FIT reconnect can only be validated on the
  physical watch. Flag these when you touch them; don't claim them verified from
  the simulator.

## Keeping CODEBASE.md accurate

`CODEBASE.md` is a structural map, not a file index. Update it when **structure**
changes — not on every new file. Triggers:

- a new top-level directory, or a new broadly-reusable `source/` module (the
  "don't reimplement" catalogue)
- changes to the state machine, the recorder/FIT contract, the input model, or
  the build/test tooling
- a new supported device / resource layout

Adding one more view or a narrowly-scoped helper does not require an update.
