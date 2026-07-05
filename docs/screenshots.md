# Capturing store screenshots

Screenshots for the Connect IQ Store are **per-listing, not per-device** — you
upload one set (Garmin allows up to ~10) and every user sees the same images
whatever watch they own. Nothing checks device coverage, so pick shots that show
the app off well: favour different **app states** over different hardware.

Capture from the simulator: load the app, navigate to the state, then
**File → Save Screenshot**.

```bash
./build.sh                                        # or a single device build
~/connectiq-sdkmanager/run-simulator.sh &         # launch the simulator (WSL)
monkeydo bin/Sparmin-<device>.prg <device>        # load the app
```

> On WSL the sim runs under Weston/Wayland — you can't script its input or grab
> its window from a shell, so this is a manual click-through. Drive it by hand.

## Hero set (3 shots, one device)

Shoot these on a **large round AMOLED** — vivoactive5 / venu3 / fr965 — for the
best-looking hero images. `<Stop>` / `<Enter>` etc. below are the on-screen
buttons in the sim; on a touch device tiles/tick are tapped.

1. **Idle strip ⭐** — a fresh launch lands here. The activity strip across the
   top is the app's signature screen.
2. **Active session ⭐**
   - First set a heart rate so the shot isn't `HR --`: **Simulation → Activity
     Data**, Heart Rate ≈ 120. (If live HR still reads blank, also set
     **Simulation → Activity Monitoring** — the history fallback.) HR only draws
     in the active/transition states, not idle.
   - Select an activity tile (touch: tap; buttons: focus + Start) → it goes
     active and the timer starts.
   - Select a **second** activity to auto-switch, let each run ~30–60 s, so the
     later summary has more than one line.
   - Grab it once the timer reads something real.
3. **Summary ⭐**
   - Press **Stop** (touch VA5: top-right `KEY_ENTER`; buttons: Back/Lap).
   - Confirm-end: tap the tick / press Start.
   - Lands on the per-activity **Summary** breakdown → grab it.
   - To retake from idle: dismiss the summary (tap / Back).

## Optional extras

- A **rectangle** device (venusq) if you want to show that layout.
- The **water-safe** idle hint: Settings → Water-safe touch **on** → the hint
  reads "Double-tap an activity to start".
- The config screen (Show/hide, Reorder) if the listing has room.

## Gotchas

- Set **HR before** going active, or the active shot shows `HR --`.
- Do **at least two activities** before ending, or the summary is a single thin
  line.
- MIP palette in the sim only approximates the real FR745 — judge MIP colour
  legibility on hardware, not from a MIP screenshot.
- Icon sizing and layout are per screen family; a shot on one 390px watch
  represents every device in `round-390x390`. See
  [store-submission.md §2](store-submission.md).
