# Publishing Sparmin to the Connect IQ Store

Notes for turning this from a two-watch personal build into a Connect IQ Store
submission. Nothing here is required for personal side-loading — it's only for
publishing.

> Garmin changes the exact asset sizes and portal flow from time to time. Treat
> this as the shape of the work; verify the specifics against the current
> [Connect IQ developer docs](https://developer.garmin.com/connect-iq/) and the
> app-submission guide before you submit.

---

## TL;DR checklist

- [x] Broaden the device list in `manifest.xml` (`<iq:products>`) — 94 submitted of 120 SDK-eligible (`tools/list-products.sh`); newest 26 deferred by Store-catalogue lag (see §1).
- [x] Add per-screen-family drawable folders so every listed device builds (see §2).
- [ ] Confirm every listed device compiles (`./build.sh fleet`), and check memory on the smallest one (fr55, 208px).
- [ ] Replace the placeholder launcher icon with real app-icon art.
- [ ] Prepare store listing assets: icon, screenshots, description, "what's new".
- [ ] Review the requested permissions and drop any you don't use.
- [ ] Export a signed `.iq` package (all devices) with your developer key.
- [ ] Test on a real device end-to-end (a full session syncing to Garmin Connect).
- [ ] Upload + submit on the Connect IQ developer portal; wait for review.

---

## 1. Device support — the "checklist"

Every Connect IQ app must **explicitly list the devices it supports** in the
manifest. There is no "any Garmin watch" wildcard — devices differ too much
(screen 208–454px, round/rectangle, MIP vs AMOLED, touch vs buttons, different
API levels and memory), so you opt in per device.

It's listed in `manifest.xml`:

```xml
<iq:products>
    <iq:product id="vivoactive5"/>
    <iq:product id="fr745"/>
    <!-- add more here -->
</iq:products>
```

The list is generated, not hand-typed: `tools/list-products.sh` prints every
watch-app device whose max firmware meets `minApiLevel` (currently `3.1.0`),
excluding Edge cycling computers and handheld GPS units. It currently yields
**120 devices** — of which **94 are actually submitted**; the newest 26 are held
back by Store-catalogue lag (see below). (In VS Code the Monkey C extension's
**"Edit Products"** editor does the same interactively.) To regenerate after an
SDK update:

```sh
tools/list-products.sh > /tmp/products.txt   # paste into <iq:products>
```

Two things to keep in mind as you widen the list:

- **Every listed device must build.** The compiler resolves resources per
  device; if a device belongs to a screen family with no drawables folder it
  fails. That's what the per-family folders in §2 provide.
- **Every listed device is a support commitment.** The Store only offers the app
  to devices you list, and users will expect it to work. Test at least one
  representative of each screen class (`./build.sh fleet` builds one per family).

### Store catalogue lags the SDK (26 devices deferred)

The SDK builds for 120 devices, but the manifest **submitted** to the Store
lists **94**. Uploading the full 120 was rejected with:

```
"ERROR_WHILE_PROCESSING_MANIFEST": "There was an error processing the manifest file."
```

The cause is **not** the app: the newest hardware generation (Connect IQ API
6.x, plus the 2025 Instinct/Descent lines) is buildable and appears on Garmin's
[compatible-devices page](https://developer.garmin.com/connect-iq/compatible-devices/),
but the **Store's product catalogue hasn't registered those products yet**, so
its manifest processor errors on them. A minimal 4-device upload and the trimmed
94-device upload both succeeded, isolating it to that newest cohort.

The 26 deferred devices:

```
fenix 8 (43/47mm, Solar 47/51mm), fenix 8 Pro 47mm, fenix E
Forerunner 970, Forerunner 570 (42/47mm), Forerunner 170/170m, Forerunner 70
vivoactive 6, Venu X1, Venu 4 (41/45mm)
Instinct 3 (AMOLED 45/50mm, Solar 45mm), Instinct E (40/45mm), Instinct Crossover AMOLED
Enduro 3, Descent Mk3 (43/51mm), D2 Mach 2 Pro
```

**To re-add them** (once the Store starts accepting them — updates use the same
key, so widening later is free): move each id back into `<iq:products>`, rebuild
the `.iq` (§5), and re-upload. If it still errors, that device isn't registered
yet; drop it again and try the rest. The cut was made by "newest generation", so
some 2024 devices (e.g. fenix 8) may already be acceptable — worth probing first.

## 2. Per-screen-family drawable folders

Each **screen family** (not each device) has its own drawables folder —
`resources-round-390x390/`, `resources-round-240x240/`,
`resources-rectangle-240x240/`, `resources-semioctagon-176x176/`, and so on (15
in total). Connect IQ auto-selects the folder matching a device's `deviceFamily`
qualifier, so **one folder covers every device in that family** — no per-device
folders, no `monkey.jungle` wiring. There is deliberately **no shared
`resources/drawables/` fallback**: every supported device must belong to a
family that has a folder, which keeps the mapping explicit.

`tools/rasterise-icons.sh` regenerates all folders from `icons/*.svg`:

- **Activity icons** scale with the screen — `icon = round(0.133·minDim + 12)`,
  the line through the two hand-tuned originals (44px @ 240px, 64px @ 390px).
- **Launcher icon** is the only manifest-declared (size-sensitive) asset, so a
  mismatch produces a benign "will be scaled" build note. Each family's launcher
  is its most-common size; `round-390x390`/`round-240x240` are pinned to the
  exact vívoactive 5 / FR745 sizes so the primary `./build.sh` is 0-warning.
  Across the full fleet, devices whose exact launcher size differs from their
  family default will emit that benign note — that's expected, not an error.

To add a device: if it lands in an existing family, just add the manifest entry.
If it introduces a **new** family, add a size row to `rasterise-icons.sh`, re-run
it, and add the manifest entry.

## 3. Store listing assets

- **App icon** — the Store listing needs a real icon (ours is still a
  placeholder teal disc). Replace `launcher_icon.png` in each drawable folder
  and provide whatever hero/store-icon sizes the portal asks for.
- **Screenshots** — capture from the simulator (File → Save screenshot). They're
  per-listing, not per-device, so a small hero set covering the app's states is
  enough — see [screenshots.md](screenshots.md). The portal states the required
  dimensions.
- **Text** — app name, short + long description, category, keywords, and a
  "what's new" note per release.

## 4. Permissions

We currently request: `Fit`, `FitContributor`, `Sensor`, `SensorHistory`,
`Communications`. The Store surfaces these to users at install time, so:

- Drop any you don't actually use — fewer permissions = less install friction.
- `Communications` is only needed once the backend sync (Strava labels) is
  wired; until then it can be removed. Re-add it when that lands.
- Be ready to explain each in the listing (why a spa logger needs them).

## 5. Build the store package (`.iq`)

The Store wants a single signed `.iq` that contains a build for **every** device
in the manifest, signed with your developer key.

- **VS Code:** run **"Monkey C: Export Project"** — it produces the `.iq`.
- **CLI:** roughly
  ```sh
  monkeyc -e -f monkey.jungle -o Sparmin.iq -y ~/.Garmin/ConnectIQ/developer_key -r
  ```
  (`-e` export/package, `-r` release. Check `monkeyc --help` for the current
  flags on your SDK.)

**Critical:** the `.iq` is signed with your developer key, and every future
update must use the **same key** or the Store treats it as a different app. Keep
`~/.Garmin/ConnectIQ/developer_key` backed up somewhere safe — losing it means
you can never update the published app.

## 6. Test before submitting

From the spec's acceptance criteria (§13, §15), at minimum:

- A **full real session on a physical watch** records a FIT activity that
  appears in Garmin Connect with one lap per activity, correct durations, per-lap
  HR, and the activity labels showing (validates the sport/sub-sport choice).
- **MIP colour legibility** on the real FR745 (the simulator only approximates
  its palette).
- **Memory headroom** on the smallest supported device (CIQ enforces a per-app
  memory cap; icons and cached bitmaps are the main cost here).
- Simulator pass across the device classes you're shipping.

## 7. Submit + review

1. Sign in to the [Connect IQ developer portal](https://apps.garmin.com/) with
   your Garmin account (the developer dashboard, not the consumer store).
2. Create the app, upload the `.iq`, fill in the listing text, upload the icon
   and screenshots, declare permissions.
3. Submit for review. Garmin reviews for functionality and guideline
   compliance; expect a few days and be ready for a round of feedback.

## 8. Updates & versioning

- Bump `Version.APP` in `source/Version.mc` — a v3 manifest has no version
  field, so that constant is the app's own record of what it is, and it's what
  the in-app **Settings → About** page shows. Keep it equal to the version you
  type into the store dashboard, or About will lie about which build is on the
  watch.
- Then rebuild the `.iq` (same key) and upload it as an update.
- The app **`id`** (the UUID in `manifest.xml`) never changes — it's the app's
  permanent identity across all updates.

## 9. Monetisation

Most Connect IQ apps are free. Garmin's paid-app support is limited and has
changed over time — if you want to charge, check the current Store monetisation
options in the developer docs. For a personal spa logger, free is the norm.

---

## Sparmin-specific notes

- The **backend** (Strava activity labels) is a separate deliverable and doesn't
  gate store submission. The watch queues its POST and retries, so a missing
  backend degrades gracefully — fine to publish the watch app first.
- Because the app records a **real FIT activity**, behave well with Garmin
  Connect: no phantom GPS, correct sport/sub-sport, laps that make sense. This is
  the main thing review (and users) will judge.
