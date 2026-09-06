# Latest Handoff

Date: 2026-09-06
Timezone: Europe/Moscow

## Current work

Search reliability fixes for missing cheaper tours:

- Full Tourvisor result polling for up to 120 seconds per search, preserving
  blocks and decoder dictionaries. No fixed lastblock parameter.
- One repeat search for pending/failed operators, merged by tour ID.
- 30-second HTTP timeout and one repeat detail check.
- Explicit sold/obsolete tours excluded. Technical detail failures no longer
  imply sold. If main and short cards both expose booking controls, send with
  an explicit warning; otherwise skip unknown availability.
- Updated prices re-evaluated and sorted before limiting messages. Four parallel
  card checks; isolated card failures are logged and do not abort the scan.
- Check decoded meal, stars, dates and nights locally after resolving a card.
- Store all eligible observations, including those beyond the immediate limit.
  Preserve uncertainty warnings in observation reasons and best digests.
- `npm test`: eight regression cases. `npm run build`: TypeScript compilation.

## Runtime and settings

- Service: `cheap-tours-alerts`, Node.js 20, `dist/main.js`.
- `/root/cheap-tours-alerts` links to `/root/projects/cheap-tours-alerts`.
- SQLite: `data/tour-deals.sqlite`; presets and interval in SQLite override env
  initialization defaults. Do not print `.env` or subscriber identities.
- Preset: Minsk → Vietnam / Nha Trang; 2026-09-06 through 2026-10-25;
  12–18 nights; two adults; BB; at least 3 stars; 2700 USD; discount 20%.
- Interval: 1800 seconds after a completed check plus jitter; limit 10 messages
  per preset. No-deal reports disabled.

## Evidence and remaining limits

User example `/t/7621065950`, tour ID `99275210553110`, Crown Nguyen Hoang Hotel,
2352 USD, 2026-09-15, 14 nights, BB. Original provider excluded it on a detail
GetDatabaseFail error. Corrected provider accepted the card with uncertainty
warning in a read-only live verification.

The operator can still fail to return offers in a search even when a direct
card opens. Retry improves coverage but does not guarantee every offer.
A bounded search may still return partial results; inspect completeness logs.

## Operations

Read `OPERATIONS.md` section “Search reliability update — 2026-09-06”.
Use `npm test`, `npm run build`, systemd restart and logs for deployment checks.
Code/docs/tests only in GitHub; no database, secrets, dist or raw API captures.

## Deployment verification

- Tests: 8/8 passed; `npm run build` passed.
- Live search completed both requests at 100%; the retry added a late operator
  block and merged output contained 113 unique offers. The user's exact offer
  remained absent from this search despite its accessible direct card.
- Service restarted successfully at 14:42 Moscow on 2026-09-06 and reported
  active. First automatic scan started; inspect logs for completed-cycle totals.
