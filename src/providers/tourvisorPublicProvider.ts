import type { Currency, SearchPreset, TourDeal, TourProvider } from "../types.js";

interface PublicProviderOptions {
  modsearchUrl: string;
  modresultUrl: string;
}

interface ModsearchResponse {
  data?: {
    requestid?: number | string;
    status?: {
      requestid?: number | string;
    };
  };
  result?: {
    requestid?: number | string;
  };
}

export class TourvisorPublicProvider implements TourProvider {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly options: PublicProviderOptions) {}

  async search(preset: SearchPreset): Promise<TourDeal[]> {
    const requestId = await this.startSearch(preset);
    const payload = await this.pollResults(requestId);
    return normalizePublicPayload(payload, preset, requestId);
  }

  async resolveDealLink(deal: TourDeal): Promise<TourDeal> {
    const tourId = rawString(deal.raw, "id") ?? deal.externalId.replace(/^tourvisor:/, "");
    if (!tourId || !/^\d+$/.test(tourId)) return deal;

    const url = new URL("https://tourvisor.ru/xml/modact.php");
    url.searchParams.set("currency", mapCurrency(deal.price.currency));
    url.searchParams.set("tourid", tourId);

    const response = await this.fetchWithSession(url, {
        accept: "application/json,text/plain,*/*",
        referer: "https://tourvisor.ru/search.php",
        "user-agent": "tour-deals-bot/0.1"
    });

    if (!response.ok) return deal;

    const payload = await response.json();
    const errorText = errorTextFrom(payload);
    if (errorText) {
      return {
        ...deal,
        isAvailable: false,
        availabilityText: errorText
      };
    }

    const data = recordFrom(recordFrom(payload)?.data);
    const tour = recordFrom(data?.tour);
    if (!tour) return deal;
    const client = recordFrom(data?.client);
    const availability = availabilityFromModact(data, tour, client);

    const share = recordFrom(tour.share);
    const searchLink = stringFrom(share?.searchlink);
    const shortId = stringFrom(tour.shortid);
    const hotelName = stringFrom(tour.hotelname) ?? deal.hotelName;
    const tourName = stringFrom(tour.tourname);
    const room = stringFrom(tour.room) ?? rawString(deal.raw, "room");

    return {
      ...deal,
      title: hotelName ? `${hotelName}${tourName ? ` / ${tourName}` : ""}` : deal.title,
      hotelName,
      hotelStars: numberFrom(tour.hotelstars) ?? deal.hotelStars,
      country: stringFrom(tour.countryname) ?? deal.country,
      resort: stringFrom(tour.hotelregionname) ?? deal.resort,
      dateStart: normalizeDetailDate(stringFrom(tour.flydate)) ?? deal.dateStart,
      nights: numberFrom(tour.nights) ?? deal.nights,
      meal: stringFrom(tour.meal) ?? deal.meal,
      operator: stringFrom(tour.operatorname) ?? deal.operator,
      isAvailable: availability.isAvailable,
      availabilityText: availability.text,
      price: {
        amount: numberFrom(tour.price) ?? deal.price.amount,
        currency: currencyFrom(tour.currency) ?? deal.price.currency
      },
      url: buildTourUrl(searchLink, shortId, tourId, deal.url),
      raw: {
        ...(recordFrom(deal.raw) ?? {}),
        id: tourId,
        shortid: shortId,
        room,
        share,
        client
      }
    };
  }

  private async startSearch(preset: SearchPreset): Promise<string> {
    if (!preset.departureId || !preset.countryId) {
      throw new Error(`Preset ${preset.id} needs departureId and countryId for Tourvisor public flow`);
    }

    const url = new URL(this.options.modsearchUrl);
    url.searchParams.set("datefrom", formatTourvisorDate(preset.dateFrom));
    url.searchParams.set("dateto", formatTourvisorDate(preset.dateTo));
    url.searchParams.set("directflight", "0");
    url.searchParams.set("regular", "1");
    url.searchParams.set("nightsfrom", String(preset.nightsFrom));
    url.searchParams.set("nightsto", String(preset.nightsTo));
    url.searchParams.set("adults", String(preset.adults));
    url.searchParams.set("child", String(preset.children));
    url.searchParams.set("meal", mapMeal(preset.meal));
    url.searchParams.set("rating", String(preset.hotelStarsMin ?? 0));
    url.searchParams.set("country", String(preset.countryId));
    url.searchParams.set("regions", preset.regionIds?.join(",") ?? "");
    url.searchParams.set("departure", String(preset.departureId));
    url.searchParams.set("pricefrom", "0");
    url.searchParams.set("priceto", preset.budget ? String(Math.round(preset.budget.amount)) : "0");
    url.searchParams.set("currency", mapCurrency(preset.budget?.currency ?? "RUB"));
    url.searchParams.set("formmode", "0");
    url.searchParams.set("pricetype", "0");
    url.searchParams.set("referrer", "https://tourvisor.ru/search.php");

    const response = await this.fetchWithSession(url, {
        accept: "application/json,text/plain,*/*",
        "user-agent": "tour-deals-bot/0.1"
    });

    if (!response.ok) {
      throw new Error(`Tourvisor modsearch failed with ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as ModsearchResponse;
    const requestId = payload.data?.requestid ?? payload.data?.status?.requestid ?? payload.result?.requestid;
    if (!requestId) {
      throw new Error(`Tourvisor modsearch did not return requestid: ${JSON.stringify(payload).slice(0, 500)}`);
    }

    return String(requestId);
  }

  private async pollResults(requestId: string): Promise<unknown> {
    let latest: unknown;
    let richPayload: unknown;

    await sleep(4500);
    latest = await this.fetchResult(requestId, false);
    if (hasBlocks(latest)) {
      richPayload = latest;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      latest = await this.fetchResult(requestId, true);
      if (hasBlocks(latest)) {
        richPayload = latest;
      }

      const status = statusFrom(latest);
      if (status?.finished === 1 || status?.progress === 100) {
        if (hasBlocks(latest)) return latest;

        for (let retry = 0; retry < 3; retry += 1) {
          const full = await this.fetchResult(requestId, false).catch(() => undefined);
          if (hasBlocks(full)) return full;
          await sleep(1500);
        }

        return richPayload ?? latest;
      }

      await sleep(1500);
    }

    return richPayload ?? latest ?? {};
  }

  private async fetchResult(requestId: string, statusOnly: boolean): Promise<unknown> {
    const url = new URL(this.options.modresultUrl);
    url.searchParams.set("requestid", requestId);
    if (statusOnly) {
      url.searchParams.set("lastblock", "5");
    }
    url.searchParams.set("referrer", "https://tourvisor.ru/search.php");

    const response = await this.fetchWithSession(url, {
        accept: "application/json,text/plain,*/*",
        "user-agent": "tour-deals-bot/0.1"
    });

    if (!response.ok) {
      throw new Error(`Tourvisor modresult failed with ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  private async fetchWithSession(url: URL, headers: Record<string, string>, retry = true): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        ...headers,
        cookie: this.cookieHeader()
      }
    });
    this.rememberCookies(response);

    if (response.status === 401 && retry) {
      await this.refreshSession();
      return this.fetchWithSession(url, headers, false);
    }

    return response;
  }

  private async refreshSession(): Promise<void> {
    const response = await fetch("https://tourvisor.ru/search.php", {
      headers: {
        accept: "text/html,*/*",
        "user-agent": "tour-deals-bot/0.1"
      }
    });
    this.rememberCookies(response);
  }

  private rememberCookies(response: Response): void {
    const raw = response.headers.get("set-cookie");
    if (!raw) return;

    for (const chunk of raw.split(/,(?=\s*[^;,=\s]+=[^;,]+)/)) {
      const [pair] = chunk.split(";");
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (name && value) this.cookies.set(name, value);
    }
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function normalizePublicPayload(payload: unknown, preset: SearchPreset, requestId: string): TourDeal[] {
  const blockDeals = normalizeBlocks(payload, preset, requestId);
  if (blockDeals.length > 0) {
    return blockDeals;
  }

  const arrays = collectArrays(payload);
  const best = arrays.find((items) => items.some(looksLikeTour)) ?? [];

  const tourDeals = best.map(normalizeDeal).filter((deal): deal is TourDeal => Boolean(deal));
  if (tourDeals.length > 0) {
    return tourDeals;
  }

  return normalizeOperatorMinPrices(payload, preset, requestId);
}

function normalizeBlocks(payload: unknown, preset: SearchPreset, requestId: string): TourDeal[] {
  const data = recordFrom(payload && typeof payload === "object" ? (payload as Record<string, unknown>).data : undefined);
  if (!data) return [];
  const blocks = data?.block;
  if (!Array.isArray(blocks)) return [];

  const lookup = buildLookup(data);
  const deals: TourDeal[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const blockRecord = block as Record<string, unknown>;
    const operatorId = stringFrom(blockRecord.operator);
    const operatorName = operatorId ? lookup.operators.get(operatorId) : undefined;
    const hotels = blockRecord.hotel;
    if (!Array.isArray(hotels)) continue;

    for (const hotel of hotels) {
      if (!hotel || typeof hotel !== "object") continue;
      const hotelRecord = hotel as Record<string, unknown>;
      const hotelId = stringFrom(hotelRecord.id) ?? "unknown-hotel";
      const hotelInfo = lookup.hotels.get(hotelId);
      const tours = hotelRecord.tour;
      if (!Array.isArray(tours)) continue;

      for (const tour of tours) {
        if (!tour || typeof tour !== "object") continue;
        const tourRecord = tour as Record<string, unknown>;
        const price = numberFrom(tourRecord.pr ?? tourRecord.prclean ?? hotelRecord.price);
        if (!price || price <= 0) continue;

        const tourId = stringFrom(tourRecord.id) ?? `${requestId}:${hotelId}:${deals.length}`;
        const dateStart = stringFrom(tourRecord.dt);
        const nights = numberFrom(tourRecord.nt);
        const mealId = stringFrom(tourRecord.ml);
        const meal = (mealId ? lookup.meals.get(mealId) : undefined) ?? mealFromTourvisorCode(numberFrom(tourRecord.ml));
        const roomId = stringFrom(tourRecord.rm);
        const roomName = roomId ? lookup.rooms.get(roomId) : undefined;
        const tourNameId = stringFrom(tourRecord.nm);
        const tourName = tourNameId ? lookup.tourNames.get(tourNameId) : undefined;
        const cityToId = stringFrom(tourRecord.ct);
        const cityTo = cityToId ? lookup.citiesTo.get(cityToId) : undefined;
        const title = [hotelInfo?.name ?? `Hotel #${hotelId}`, tourName].filter(Boolean).join(" / ");

        deals.push({
          source: "tourvisor",
          externalId: `tourvisor:${tourId}`,
          title: `${preset.title}: ${title}`,
          country: hotelInfo?.country ?? preset.countries[0],
          resort: hotelInfo?.region ?? cityTo ?? preset.resorts[0],
          hotelName: hotelInfo?.name ?? `Hotel #${hotelId}`,
          hotelStars: hotelInfo?.stars,
          departureCity: preset.departureCity,
          dateStart,
          nights,
          adults: preset.adults,
          children: preset.children,
          meal,
          price: { amount: price, currency: preset.budget?.currency ?? "RUB" },
          operator: operatorName ?? (operatorId ? `Operator #${operatorId}` : undefined),
          url: buildSearchUrl(preset),
          raw: {
            ...tourRecord,
            hotelId,
            hotel: hotelInfo,
            room: roomName,
            tourName
          }
        });
      }
    }
  }

  return deals.sort((a, b) => a.price.amount - b.price.amount);
}

interface Lookup {
  hotels: Map<string, { name?: string; stars?: number; country?: string; region?: string; link?: string; pic?: string }>;
  rooms: Map<string, string>;
  meals: Map<string, string>;
  tourNames: Map<string, string>;
  citiesTo: Map<string, string>;
  operators: Map<string, string>;
}

function buildLookup(data: Record<string, unknown>): Lookup {
  const decode = recordFrom(data.decode);
  const hotelsRaw = recordFrom(data.hotels) ?? recordFrom(decode?.hotels);
  const roomsRaw = recordFrom(data.rooms) ?? recordFrom(decode?.rooms);
  const mealsRaw = recordFrom(data.meal) ?? recordFrom(decode?.meal);
  const tourNamesRaw = recordFrom(data.tourname) ?? recordFrom(decode?.tourname);
  const citiesToRaw = recordFrom(data.cityto) ?? recordFrom(decode?.cityto);
  const operatorsRaw = Array.isArray(data.operators) ? data.operators : [];

  const hotels = new Map<string, { name?: string; stars?: number; country?: string; region?: string; link?: string; pic?: string }>();
  for (const [id, value] of Object.entries(hotelsRaw ?? {})) {
    const row = recordFrom(value);
    if (!row) continue;
    hotels.set(id, {
      name: stringFrom(row.name),
      stars: numberFrom(row.stars),
      country: stringFrom(row.country),
      region: stringFrom(row.region),
      link: stringFrom(row.link),
      pic: stringFrom(row.pic)
    });
  }

  return {
    hotels,
    rooms: mapRecordNames(roomsRaw),
    meals: mapRecordNames(mealsRaw, "nameshort"),
    tourNames: mapRecordNames(tourNamesRaw),
    citiesTo: mapRecordNames(citiesToRaw),
    operators: mapArrayNames(operatorsRaw)
  };
}

function mapRecordNames(record: Record<string, unknown> | undefined, preferredKey = "name"): Map<string, string> {
  const result = new Map<string, string>();
  for (const [id, value] of Object.entries(record ?? {})) {
    const row = recordFrom(value);
    const name = row ? stringFrom(row[preferredKey]) ?? stringFrom(row.name) : undefined;
    if (name) result.set(id, name);
  }
  return result;
}

function mapArrayNames(items: unknown[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of items) {
    const row = recordFrom(value);
    const id = row ? stringFrom(row.id) : undefined;
    const name = row ? stringFrom(row.name) : undefined;
    if (id && name) result.set(id, name);
  }
  return result;
}

function collectArrays(value: unknown): unknown[][] {
  if (Array.isArray(value)) {
    return [value, ...value.flatMap(collectArrays)];
  }

  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectArrays);
}

function looksLikeTour(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return Boolean(row.hotel || row.hotelname || row.price || row.fullprice || row.cost);
}

function normalizeDeal(item: unknown, index: number): TourDeal | undefined {
  if (!item || typeof item !== "object") return undefined;
  const row = item as Record<string, unknown>;
  const price = numberFrom(row.price ?? row.fullprice ?? row.cost ?? row.minprice);
  if (!price) return undefined;

  const hotelName = stringFrom(row.hotel ?? row.hotelname ?? row.name);
  const title = stringFrom(row.title) ?? hotelName ?? `Tour ${index + 1}`;

  return {
    source: "tourvisor",
    externalId: stringFrom(row.id ?? row.tourid ?? row.offerid) ?? `${title}:${price}:${index}`,
    title,
    country: stringFrom(row.country ?? row.countryname),
    resort: stringFrom(row.region ?? row.resort ?? row.resortname),
    hotelName,
    hotelStars: numberFrom(row.stars ?? row.hotelstars),
    departureCity: stringFrom(row.departure ?? row.departurecity),
    dateStart: stringFrom(row.flydate ?? row.date ?? row.datefrom ?? row.checkin),
    nights: numberFrom(row.nights ?? row.night),
    meal: stringFrom(row.meal ?? row.mealtype ?? row.mealcode),
    price: { amount: price, currency: currencyFrom(row.currency) ?? "RUB" },
    operator: stringFrom(row.operator ?? row.operatorname),
    url: stringFrom(row.url ?? row.link) ?? "https://tourvisor.ru/search.php",
    raw: item
  };
}

function normalizeOperatorMinPrices(payload: unknown, preset: SearchPreset, requestId: string): TourDeal[] {
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>).data : undefined;
  const operators = data && typeof data === "object" ? (data as Record<string, unknown>).operators : undefined;
  if (!Array.isArray(operators)) return [];

  const deals: TourDeal[] = [];

  for (const item of operators) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const price = numberFrom(row.minprice);
    if (!price || price <= 0) continue;

    const operator = stringFrom(row.name) ?? "Tour operator";
    deals.push({
      source: "tourvisor",
      externalId: `operator-min:${requestId}:${stringFrom(row.id) ?? operator}`,
      title: `${preset.title}: min price from ${operator}`,
      country: preset.countries[0],
      resort: preset.resorts[0],
      departureCity: preset.departureCity,
      dateStart: preset.dateFrom,
      nights: preset.nightsFrom,
      adults: preset.adults,
      children: preset.children,
      meal: preset.meal,
      price: { amount: price, currency: preset.budget?.currency ?? "RUB" },
      operator,
      url: "https://tourvisor.ru/search.php",
      raw: item
    });
  }

  return deals;
}

function hasBlocks(payload: unknown): boolean {
  const data = recordFrom(payload && typeof payload === "object" ? (payload as Record<string, unknown>).data : undefined);
  return Array.isArray(data?.block) && data.block.length > 0;
}

function statusFrom(payload: unknown): { progress?: number; finished?: number } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return undefined;
  const status = (data as Record<string, unknown>).status;
  if (!status || typeof status !== "object") return undefined;
  const row = status as Record<string, unknown>;
  return {
    progress: numberFrom(row.progress),
    finished: numberFrom(row.finished)
  };
}

function availabilityFromModact(
  data: Record<string, unknown> | undefined,
  tour: Record<string, unknown> | undefined,
  client: Record<string, unknown> | undefined
): { isAvailable?: boolean; text?: string } {
  if (booleanish(data?.sold) || booleanish(tour?.sold) || booleanish(tour?.notour)) {
    return {
      isAvailable: false,
      text: "Тур продан"
    };
  }

  if (!client) return {};

  const showRequest = booleanish(client.showrequest);
  const showRequestOffice = booleanish(client.showrequestoffice);
  const cart = booleanish(client.cart);
  const operatorLink = booleanish(client.operator_link_enabled);
  const bookcenters = Array.isArray(client.bookcenters) ? client.bookcenters.length : 0;
  const available = Boolean(showRequest || showRequestOffice || cart || operatorLink || bookcenters > 0);

  return {
    isAvailable: available,
    text: available ? "Заявка на тур доступна" : "Тур продан или заявка недоступна"
  };
}

function booleanish(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
  return false;
}

function formatTourvisorDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function normalizeDetailDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function mapMeal(meal: SearchPreset["meal"]): string {
  const map: Record<SearchPreset["meal"], string> = {
    any: "0",
    RO: "1",
    BB: "2",
    HB: "3",
    FB: "4",
    AI: "5",
    UAI: "7"
  };
  return map[meal];
}

function mapCurrency(currency: Currency): string {
  return currency === "RUB" ? "0" : currency === "USD" ? "5" : "6";
}

function mealFromTourvisorCode(code: number | undefined): string | undefined {
  const map: Record<number, string> = {
    1: "RO",
    2: "BB",
    3: "HB",
    4: "FB",
    5: "AI",
    7: "UAI"
  };
  return code ? map[code] ?? `meal #${code}` : undefined;
}

function buildSearchUrl(preset: SearchPreset): string {
  const url = new URL("https://tourvisor.ru/search.php");
  url.searchParams.set("datefrom", formatTourvisorDate(preset.dateFrom));
  url.searchParams.set("dateto", formatTourvisorDate(preset.dateTo));
  url.searchParams.set("nightsfrom", String(preset.nightsFrom));
  url.searchParams.set("nightsto", String(preset.nightsTo));
  url.searchParams.set("adults", String(preset.adults));
  url.searchParams.set("child", String(preset.children));
  url.searchParams.set("country", String(preset.countryId ?? ""));
  url.searchParams.set("regions", preset.regionIds?.join(",") ?? "");
  url.searchParams.set("departure", String(preset.departureId ?? ""));
  if (preset.budget) {
    url.searchParams.set("priceto", String(Math.round(preset.budget.amount)));
    url.searchParams.set("currency", mapCurrency(preset.budget.currency));
  }
  return url.toString();
}

function buildTourUrl(searchLink: string | undefined, shortId: string | undefined, tourId: string, fallback: string): string {
  const rawUrl = searchLink ?? (shortId ? `https://tourvisor.ru/t/${shortId}` : fallback);

  try {
    const url = new URL(rawUrl, "https://tourvisor.ru");
    url.hash = `tvtourid=${tourId}`;
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function errorTextFrom(payload: unknown): string | undefined {
  const root = recordFrom(payload);
  const error = recordFrom(root?.error) ?? recordFrom(recordFrom(root?.data)?.error);
  return stringFrom(error?.errormessage) ?? stringFrom(error?.message);
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function rawString(raw: unknown, key: string): string | undefined {
  const record = recordFrom(raw);
  return record ? stringFrom(record[key]) : undefined;
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
  if (text === "RUB" || text === "RUR" || text === "0" || text === "₽") return "RUB";
  if (text === "USD" || text === "5" || text === "$") return "USD";
  if (text === "EUR" || text === "6" || text === "€") return "EUR";
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
