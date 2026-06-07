import { DealRules } from "./rules.js";
import { assertValidPreset } from "./presetValidation.js";
import { Storage } from "./storage.js";
import { TelegramNotifier } from "./telegram.js";
import type { SearchPreset, TourDeal, TourProvider } from "./types.js";

export class Worker {
  private running = false;
  private paused = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly presets: SearchPreset[],
    private readonly provider: TourProvider,
    private readonly storage: Storage,
    private readonly rules: DealRules,
    private readonly notifier: TelegramNotifier,
    private readonly defaultIntervalSeconds: number
  ) {}

  start(): void {
    this.scheduleNext(1000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  status(): string {
    const presets = this.storage.getSearchPresets();
    const active = presets.filter((preset) => preset.enabled).length;
    return [
      `Status: ${this.paused ? "paused" : "active"}`,
      `Running now: ${this.running ? "yes" : "no"}`,
      `Notifications: ${this.paused ? "off" : "on, automatic scan is enabled"}`,
      `Active presets: ${active}`,
      `Subscribers: ${this.storage.listActiveSubscriberChatIds().length}`,
      `Interval: ${this.getIntervalSeconds()}s`,
      `Alerts per check: ${this.storage.getMaxAlertsPerCheck(10) || "unlimited"}`,
      `No-deal reports: ${this.storage.getNoDealReportsEnabled(false) ? `on, every ${this.storage.getNoDealReportIntervalSeconds(3600)}s` : "off"}`,
      `Best digest: hourly, last ${this.storage.getLastBestDigestAt() ?? "never"}`,
      `Last run: ${this.storage.getLastRun() ?? "never"}`
    ].join("\n");
  }

  async checkOnce(): Promise<void> {
    if (this.running) return;
    if (this.paused) return;

    this.running = true;
    try {
      const presets = this.storage.getSearchPresets();
      for (const preset of presets.filter((item) => item.enabled)) {
        await this.checkPreset(preset);
      }
      this.storage.setLastRun(new Date());
    } finally {
      this.running = false;
    }
  }

  private async checkPreset(preset: SearchPreset): Promise<void> {
    assertValidPreset(preset);
    const deals = this.filterByHotels(preset, await this.provider.search(preset));
    const maxAlerts = this.storage.getMaxAlertsPerCheck(10);
    let sent = 0;
    let goodFound = false;

    for (const deal of deals) {
      if (this.isSyntheticDeal(deal)) {
        continue;
      }

      const decision = this.rules.evaluate(preset, deal);
      this.storage.savePrice(preset.id, deal, decision.priceRub);

      if (!decision.isGood) {
        continue;
      }

      const resolvedDeal = this.provider.resolveDealLink ? await this.provider.resolveDealLink(deal) : deal;
      if (resolvedDeal.isAvailable === false) {
        continue;
      }

      goodFound = true;
      this.storage.recordDealObservation(preset.id, resolvedDeal, decision.priceRub, decision.reasons);
      await this.notifier.sendDeal(preset, resolvedDeal, decision.reasons);
      this.storage.markAlertSent(preset.id, resolvedDeal, decision.reasons);
      sent += 1;

      if (maxAlerts > 0 && sent >= maxAlerts) {
        break;
      }
    }

    if (!goodFound) {
      await this.sendNoDealReportIfDue(preset, deals);
    }

    await this.sendBestDigestIfDue();
  }

  private async sendBestDigestIfDue(): Promise<void> {
    const last = this.storage.getLastBestDigestAt();
    const lastTime = last ? new Date(last).getTime() : 0;
    if (Number.isFinite(lastTime) && Date.now() - lastTime < 3600_000) return;

    const bestDeals = this.storage.listBestDealObservationsSince(new Date(Date.now() - 3600_000).toISOString(), 5);
    this.storage.setLastBestDigestAt(new Date());
    if (bestDeals.length === 0) return;

    await this.notifier.sendBestDealsDigest(bestDeals, "Лучшие туры за прошлый час / Best tours in the last hour");
  }

  private async sendNoDealReportIfDue(preset: SearchPreset, scopedDeals: Awaited<ReturnType<TourProvider["search"]>>): Promise<void> {
    if (!this.storage.getNoDealReportsEnabled(false)) return;
    if (!this.isNoDealReportDue(preset.id)) return;

    const marketPreset = preset.budget ? { ...preset, budget: { ...preset.budget, amount: 0 } } : preset;
    const marketDeals = scopedDeals.length > 0 ? scopedDeals : this.filterByHotels(preset, await this.provider.search(marketPreset));
    const minDeal = marketDeals.reduce<(typeof marketDeals)[number] | undefined>((best, deal) => {
      if (!best || deal.price.amount < best.price.amount) return deal;
      return best;
    }, undefined);
    const resolvedMinDeal =
      minDeal && !this.isSyntheticDeal(minDeal) && this.provider.resolveDealLink
        ? await this.provider.resolveDealLink(minDeal)
        : minDeal;

    await this.notifier.sendNoDealReport(preset, {
      checkedDeals: marketDeals.length,
      minDeal: resolvedMinDeal?.isAvailable === false ? undefined : resolvedMinDeal
    });
    this.storage.setLastNoDealReportAt(preset.id, new Date());
  }

  private isNoDealReportDue(presetId: string): boolean {
    const last = this.storage.getLastNoDealReportAt(presetId);
    if (!last) return true;

    const lastTime = new Date(last).getTime();
    if (!Number.isFinite(lastTime)) return true;

    const elapsedSeconds = Math.round((Date.now() - lastTime) / 1000);
    return elapsedSeconds >= this.storage.getNoDealReportIntervalSeconds(3600);
  }

  private filterByHotels(preset: SearchPreset, deals: TourDeal[]): TourDeal[] {
    const names = preset.hotelNames?.map(normalizeHotelName).filter(Boolean) ?? [];
    if (names.length === 0) return deals;

    return deals.filter((deal) => {
      const haystack = normalizeHotelName([deal.hotelName, deal.title].filter(Boolean).join(" "));
      return names.some((name) => haystack.includes(name));
    });
  }

  private isSyntheticDeal(deal: TourDeal): boolean {
    return deal.externalId.startsWith("operator-min:");
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(async () => {
      try {
        await this.checkOnce();
      } catch (error) {
        console.error("Check failed", error);
      } finally {
        const jitterMs = Math.round(Math.random() * 10_000);
        this.scheduleNext(this.getIntervalSeconds() * 1000 + jitterMs);
      }
    }, delayMs);
  }

  private getIntervalSeconds(): number {
    return this.storage.getCheckIntervalSeconds(this.defaultIntervalSeconds);
  }
}

function normalizeHotelName(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}
