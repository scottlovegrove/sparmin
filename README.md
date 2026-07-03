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

## Notes

- `resources/drawables/launcher_icon.png` is a generated placeholder — replace
  it with real artwork before publishing.
- The `id` in `manifest.xml` is this app's permanent UUID; do not change it once
  the app is published to the Connect IQ Store.
