# Sparmin

A Garmin [Connect IQ](https://developer.garmin.com/connect-iq/) watch app,
written in [Monkey C](https://developer.garmin.com/connect-iq/monkey-c/).

## Prerequisites

- **Connect IQ SDK** — install via the [SDK Manager](https://developer.garmin.com/connect-iq/sdk/).
- **A developer key** — one key signs all your Connect IQ apps, so keep it
  outside your repos (this project expects it at `~/.Garmin/ConnectIQ/developer_key`).
  The VS Code *Monkey C* extension can generate one, or by hand:
  ```sh
  openssl genrsa -out ~/.Garmin/ConnectIQ/developer_key.pem 4096
  openssl pkcs8 -topk8 -inform PEM -outform DER \
      -in ~/.Garmin/ConnectIQ/developer_key.pem \
      -out ~/.Garmin/ConnectIQ/developer_key -nocrypt
  ```
- **VS Code** with the official *Monkey C* extension (recommended), or the
  command-line SDK tools (`monkeyc`, `connectiq`, `monkeydo`).

## Project layout

```
.
├── manifest.xml              App id, supported devices, permissions, languages
├── monkey.jungle            Build configuration (manifest + source/resource paths)
├── source/                  Monkey C source (.mc)
│   ├── SparminApp.mc         Application entry point
│   ├── SparminView.mc        Main view (rendering + lifecycle)
│   ├── SparminDelegate.mc    Input handling for the main view
│   └── SparminMenuDelegate.mc Input handling for the main menu
├── resources/               Compiled resources, referenced via the `Rez` namespace
│   ├── drawables/            Bitmaps (incl. launcher_icon.png) + drawables.xml
│   ├── layouts/              Screen layouts
│   ├── menus/                Menu definitions
│   ├── settings/             User settings + persistent properties
│   └── strings/              Localised strings
├── .gitignore
└── LICENSE
```

Device- or language-specific overrides live in sibling folders (e.g.
`resources-fenix7/`, `resources-fra/`) wired up in `monkey.jungle`.

## Build & run

Using the SDK command-line tools (adjust `--device` / paths to taste):

```sh
# Compile for the simulator (monkeyc is on PATH via ~/.bashrc once an SDK is active)
monkeyc -f monkey.jungle -o bin/sparmin.prg -y ~/.Garmin/ConnectIQ/developer_key -d vivoactive5

# Launch the Connect IQ simulator, then side-load the build
connectiq
monkeydo bin/sparmin.prg vivoactive5
```

In VS Code, use the *Monkey C: Build for Device* and *Monkey C: Run App*
commands from the command palette instead.

## Tests

The device-independent core (state machine, lap logic, aggregation, HR folding,
activity config, payload) is covered by `(:test)` unit tests in
`source/Tests.mc`. Build a test binary and run it in the simulator:

```sh
monkeyc -f monkey.jungle -o bin/sparmin-test.prg -y ~/.Garmin/ConnectIQ/developer_key -d vivoactive5 --unit-test
monkeydo bin/sparmin-test.prg vivoactive5 -t
```

In VS Code, use *Monkey C: Run Tests* / the test explorer instead.

## Design decisions

- **Sport / sub-sport:** `SPORT_TRAINING` / `SUB_SPORT_BREATHING` (Breathwork) —
  an HR/time-based recovery activity with no distance (`SPORT_GENERIC` recorded
  as a distance activity and showed "0 miles"). This choice also affects whether
  Garmin Connect renders the `activity` lap developer field, so re-validate the
  labels on-device whenever it changes, and adjust in `Recorder.mc`.
- **Transition time:** recorded as explicit transition laps (an activity lap closes,
  a transition lap opens) so the FIT laps align 1:1 with the on-watch segments.
- **Activity labelling:** the `activity` field is set to the *closing* lap's label
  immediately before each `addLap()`/stop, so every lap carries its own activity.
- **Backend sync:** parked. `BackendClient` honours the payload contract and
  `SessionManager.buildPayload()` produces it, but nothing POSTs yet.

## Publishing

The app is built for **120 Connect IQ wrist watches** (every watch-app device
meeting `minApiLevel 3.1.0`), covered by 15 per-screen-family drawable folders;
the vívoactive 5 and Forerunner 745 are the two primary side-load/test devices.
To submit to the Connect IQ Store (store assets, signing, review — plus how the
device list and family folders are generated), see
[docs/store-submission.md](docs/store-submission.md).

## Notes

- The launcher icon (`launcher_icon.png` in each `resources-<family>/drawables/`,
  generated from `icons/app_icon.svg`) is a placeholder — replace the SVG with
  real artwork and re-run `tools/rasterise-icons.sh` before publishing.
- The `id` in `manifest.xml` is this app's permanent UUID; do not change it once
  the app is published to the Connect IQ Store.
- **WSL / Ubuntu 24.04:** the SDK Manager and simulator link the old
  webkit2gtk-4.0 stack that noble dropped; `~/connectiq-sdkmanager/run-*.sh`
  launch them with the extracted libraries on `LD_LIBRARY_PATH`.
