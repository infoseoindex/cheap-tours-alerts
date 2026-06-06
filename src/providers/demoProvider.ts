import type { SearchPreset, TourDeal, TourProvider } from "../types.js";

export class DemoProvider implements TourProvider {
  async search(preset: SearchPreset): Promise<TourDeal[]> {
    return [
      {
        source: "tourvisor",
        externalId: `${preset.id}:demo:1`,
        title: `${preset.title} demo tour`,
        country: preset.countries[0],
        resort: preset.resorts[0],
        hotelName: "Demo Resort",
        hotelStars: preset.hotelStarsMin ?? 5,
        departureCity: preset.departureCity,
        dateStart: preset.dateFrom,
        nights: preset.nightsFrom,
        adults: preset.adults,
        children: preset.children,
        meal: preset.meal,
        price: preset.budget
          ? { amount: Math.round(preset.budget.amount * 0.95), currency: preset.budget.currency }
          : { amount: 100000, currency: "RUB" },
        operator: "Demo Operator",
        url: "https://tourvisor.ru/search.php"
      }
    ];
  }
}
