# ZAGROOO Panel

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
