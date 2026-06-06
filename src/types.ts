export type Currency = "RUB" | "USD" | "EUR";

export type MealCode =
  | "RO"
  | "BB"
  | "HB"
  | "FB"
  | "AI"
  | "UAI"
  | "any";

export interface Money {
  amount: number;
  currency: Currency;
}

export interface SearchPreset {
  id: string;
  enabled: boolean;
  title: string;
  departureCity: string;
  departureId?: number;
  countries: string[];
  countryId?: number;
  resorts: string[];
  regionIds?: number[];
  dateFrom: string;
  dateTo: string;
  nightsFrom: number;
  nightsTo: number;
  adults: number;
  children: number;
  meal: MealCode;
  hotelNames?: string[];
  hotelStarsMin?: number;
  budget?: Money;
  discountPercent?: number;
}

export interface TourDeal {
  source: "tourvisor";
  externalId: string;
  title: string;
  country?: string;
  resort?: string;
  hotelName?: string;
  hotelStars?: number;
  departureCity?: string;
  dateStart?: string;
  nights?: number;
  adults?: number;
  children?: number;
  meal?: MealCode | string;
  price: Money;
  operator?: string;
  isAvailable?: boolean;
  availabilityText?: string;
  url: string;
  raw?: unknown;
}

export interface DealDecision {
  isGood: boolean;
  reasons: string[];
  priceRub: number;
  baselineRub?: number;
}

export interface TourProvider {
  search(preset: SearchPreset): Promise<TourDeal[]>;
  resolveDealLink?(deal: TourDeal): Promise<TourDeal>;
}
