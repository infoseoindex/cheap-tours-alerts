import { chromium } from "playwright";
import type { SearchPreset, TourDeal, TourProvider } from "../types.js";

interface BrowserProviderOptions {
  searchUrlTemplate: string;
}

export class TourvisorBrowserProvider implements TourProvider {
  constructor(private readonly options: BrowserProviderOptions) {}

  async search(preset: SearchPreset): Promise<TourDeal[]> {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage({
        userAgent: "Mozilla/5.0 tour-deals-bot/0.1"
      });

      const url = new URL(this.options.searchUrlTemplate);
      url.searchParams.set("departure", preset.departureCity);
      url.searchParams.set("country", preset.countries.join(","));
      url.searchParams.set("datefrom", preset.dateFrom);
      url.searchParams.set("dateto", preset.dateTo);

      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });

      // This fallback is intentionally conservative. After capturing the real Tourvisor
      // result DOM or XHR response, replace it with exact selectors/response parsing.
      const deals = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll("[data-tour-id], .tour, .result, .hotel"));
        return cards.slice(0, 20).map((card, index) => {
          const text = card.textContent?.replace(/\s+/g, " ").trim() ?? "";
          const priceMatch = text.match(/(\d[\d\s]{3,})\s*(₽|руб|RUB)/i);
          return {
            externalId: card.getAttribute("data-tour-id") ?? `browser-${index}`,
            title: text.slice(0, 120) || `Tour ${index + 1}`,
            price: priceMatch ? Number(priceMatch[1].replace(/\s+/g, "")) : undefined,
            url: location.href
          };
        });
      });

      return deals
        .filter((deal) => deal.price)
        .map<TourDeal>((deal) => ({
          source: "tourvisor",
          externalId: deal.externalId,
          title: deal.title,
          country: preset.countries[0],
          resort: preset.resorts[0],
          departureCity: preset.departureCity,
          dateStart: preset.dateFrom,
          nights: preset.nightsFrom,
          adults: preset.adults,
          children: preset.children,
          meal: preset.meal,
          price: { amount: deal.price ?? 0, currency: "RUB" },
          url: deal.url
        }));
    } finally {
      await browser.close();
    }
  }
}
