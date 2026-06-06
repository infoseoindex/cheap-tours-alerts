# Cheap Tours Alerts Telegram Bot

Telegram bot for cheap vacation tour alerts from Tourvisor public search.

## What It Does

- checks configured searches every 1-5 minutes;
- filters by departure city, country/resort, dates, nights, adults/children, budget, meal and hotel stars;
- supports whole-country or specific-resort monitoring;
- supports optional hotel-name filters;
- supports budgets in RUB, USD and EUR;
- alerts when a tour is under budget or at least N% cheaper than its stored baseline;
- sends current matching variants every scan because tours can become unavailable quickly;
- filters out sold Tourvisor deals before notifying;
- can send configurable no-deal reports with the current minimum;
- stores price history in SQLite;
- sends Telegram messages with a direct `/t/...` Tourvisor link.

## Recommended Architecture

Use a permanently running VPS/server for the worker. Vercel is still useful for a future admin UI, but Vercel Hobby cron is limited to once per day. For 1-minute checks, use a VPS or Vercel Pro cron.

## Setup

```bash
cp .env.minsk-vietnam.example .env
npm install
npm run dev
```

For Docker:

```bash
docker compose up -d --build
```

## Telegram Bot

1. Create a bot through `@BotFather`.
2. Put the token into `TELEGRAM_BOT_TOKEN`.
3. Start the bot in Telegram.
4. Put your numeric chat id into `TELEGRAM_ADMIN_CHAT_ID`.

The bot supports:

- `/start`
- `/status`
- `/last`
- `/check`
- `/pause`
- `/resume`

## Tourvisor Provider

Current production provider:

```env
PROVIDER=tourvisor-public
TOURVISOR_MODSEARCH_URL=https://tourvisor.ru/xml/modsearch.php
TOURVISOR_MODRESULT_URL=https://search3.tourvisor.ru/modresult.php
```

Operational details, restore steps, and current project rules live in `OPERATIONS.md`.

## Search Presets

Edit `SEARCH_PRESETS_JSON` in `.env`. Example:

```json
[
  {
    "id": "egypt-ai",
    "enabled": true,
    "title": "Egypt AI",
    "departureCity": "Moscow",
    "countries": ["Egypt"],
    "resorts": ["Sharm El Sheikh"],
    "dateFrom": "2026-08-01",
    "dateTo": "2026-08-20",
    "nightsFrom": 7,
    "nightsTo": 10,
    "adults": 2,
    "children": 0,
    "meal": "AI",
    "hotelStarsMin": 5,
    "budget": { "amount": 1300, "currency": "USD" },
    "discountPercent": 20
  }
]
```

## Operations

Read `OPERATIONS.md` before continuing this project from another chat/session. It documents:

- server paths;
- systemd service;
- GitHub backup;
- deploy commands;
- Tourvisor IDs;
- sold-tour filtering;
- validation rules;
- restore-from-scratch flow.
