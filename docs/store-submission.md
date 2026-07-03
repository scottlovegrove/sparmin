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

- [ ] Broaden the device list in `manifest.xml` (`<iq:products>`) to the watches you want to support.
- [ ] Add a **shared fallback** drawable set so every listed device builds (see §2).
- [ ] Confirm every listed device compiles, and check memory on the smallest one.
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

You don't have to hand-type these. In VS Code with the Monkey C extension, run
**"Monkey C: Edit Products"** (or the manifest editor) — it gives a checklist of
every device the installed SDK knows about, with a "select all compatible"
option. Compatibility is filtered by `minApiLevel` in the manifest (currently
`3.1.0`), so watches older than that are excluded automatically.

Two things to keep in mind as you widen the list:

- **Every listed device must build.** The compiler resolves resources per
  device; if a device has no matching drawables it fails. That's what the shared
  fallback in §2 is for.
- **Every listed device is a support commitment.** The Store only offers the app
  to devices you list, and users will expect it to work. Test at least one
  representative of each screen class (small round MIP, large round AMOLED, …).

## 2. Shared fallback resources

Right now each device has its **own** drawables folder
(`resources-vivoactive5/`, `resources-fr745/`) and there is **no shared
fallback** — deliberately, for a clean two-device build. If you add a third
device to the manifest today, it won't build (unresolved `Rez.Drawables.st_*`
and launcher icon).

To go store-wide, add a default set that any device falls back to, and let the
tuned folders override only where you care:

```
resources/drawables/            ← shared fallback (used by any device)
  drawables.xml                 ← declares LauncherIcon + st_* bitmaps
  launcher_icon.png             ← a mid-size default (e.g. 64x64)
  st_*.png                      ← default icon set (e.g. 64px)
resources-round-240x240/        ← optional: tune small round MIP watches as a group
resources-fr745/                ← device-specific tuning (overrides the above)
```

Connect IQ auto-selects the most specific matching folder. Qualifiers work by
**screen shape and size**, not just device id — e.g. `resources-round-390x390`
covers *every* round 390px watch, so you cover a whole family with one folder
instead of one-per-device. The rasterisation is already scripted (see the
`rsvg-convert` calls in the Phase-3 commit) — re-run it at whatever sizes the
groups need.

Adding the fallback reintroduces a benign build note ("resources will be
overridden with higher precedence") on the tuned devices — that's the override
working, not an error.

## 3. Store listing assets

- **App icon** — the Store listing needs a real icon (ours is still a
  placeholder teal disc). Replace `launcher_icon.png` in each drawable folder
  and provide whatever hero/store-icon sizes the portal asks for.
- **Screenshots** — capture from the simulator (File → Save screenshot) for the
  device classes you support. The portal states the required dimensions.
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
  appears in Garmin Connect with one lap per station, correct durations, per-lap
  HR, and the station labels showing (validates the sport/sub-sport choice).
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

- Bump the app version, rebuild the `.iq` (same key), and upload it as an update.
- The app **`id`** (the UUID in `manifest.xml`) never changes — it's the app's
  permanent identity across all updates.

## 9. Monetisation

Most Connect IQ apps are free. Garmin's paid-app support is limited and has
changed over time — if you want to charge, check the current Store monetisation
options in the developer docs. For a personal spa logger, free is the norm.

---

## Sparmin-specific notes

- The **backend** (Strava station labels) is a separate deliverable and doesn't
  gate store submission. The watch queues its POST and retries, so a missing
  backend degrades gracefully — fine to publish the watch app first.
- Because the app records a **real FIT activity**, behave well with Garmin
  Connect: no phantom GPS, correct sport/sub-sport, laps that make sense. This is
  the main thing review (and users) will judge.
