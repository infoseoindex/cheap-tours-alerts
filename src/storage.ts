import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SearchPreset, TourDeal } from "./types.js";

export class Storage {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  getLastRun(): string | undefined {
    const row = this.db.prepare("select value from kv where key = ?").get("last_run_at") as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setLastRun(date: Date): void {
    this.db
      .prepare("insert into kv(key, value) values(?, ?) on conflict(key) do update set value = excluded.value")
      .run("last_run_at", date.toISOString());
  }

  initializeSearchPresets(presets: SearchPreset[]): void {
    if (this.getValue("search_presets_json")) return;
    this.setValue("search_presets_json", JSON.stringify(presets));
  }

  getSearchPresets(): SearchPreset[] {
    const raw = this.getValue("search_presets_json");
    return raw ? (JSON.parse(raw) as SearchPreset[]) : [];
  }

  saveSearchPresets(presets: SearchPreset[]): void {
    this.setValue("search_presets_json", JSON.stringify(presets));
  }

  getCheckIntervalSeconds(defaultValue: number): number {
    const raw = this.getValue("check_interval_seconds");
    const parsed = raw ? Number(raw) : defaultValue;
    return Number.isFinite(parsed) && parsed >= 60 ? parsed : defaultValue;
  }

  setCheckIntervalSeconds(seconds: number): void {
    this.setValue("check_interval_seconds", String(seconds));
  }

  getMaxAlertsPerCheck(defaultValue = 10): number {
    const raw = this.getValue("max_alerts_per_check");
    const parsed = raw ? Number(raw) : defaultValue;
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultValue;
  }

  setMaxAlertsPerCheck(value: number): void {
    this.setValue("max_alerts_per_check", String(value));
  }

  getNoDealReportsEnabled(defaultValue = true): boolean {
    const raw = this.getValue("no_deal_reports_enabled");
    if (raw === undefined) return defaultValue;
    return raw === "1" || raw === "true";
  }

  setNoDealReportsEnabled(value: boolean): void {
    this.setValue("no_deal_reports_enabled", value ? "1" : "0");
  }

  getNoDealReportIntervalSeconds(defaultValue = 3600): number {
    const raw = this.getValue("no_deal_report_interval_seconds");
    const parsed = raw ? Number(raw) : defaultValue;
    return Number.isFinite(parsed) && parsed >= 60 ? parsed : defaultValue;
  }

  setNoDealReportIntervalSeconds(seconds: number): void {
    this.setValue("no_deal_report_interval_seconds", String(seconds));
  }

  getLastNoDealReportAt(presetId: string): string | undefined {
    return this.getValue(`last_no_deal_report_at:${presetId}`);
  }

  setLastNoDealReportAt(presetId: string, date: Date): void {
    this.setValue(`last_no_deal_report_at:${presetId}`, date.toISOString());
  }

  getBaselineRub(presetId: string, dealId: string): number | undefined {
    const row = this.db
      .prepare("select min(price_rub) as baseline from price_history where preset_id = ? and deal_id = ?")
      .get(presetId, dealId) as { baseline: number | null };
    return row.baseline ?? undefined;
  }

  savePrice(presetId: string, deal: TourDeal, priceRub: number): void {
    this.db
      .prepare(
        `insert into price_history(
          preset_id, deal_id, price_rub, price_amount, price_currency, seen_at
        ) values(?, ?, ?, ?, ?, ?)`
      )
      .run(presetId, deal.externalId, priceRub, deal.price.amount, deal.price.currency, new Date().toISOString());
  }

  wasAlertSent(presetId: string, dealId: string): boolean {
    const row = this.db
      .prepare("select 1 from sent_alerts where preset_id = ? and deal_id = ? limit 1")
      .get(presetId, dealId);
    return Boolean(row);
  }

  markAlertSent(presetId: string, deal: TourDeal, reasons: string[]): void {
    this.db
      .prepare(
        `insert or ignore into sent_alerts(
          preset_id, deal_id, title, url, reasons_json, sent_at
        ) values(?, ?, ?, ?, ?, ?)`
      )
      .run(presetId, deal.externalId, deal.title, deal.url, JSON.stringify(reasons), new Date().toISOString());
  }

  listRecentAlerts(limit = 10): Array<{ title: string; url: string; sent_at: string; reasons_json: string }> {
    return this.db
      .prepare("select title, url, sent_at, reasons_json from sent_alerts order by sent_at desc limit ?")
      .all(limit) as Array<{ title: string; url: string; sent_at: string; reasons_json: string }>;
  }

  close(): void {
    this.db.close();
  }

  private getValue(key: string): string | undefined {
    const row = this.db.prepare("select value from kv where key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setValue(key: string, value: string): void {
    this.db
      .prepare("insert into kv(key, value) values(?, ?) on conflict(key) do update set value = excluded.value")
      .run(key, value);
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists kv (
        key text primary key,
        value text not null
      );

      create table if not exists price_history (
        id integer primary key autoincrement,
        preset_id text not null,
        deal_id text not null,
        price_rub integer not null,
        price_amount real not null,
        price_currency text not null,
        seen_at text not null
      );

      create index if not exists idx_price_history_lookup
      on price_history(preset_id, deal_id, price_rub);

      create table if not exists sent_alerts (
        id integer primary key autoincrement,
        preset_id text not null,
        deal_id text not null,
        title text not null,
        url text not null,
        reasons_json text not null,
        sent_at text not null,
        unique(preset_id, deal_id)
      );
    `);
  }
}
