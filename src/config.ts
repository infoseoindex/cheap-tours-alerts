import "dotenv/config";
import { z } from "zod";
import type { Currency, SearchPreset } from "./types.js";

const moneySchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(["RUB", "USD", "EUR"])
});

const presetSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  title: z.string().min(1),
  departureCity: z.string().min(1),
  departureId: z.number().int().positive().optional(),
  countries: z.array(z.string()).default([]),
  countryId: z.number().int().positive().optional(),
  resorts: z.array(z.string()).default([]),
  regionIds: z.array(z.number().int().positive()).default([]),
  dateFrom: z.string().min(8),
  dateTo: z.string().min(8),
  nightsFrom: z.number().int().positive(),
  nightsTo: z.number().int().positive(),
  adults: z.number().int().positive(),
  children: z.number().int().nonnegative(),
  meal: z.enum(["RO", "BB", "HB", "FB", "AI", "UAI", "any"]).default("any"),
  hotelNames: z.array(z.string()).optional(),
  hotelStarsMin: z.number().int().min(1).max(5).optional(),
  budget: moneySchema.optional(),
  discountPercent: z.number().min(1).max(99).optional()
});

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ADMIN_CHAT_ID: z.string().min(1),
  CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(3600).default(120),
  DATABASE_PATH: z.string().default("./data/tour-deals.sqlite"),
  PROVIDER: z.enum(["tourvisor-public", "tourvisor-api", "tourvisor-browser", "demo"]).default("tourvisor-public"),
  TOURVISOR_MODSEARCH_URL: z.string().url().optional(),
  TOURVISOR_MODRESULT_URL: z.string().url().optional(),
  TOURVISOR_API_BASE_URL: z.string().url().optional(),
  TOURVISOR_API_KEY: z.string().optional(),
  TOURVISOR_SEARCH_URL_TEMPLATE: z.string().url().optional(),
  USD_TO_RUB: z.coerce.number().positive().default(90),
  EUR_TO_RUB: z.coerce.number().positive().default(98),
  SEARCH_PRESETS_JSON: z.string().min(2)
});

export interface AppConfig {
  telegramBotToken: string;
  telegramAdminChatId: string;
  checkIntervalSeconds: number;
  databasePath: string;
  provider: "tourvisor-public" | "tourvisor-api" | "tourvisor-browser" | "demo";
  tourvisorModsearchUrl?: string;
  tourvisorModresultUrl?: string;
  tourvisorApiBaseUrl?: string;
  tourvisorApiKey?: string;
  tourvisorSearchUrlTemplate?: string;
  exchangeRates: Record<Currency, number>;
  searchPresets: SearchPreset[];
}

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  const parsedPresets = z.array(presetSchema).parse(JSON.parse(env.SEARCH_PRESETS_JSON));

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramAdminChatId: env.TELEGRAM_ADMIN_CHAT_ID,
    checkIntervalSeconds: env.CHECK_INTERVAL_SECONDS,
    databasePath: env.DATABASE_PATH,
    provider: env.PROVIDER,
    tourvisorModsearchUrl: env.TOURVISOR_MODSEARCH_URL,
    tourvisorModresultUrl: env.TOURVISOR_MODRESULT_URL,
    tourvisorApiBaseUrl: env.TOURVISOR_API_BASE_URL,
    tourvisorApiKey: env.TOURVISOR_API_KEY,
    tourvisorSearchUrlTemplate: env.TOURVISOR_SEARCH_URL_TEMPLATE,
    exchangeRates: {
      RUB: 1,
      USD: env.USD_TO_RUB,
      EUR: env.EUR_TO_RUB
    },
    searchPresets: parsedPresets
  };
}
