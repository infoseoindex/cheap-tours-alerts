import type { Currency, SearchPreset, TourDeal, TourProvider } from "../types.js";

interface ApiProviderOptions {
  baseUrl: string;
  apiKey?: string;
}

export class TourvisorApiProvider implements TourProvider {
  constructor(private readonly options: ApiProviderOptions) {}

  async search(preset: SearchPreset): Promise<TourDeal[]> {
    const url = new URL(this.options.baseUrl);
    if (this.options.apiKey) {
      url.searchParams.set("authkey", this.options.apiKey);
    }

    // Replace these names with exact Tourvisor API parameters from your account docs.
    url.searchParams.set("departure", preset.departureCity);
    url.searchParams.set("country", preset.countries.join(","));
    url.searchParams.set("resort", preset.resorts.join(","));
    url.searchParams.set("datefrom", preset.dateFrom);
    url.searchParams.set("dateto", preset.dateTo);
    url.searchParams.set("nightsfrom", String(preset.nightsFrom));
    url.searchParams.set("nightsto", String(preset.nightsTo));
    url.searchParams.set("adults", String(preset.adults));
    url.searchParams.set("children", String(preset.children));
    if (preset.meal !== "any") url.searchParams.set("meal", preset.meal);
    if (preset.hotelStarsMin) url.searchParams.set("stars", String(preset.hotelStarsMin));
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "tour-deals-bot/0.1 (+private monitoring)"
      }
    });

    if (!response.ok) {
      throw new Error(`Tourvisor API failed with ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    return normalizeTourvisorPayload(payload);
  }
}

function normalizeTourvisorPayload(payload: unknown): TourDeal[] {
  const candidates = extractArray(payload);
  return candidates.map((item, index) => normalizeDeal(item, index)).filter((deal): deal is TourDeal => Boolean(deal));
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const possible = [
    record.tours,
    record.tour,
    record.results,
    record.items,
    record.data,
    record?.result
  ];

  for (const value of possible) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractArray(value);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function normalizeDeal(item: unknown, index: number): TourDeal | undefined {
  if (!item || typeof item !== "object") return undefined;
  const row = item as Record<string, unknown>;

  const priceAmount = numberFrom(row.price ?? row.cost ?? row.fullprice ?? row.amount);
  if (!priceAmount) return undefined;

  const currency = currencyFrom(row.currency) ?? "RUB";
  const hotelName = stringFrom(row.hotel ?? row.hotelname ?? row.hotelName);
  const title = stringFrom(row.title ?? row.name) ?? hotelName ?? `Tour ${index + 1}`;
  const externalId = stringFrom(row.id ?? row.tourid ?? row.offerid ?? row.key) ?? stableId(title, priceAmount, index);

  return {
    source: "tourvisor",
    externalId,
    title,
    country: stringFrom(row.country ?? row.countryname),
    resort: stringFrom(row.resort ?? row.resortname),
    hotelName,
    hotelStars: numberFrom(row.stars ?? row.hotelstars),
    departureCity: stringFrom(row.departure ?? row.departurecity),
    dateStart: stringFrom(row.date ?? row.datestart ?? row.checkin),
    nights: numberFrom(row.nights ?? row.night),
    adults: numberFrom(row.adults),
    children: numberFrom(row.children),
    meal: stringFrom(row.meal ?? row.mealtype),
    price: { amount: priceAmount, currency },
    operator: stringFrom(row.operator ?? row.operatorname),
    url: stringFrom(row.url ?? row.link ?? row.tourlink) ?? "https://tourvisor.ru/search.php",
    raw: item
  };
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s+/g, "").replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function currencyFrom(value: unknown): Currency | undefined {
  const text = stringFrom(value)?.toUpperCase();
  if (text === "RUB" || text === "RUR" || text === "₽") return "RUB";
  if (text === "USD" || text === "$") return "USD";
  if (text === "EUR" || text === "€") return "EUR";
  return undefined;
}

function stableId(title: string, price: number, index: number): string {
  return `${title.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-")}:${price}:${index}`;
}
