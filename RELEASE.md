# ZAGROOO Panel

## 1.3.2 — design system v2, and a full engineering pass

The shared design system was rebuilt and applied to every page (see
DESIGN.md): components reference tokens only, interactive elements signal
with colour instead of movement, and the last raw colour literals are gone
from page CSS. Event pills carry words with their colours, numbers that
change live render in tabular mono digits, and modals share one teal-deep
scrim.

A full review also fixed defects that shipped in earlier versions:

- The admin panel's "random Trojan password" button generated a string
  containing the build placeholder instead of random characters — the
  inlined script is now spliced safely, so the generated password is real.
- Trojan connections lost the first bytes of every tunneled request to an
  off-by-two in the header parser.
- The operator event log at `/{securePath}/log` never loaded: its page
  called the wrong URL.
- Subscriber-portal app cards and the admin panel's API-key list could
  inject markup (XSS); both escape now.
- The DoH endpoint forwarded visitors' cookies to the upstream resolver.
- Truncated VLESS headers were parsed past the buffer end and failed
  silently instead of being rejected.
- A malformed NAT64 prefix crashed the retry path with an opaque error.
- Malformed JSON to the auth endpoints returned 500s; password changes now
  enforce the same policy the login form does, server-side.
- Saving settings could bake pre-update values into the redeployed script
  when the dataset write raced the script build.

## 1.3.1 — the event log

New: `/{securePath}/log`. Everything the panel catches — a request that died,
a failed usage flush, Telegram delivery problems, failed login attempts — is
recorded in the panel's own store and shown on one page: what broke, from
which subsystem, when, and the detail underneath. Filter by level or text,
clear it in one click. Reading it needs an admin session, like the panel.

## 1.3.0 — D1-only storage and a machine API for the dashboard

### Breaking: KV is gone, D1 is the only store

Every panel now binds the account's shared `zagrooo-panels` D1 database as
`zag_db` and namespaces its rows with its own panel id. Panels deployed before
this version cannot self-update into it — reinstall them once with the current
wizard. One database serves every panel on the account, so the free plan's
ten-database cap no longer bounds how many panels you can run.

Usage flushes moved from 30s to a two-minute cadence (or 20 MB, whichever
first). Quota enforcement stays exact — pending bytes count in memory at the
gate — but reported totals can lag up to two minutes.

### New: the panel is the API

- `POST /api/update` — redeploy from the latest release with an API key, no
  admin session or Cloudflare token needed.
- `PUT` joined the CORS allow-list, so a browser dashboard can talk to panels
  directly.

## 1.2.1

- Fixed the release build failing on a clean checkout: the template export ran
  before the output directory was created, so it worked locally and failed in
  CI every time.

## 1.2.0 — security and correctness

### New: templates

Twenty-four ready-made setups, so a panel can be configured without reading a
single field. The admin panel keeps all of them — a template just fills them
in, and you still press Apply.

Templates cover real situations: mobile data, home ADSL, heavy filtering, total
blackout, gaming, streaming, weak devices, each major client, WARP, family
filtering, AI and sanctioned sites, developer tooling, and Iran-direct routing.

**Every enabled template also gets its own subscription link.** The subscriber
page now asks for a connection type first — Normal, Fragment, Raw, Warp,
Warp Pro — and then lists the setups you published, each with its own links.
Customers choose what works on their network instead of asking you.

You can save your current settings as a template, choose which templates
customers see, and back the whole set up to a JSON file or import one.

Template links change only what a subscription renders; nothing about the
panel's stored settings changes. Settings are now scoped to each request, so
two customers on two different template links can never read each other's
configuration.

### Fixed: a subscription link could hand out your own settings

The subscription router fell through between formats. A request to
`/sub/normal` with no `?app=` — the exact link the subscriber portal
advertised as its main one — ended up returning the settings export, including
chain-proxy and upstream-proxy credentials, proxy IPs and prefixes.

**Update as soon as you can, and treat any credential that was in your proxy
settings as exposed.**

### Fixed: upgrading a panel wiped its settings

On the first request after a version change, a panel could overwrite its own
DNS, ports, clean IPs, chain proxy, routing rules and custom subscriptions with
factory defaults. Upgrades now migrate rather than reset.

### Other fixes

- Usage accounting no longer loses bytes when several connections flush at
  once, and no longer undercounts when more than one isolate is live.
- A panel that paused itself on a quota or an expiry now comes back on its own
  once the quota is raised, the expiry extended, or the month rolls over. A
  pause you asked for still sticks.
- Monthly reset now works on a panel that has already hit its quota.
- Status notes no longer read "expires today" for a day after expiry, and are
  built with the protocol the panel actually serves.
- API responses carry CORS headers, so the wizard can read them.
- An API key no longer writes to storage on every request — that used to
  exhaust a KV-only panel's free write quota in about nine minutes.
- A malformed chain proxy reports a validation error instead of a 500.
- A missing client IP no longer locks a customer out of a device-limited panel.
- Usage headers are no longer stamped onto 404 and fallback responses.


## 1.1.0

- **Status notes in the client**: the subscription can carry unroutable
  entries whose names show the remaining volume and days, so a customer sees
  their own status inside their VPN app without being messaged.
- **Settings API** at `/api/settings`, so the wizard can push a saved profile
  through the panel's own validation rather than writing raw values.
- The panel now records where it lives, so the wizard dashboard builds its
  links from stored values instead of parsing the deployed script.

## 1.0.1

- Fixed the Limits section in the admin panel: it called the API one path
  level too high, which dropped the secure path and returned Not Found.

Deployed and managed by the [ZAGROOO Wizard](https://github.com/rexteamiran/ZAG-Wizard).

## What is new

- **Usage quotas** with real byte accounting, measured on the proxy relay
  rather than estimated from request counts.
- **Speed limits** for download and upload, in KB/s.
- **Expiry dates** and a **device limit**, with the panel disabling itself and
  reporting why when any limit is reached.
- **Subscriber portal** at `/{securePath}/sub/{subToken}`: usage meters, a
  30-day history chart, subscription links and QR codes, in English and Farsi.
- **`subscription-userinfo` headers** on every subscription format, so clients
  draw their own usage bars.
- **Machine API** at `/{securePath}/api/*` behind a panel API key, which is how
  the wizard manages the panel remotely.
- **Telegram alerts** at 80% and 100% of quota, and 3 days before expiry.

## Accounting accuracy

Counted bytes are the proxy payload. TLS, TCP and WebSocket framing overhead is
not included, and traffic in flight when an isolate is torn down is lost, so the
figure runs roughly 3-8% below what an ISP would bill. It is meant for managing
subscriptions, not for billing to the byte.

## Storage

Counters go to D1 when the wizard provisioned one, otherwise to KV with
buffered writes. Speed limiting and device counting are per-isolate, which makes
them soft ceilings rather than hard guarantees.
