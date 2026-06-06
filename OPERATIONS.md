# Cheap Tours Alerts - Operations Guide

This file is the handoff document for restoring, maintaining, or continuing the bot from another chat/session.

## Current Production State

- Bot: `@CheapToursAlertsBot`
- Server project path: `/root/cheap-tours-alerts`
- systemd service: `cheap-tours-alerts`
- GitHub: `git@github.com:infoseoindex/cheap-tours-alerts.git`
- Main branch: `main`
- Runtime: Node.js 20 on Linux VPS
- Provider in use: `tourvisor-public`
- Database: SQLite at `/root/cheap-tours-alerts/data/tour-deals.sqlite`
- Secrets: `/root/cheap-tours-alerts/.env`

Do not commit `.env`, `data/`, `dist/`, or `node_modules/`. They are ignored by `.gitignore`.

## Core Commands

Run commands from the server:

```bash
cd /root/cheap-tours-alerts
npm run build
systemctl restart cheap-tours-alerts
systemctl status cheap-tours-alerts --no-pager
journalctl -u cheap-tours-alerts --since '30 minutes ago' --no-pager
node scripts/db-summary.cjs
git status --short --branch
git log --oneline -5
```

Push changes:

```bash
cd /root/cheap-tours-alerts
git add .
git commit -m 'Describe change'
git push
```

The repository uses a deploy key configured in local git:

```bash
git config core.sshCommand
```

## Bot Behavior Principles

- The bot is a practical alerts tool, not a marketing site.
- Telegram is the main control surface.
- Settings must be editable from Telegram where possible.
- A user pressing a menu button while the bot waits for text must not accidentally save that button as a setting.
- If input is invalid, the bot should say what is wrong in plain Russian/English.
- Automatic scanning must continue after restarts without manual `/check`.
- Do not spam blindly: use `max_alerts_per_check` and no-deal report interval.
- No-deal reports are useful to prove the bot is alive, but they should be configurable.

## Daily Handoff Rule

At the end of each working day or meaningful work session, update this file before stopping.

Always record:

- new decisions and product rules;
- changed Tourvisor endpoints, parameters, IDs, or currency mappings;
- new Telegram controls or changed input formats;
- bugs found and how they were fixed;
- open issues that still need checking;
- deploy, restore, or GitHub changes;
- current production state if it changed.

Then commit and push the documentation together with the code changes:

```bash
cd /root/cheap-tours-alerts
git status --short
git add .
git commit -m 'Update operations notes'
git push
```

Do not leave important operational knowledge only in chat. If another chat/session starts tomorrow, `OPERATIONS.md` must be enough to understand what happened and how to continue safely.

## Current Telegram Settings

The bot supports:

- `/menu`
- `/settings`
- `/status`
- `/check`
- `/pause`
- `/resume`
- `/last`

Editable from menu:

- current search summary;
- departure city
- country
- resort or whole country
- dates
- nights
- adults/children
- budget and currency
- hotel filter
- meal
- stars
- scan interval
- alerts per check
- no-deal report on/off
- no-deal report interval

People format:

```text
2/0
2,1
```

Dates format:

```text
07.06.2026-25.06.2026
2026-06-07-2026-06-25
```

Hotels format:

```text
Amiana, Regalia Gold, Virgo Hotel
```

Clear hotel filter:

```text
all
все
```

Whole-country resort search:

```text
all
все
```

## Tourvisor IDs And Directory

Tourvisor public search needs internal IDs, not only names.

Local known mappings live in:

```text
src/tourvisorDirectory.ts
```

Current known examples:

- Minsk: `57`
- Vietnam: `16`
- Nha Trang: `87`

If a city/country/resort is unknown, enter it as:

```text
Name:ID
Минск:57
Вьетнам:16
Нячанг:87
```

When adding new common destinations, update `src/tourvisorDirectory.ts`, rebuild, restart, commit, and push.

## Tourvisor Provider Rules

Provider:

```env
PROVIDER=tourvisor-public
TOURVISOR_MODSEARCH_URL=https://tourvisor.ru/xml/modsearch.php
TOURVISOR_MODRESULT_URL=https://search3.tourvisor.ru/modresult.php
```

Currency codes:

- RUB: `0`
- USD: `5`
- EUR: `6`

The provider keeps a small cookie session. If Tourvisor returns `401 Invalid session`, it refreshes cookies through `https://tourvisor.ru/search.php` and retries once.

Direct tour links are resolved through:

```text
https://tourvisor.ru/xml/modact.php?currency=<code>&tourid=<tourId>
```

Notifications should use the short link from:

```text
data.tour.share.searchlink
```

But the short `/t/<id>` link can become obsolete quickly. Always append the
long Tourvisor `tourid` that was checked through `modact.php`:

```text
https://tourvisor.ru/t/<shortId>#tvtourid=<longTourId>
```

If `modact.php` returns `error.errormessage`, especially `Wrong (obsolete)
TourID`, the deal must be treated as unavailable and skipped.

## Sold Tour Filtering

Sold tours are not useful and must not be sent.

Before sending a deal, the worker resolves it via `modact.php`. A deal is skipped if any of these are truthy:

- `data.sold`
- `data.tour.sold`
- `data.tour.notour`
- `error.errormessage` from `modact.php`

This mirrors Tourvisor frontend behavior: their JS switches the card to `SOLD_TOUR` when `data.sold` is present.

Do not send synthetic operator-minimum rows as deal alerts. They look like:

```text
operator-min:<requestId>:<operatorId>
```

These rows contain only an operator minimum price, not a concrete tour card. They cannot be reliably checked for sold/available status and should only be used as background market context or no-deal report data.

If sold tours still arrive, inspect the exact `tourid` with:

```bash
curl -s \
  -H 'accept: application/json,text/plain,*/*' \
  -H 'referer: https://tourvisor.ru/search.php' \
  -H 'user-agent: tour-deals-bot/0.1' \
  'https://tourvisor.ru/xml/modact.php?currency=5&tourid=TOUR_ID' | jq
```

Then extend `availabilityFromModact()` in `src/providers/tourvisorPublicProvider.ts`.

## No-Deal Reports

When no matching good deal is found, the bot can send a report showing:

- current budget
- dates/nights
- current minimum found
- checked variants count

Settings are stored in SQLite `kv`:

- `no_deal_reports_enabled`
- `no_deal_report_interval_seconds`
- `last_no_deal_report_at:<presetId>`

When calculating market minimum, keep the selected currency and set budget amount to `0`; this means no price limit while preserving USD/EUR/RUB.

## Alert Rules

Rules live in:

```text
src/rules.ts
```

A deal is good if:

- price is under configured budget, or
- price is at least `discountPercent` below stored baseline.

Current preference: send current actual matching variants every scan instead of permanent dedupe-only behavior, because tour availability changes quickly.

`sent_alerts` is still stored for history.

## Validation Rules

Validation lives in:

```text
src/presetValidation.ts
```

Validate both:

- after changing settings from Telegram;
- before running a search.

Validation should catch:

- missing or invalid departure ID;
- missing or invalid country ID;
- invalid region IDs;
- invalid date format/order;
- invalid nights range;
- invalid adults/children;
- invalid budget;
- invalid stars;
- menu-button text accidentally saved as hotel filter.

## Restore From GitHub

On a fresh server:

```bash
git clone git@github.com:infoseoindex/cheap-tours-alerts.git /root/cheap-tours-alerts
cd /root/cheap-tours-alerts
npm ci
cp .env.minsk-vietnam.example .env
```

Edit `.env` with real secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `SEARCH_PRESETS_JSON`
- exchange rates if needed

Build and run:

```bash
npm run build
```

Create systemd service:

```ini
[Unit]
Description=Cheap Tours Telegram Alerts Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/cheap-tours-alerts
EnvironmentFile=/root/cheap-tours-alerts/.env
ExecStart=/usr/local/bin/node /root/cheap-tours-alerts/dist/main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
systemctl daemon-reload
systemctl enable --now cheap-tours-alerts
systemctl status cheap-tours-alerts --no-pager
```

## Security Rules

- Never paste or commit real Telegram token into GitHub.
- Keep `.env` only on the server.
- Rotate the Telegram token if it was exposed in chat or logs.
- Keep GitHub deploy key scoped to this repository only.
- Do not commit SQLite database unless explicitly making a private operational backup.

## If Another Chat Continues This Work

Start by checking:

```bash
cd /root/cheap-tours-alerts
git status --short --branch
systemctl is-active cheap-tours-alerts
journalctl -u cheap-tours-alerts --since '30 minutes ago' --no-pager
node scripts/db-summary.cjs
```

Then read:

- `OPERATIONS.md`
- `README.md`
- `src/worker.ts`
- `src/telegram.ts`
- `src/providers/tourvisorPublicProvider.ts`
- `src/tourvisorDirectory.ts`
- `src/presetValidation.ts`
