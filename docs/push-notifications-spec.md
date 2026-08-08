# Push Notifications — Technical Spec

**Status:** built.
**Date:** 8 August 2026

Extends [`watch-sync-spec.md`](./watch-sync-spec.md); section references prefixed
`WS§` point at that document, `SL§` at [`spa-logger-spec.md`](./spa-logger-spec.md).
Where they disagree, this one is newer.

The goal: when a session arrives from a linked watch, the user is told — without
opening the app.

---

## 1. Why this shape

`WS§` made the watch push a session the moment you end it. The companion stores
it and says nothing. So the reassurance that linking a watch was supposed to buy
— _it worked, it's in_ — is still only available by opening the app and looking,
which is the thing the watch link was meant to remove.

A push notification is the smallest thing that closes that loop. It is also the
only notification worth building today: every other candidate (streak reminders,
weekly summaries) needs a scheduler, and there is no cron in this Worker.

### 1.1 Two settings, and they are different kinds of thing

This is the crux, and getting it backwards produces a settings screen that lies.

| Setting                       | Scope               | Why                                                                                                                                         |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enable push notifications** | Per browser install | Permission is granted to an origin _in one browser_, and the endpoint it returns is good only for that one. There is no account-level "on". |
| **Activity uploaded**         | Per account         | Muting an event is a statement about the event, not about one browser. Muting it on your phone should mute it on your laptop.               |

A single account-wide master switch would show "on" on a device that never asked
for permission and will never buzz. A per-device type toggle would mean turning
the same thing off once per device.

### 1.2 Only on a session that was created

`ingestWatchSession` answers `created`, `merged` or `duplicate` (`WS§3.6`). Only
`created` notifies.

- `merged` — the visit was already here from a FIT import. The user imported it
  themselves; telling them about it is telling them something they did.
- `duplicate` — the watch's offline queue re-sending. The queue re-posts after
  any failure, including a response lost on the way back (`WS§3.3`), so this is
  normal operation and can happen long after the fact.

---

## 2. Encryption and authorization

`worker/web-push.ts` implements RFC 8291 `aes128gcm` and RFC 8292 VAPID directly
on `crypto.subtle`.

### 2.1 Why not a library

| Option                        | Problem                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `webpush-webcrypto`           | Sends draft-04 `Content-Encoding: aesgcm` under `Authorization: WebPush …`. Ships no types. |
| `@block65/webcrypto-web-push` | Same draft-04 scheme.                                                                       |
| `web-push`                    | Node-only (`jws`, `http_ece`, https agents). Will not run in workerd.                       |

Apple's push service requires `aes128gcm` and the `vapid` authorization scheme.
Either WebCrypto library would therefore fail on **precisely the platform this
feature exists for** — an iOS PWA on a home screen — while working in Chrome and
Firefox, so the gap would not show up in development.

### 2.2 What makes hand-rolling safe

RFC 8291 §5 publishes a complete worked example: subscription keys, ephemeral
sender key, salt, plaintext and the exact expected body.
`test/web-push-crypto.test.ts` reproduces it byte for byte. A derivation that
drifts fails there rather than in production, which is more assurance than a
round-trip against our own decrypt would give — a wrong info string is wrong
symmetrically and would round-trip cleanly.

### 2.3 Keys

`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are secrets; `VAPID_SUBJECT` is a var in
`wrangler.jsonc` (it is published in every token). Encoding is the one every tool
in this space uses — raw uncompressed public point, raw private scalar, both
base64url — so `web-push generate-vapid-keys` output pastes straight in.

**All three are optional.** With any missing, `vapidKeys()` returns null,
`/api/push/config` reports `publicKey: null`, and the settings card says
notifications aren't available on this server. A fresh checkout is a working app
without push, not a broken one.

---

## 3. Data model

Migration `0007_push_notifications.sql`. Both tables cascade from `user`, so
account deletion (`SL§`) takes them without changes to `deleteAccount`.

### 3.1 `push_subscriptions`

One row per browser install. `endpoint`, `p256dh` and `auth` are the browser's
`PushSubscription.toJSON()` verbatim.

**The endpoint is a capability URL.** Anyone holding it and the two keys can push
to that device. Unlike a device token (`WS§2.4`) it cannot be hashed at rest,
because sending needs it verbatim — so the mitigation is that it never travels
back out. `GET /api/push/config` returns `endpointHash` (SHA-256) instead, and the
browser recognises its own row by hashing the endpoint it already holds.

**Keyed on the endpoint, not the account.** `PUT` upserts on
`push_subscriptions_endpoint_unique` and re-points `user_id`. A browser returns
the same endpoint until permission is revoked, and a shared machine can move
between accounts — a second row would leave the first user receiving the second
user's sessions.

**Capped at 20 per account**, oldest dropped on the write path (the discipline
`sweepStaleCodes` uses; there is no cron). Not about real users, who have a
handful: nothing stops a signed-in client `PUT`ting thousands of distinct
endpoints, and each would then be encrypted and posted to on every upload inside a
`waitUntil` the Worker must finish. The row just written is held out of the
eviction candidates explicitly — `created_at` is unix _seconds_, so several
registrations inside one second are unordered, and sorting alone would let the
browser that just subscribed be the one evicted.

### 3.2 `notification_prefs`

`user_id` primary key, one boolean per notification type. **Absence of a row means
nothing is muted**, so the common case costs no write and a type added later
defaults to on for everyone who has never opened the screen.

---

## 4. Endpoints

All behind the existing cookie guard — `/api/push/*` is not in `PUBLIC_PATHS`, so
it is private by the middleware's deny-by-default rather than by remembering.

| Method   | Path                          | Body                                           | Response                                      |
| -------- | ----------------------------- | ---------------------------------------------- | --------------------------------------------- |
| `GET`    | `/api/push/config`            | —                                              | `{ publicKey, preferences, subscriptions[] }` |
| `PUT`    | `/api/push/subscriptions`     | `{ endpoint, keys: { p256dh, auth }, label? }` | `204`                                         |
| `DELETE` | `/api/push/subscriptions/:id` | —                                              | `204` / `404`                                 |
| `PATCH`  | `/api/push/preferences`       | `{ sessionUploaded }`                          | `204`                                         |

One `GET` for the whole card rather than three. `PUT` because it has to be
idempotent: the client re-sends its endpoint whenever the server's list doesn't
already contain it (§6), which repairs a row lost to the cap or to an account
deletion and re-points one left over from a previous account. `DELETE` accepts
another of the caller's own devices, which is the only way to stop a phone you no
longer have.

`404` rather than `403` on someone else's id, matching the device routes: a wrong
guess learns nothing about whether the id exists.

---

## 5. Send path

Fired from the `POST /api/sessions/watch` handler, inside
`c.executionCtx.waitUntil`.

**Behind `waitUntil` because the watch is holding the response open** and
re-queues the whole payload on anything that isn't a 2xx (`WS§3.6`). A slow push
service must not turn a stored session into a retry.

Order, cheapest question first: no VAPID keys → return; type muted → return; no
subscriptions → return. Then send in slices of 5 — encryption is several WebCrypto
operations per message and each send is an outbound request, and nothing is
waiting on the result.

Per-message timeout is 10s. **There is deliberately no retry:** `TTL` already asks
the push service to hold the message and keep trying the _device_, so retrying the
_service_ duplicates work it is already doing — and a missed "session saved" does
not justify a backoff loop behind a response that has already been sent.

| Response      | Action                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx           | Done.                                                                                                                                                |
| 404, 410      | Delete the row. The install is gone — uninstalled, or permission revoked.                                                                            |
| anything else | Keep the row, log. A timeout or 500 is temporary; dropping a subscription over a blip would silently stop notifications with nothing to show for it. |

Failures emit a structured `push_delivery_failed` warning carrying statuses and
row ids — **never the endpoint, never the payload**. Nothing downstream can see a
push fail (it happens after the response, for a user who is not looking), so an
outage would otherwise present as notifications quietly stopping.

### 5.1 Content

`sessionUploadedNotification` in `src/lib/push-payload.ts` — the contract between
the Worker that builds it and the service worker that renders it.

- title `Session saved`, body `39m · 4 stays`, from the payload with no extra read
- `tag: session-<id>` so a retried delivery replaces rather than stacks
- `url: /` — there is no per-session route; the list on `/` opens with the newest
  visit at the top

`parsePushPayload` is forgiving about unknown fields and strict only about `title`
and `body`. A browser can be running a service worker weeks older than the Worker
that sent the message, because an update is only taken when the user accepts the
banner.

---

## 6. Client

`src/lib/use-push.ts`. Five states that are not "on" or "off", because each is a
different sentence and none is fixable by pressing the toggle — so no toggle is
shown:

| State           | Cause                                  | What the card says                    |
| --------------- | -------------------------------------- | ------------------------------------- |
| `unsupported`   | No Push API                            | This browser can't show notifications |
| `needs-install` | iOS, not on the home screen            | Add Sparmin to your Home Screen       |
| `unconfigured`  | Deployment has no VAPID pair           | Not available on this server          |
| `blocked`       | `Notification.permission === 'denied'` | Allow them in your browser's settings |
| `loading`       | —                                      | Loading…                              |

**`needs-install` has to be detected separately.** iOS gives a Safari tab no
`PushManager` at all — not a denied permission, nothing — so an uninstalled iPhone
is indistinguishable from an ancient browser. Telling someone one tap away from
working notifications that their browser can't do them is the worst available
answer.

Turning off unsubscribes locally _first_, then deletes the row: unsubscribing is
the half that actually stops the buzzing and the half that cannot be done from
another device later. If the `PUT` fails when turning on, the local subscription is
rolled back — a browser subscribed to a push service the server has no record of
is a device that can never be turned off from the settings list.

### 6.1 A local subscription is not proof of a server row

`pushManager.getSubscription()` returning something means this browser is
subscribed _to a push service_. It says nothing about whether the account still
has a row for it: a `PushSubscription` survives signing out, and the per-account
cap (§3.1) can evict one.

So on load, a local subscription whose hash is absent from `config.subscriptions`
is re-`PUT` before the card settles on "on". Without that, two things go wrong
quietly — the card reads "on" while this browser receives nothing, and on a shared
machine the row stays assigned to the previous account, so this browser shows
_their_ session notifications.

### 6.2 No service worker at all

`navigator.serviceWorker.ready` never settles when nothing is registered, which is
the normal state under `vite dev` — the PWA plugin registers no worker there. So
`getRegistration()` is checked first and `ready` only awaited when there is one. A
bare `ready` leaves the card on "Loading…" for ever with nothing to indicate why.

---

## 7. Testing

No component tests; React is verified by hand (`apps/companion/AGENTS.md`).

- `test/web-push-crypto.test.ts` — the RFC 8291 §5 vector, VAPID JWT structure and
  signature verification against the advertised key.
- `test/push.test.ts` — the guard covers the prefix, idempotent upsert, endpoint
  re-pointing, the per-account cap, ownership isolation, preference defaults,
  cascade on account deletion.
- `test/push-send.test.ts` — created-only, mute, duplicate and merge silence,
  410/404 pruning, 500 retention, and that a push failure never changes the
  ingest response.
- `src/lib/push-payload.test.ts`, `src/lib/push-label.test.ts` — copy and browser
  naming.
- `src/pwa-config.test.ts` — reads `src/sw.ts` as text to pin the `push` and
  `notificationclick` listeners, which nothing else covers: the delivery tests
  stop at a mocked fetch.

The worker project pins a throwaway VAPID pair in `vitest.config.ts`. Without it
every push test takes the not-configured branch, asserts nothing, and passes.

---

## 8. Deferred

- **Any scheduled notification** (streak reminders, weekly summaries) — needs a
  cron trigger and a `scheduled()` export, neither of which exists.
- **Retry with backoff** — see §5.
- **A per-session deep link** — needs a route per session first.
- **Notifying on `merged`** — see §1.2. If manual import is ever dropped, revisit.
