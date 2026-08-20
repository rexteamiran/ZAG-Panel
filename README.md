<h1 align="center">ZAGROOO Panel</h1>

### 🌏 Readme in [Farsi](README_fa.md)

## Introduction

**ZAGROOO Panel** is a Cloudflare Workers / Pages proxy panel providing **VLESS**, **Trojan** and **Warp** configs alongside a **private DoH** server for cross-platform clients, with usage quotas, speed limits and expiry built in.

Every panel is deployed and centrally managed by the [ZAGROOO Wizard](https://github.com/rexteamiran/ZAG-Wizard).

## Features

- **VLESS / Trojan over WebSocket** on Cloudflare Workers and Pages
- **Warp / WoW** configs for Xray, Sing-box, Clash, WireGuard and Amnezia
- **Private DoH** server
- **Usage quotas** — total and daily volume caps with real byte accounting
- **Speed limits** — separate download and upload caps in KB/s
- **Expiry dates** — automatic shutdown when the subscription runs out
- **Subscriber portal** — a dedicated subscription page in English and Farsi
- **Central management** — every panel is controlled from a single ZAGROOO Wizard
- **Telegram bot** — subscriptions, single configs, quota and expiry alerts

## Installation

Deploy through the [ZAGROOO Wizard](https://github.com/rexteamiran/ZAG-Wizard). Manual deployment is not supported.

## Credits

ZAGROOO Panel is a fork of [BPB-Worker-Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel) by bia-pain-bache, licensed under GPL-3.0. Thanks to the original authors and contributors.

## License

[GPL-3.0](LICENSE)
