# Tour Deals Telegram Bot

MVP worker for cheap vacation tour alerts from Tourvisor-style sources.

## What It Does

- checks configured searches every 1-5 minutes;
- filters by departure city, country/resort, dates, nights, adults/children, budget, meal and hotel stars;
- supports budgets in RUB, USD and EUR;
- alerts when a tour is under budget or at least N% cheaper than its stored baseline;
- deduplicates already sent tour alerts;
- stores price history in SQLite;
- sends Telegram messages with a direct tour link.

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

The production-preferred path is the official Tourvisor XML/API gateway. Tourvisor publishes paid API products for search and hot tours, so the exact search endpoint and required IDs should come from their support/account docs.

Set:

```env
PROVIDER=tourvisor-api
TOURVISOR_API_BASE_URL=...
TOURVISOR_API_KEY=...
```

If you later decide to use browser collection, switch to:

```env
PROVIDER=tourvisor-browser
```

Then complete the selector mapping in `src/providers/tourvisorBrowserProvider.ts` after capturing the live search page/network responses.

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

## Next Step

After you get Tourvisor API access or capture one real search response from the browser Network tab, fill the exact parameter mapping in `src/providers/tourvisorApiProvider.ts`. The rest of the worker is already isolated from that detail.

Russian capture checklist: `TOURVISOR_CAPTURE_RU.md`.
