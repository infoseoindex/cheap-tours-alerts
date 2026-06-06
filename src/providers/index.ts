import type { AppConfig } from "../config.js";
import type { TourProvider } from "../types.js";
import { DemoProvider } from "./demoProvider.js";
import { TourvisorApiProvider } from "./tourvisorApiProvider.js";
import { TourvisorBrowserProvider } from "./tourvisorBrowserProvider.js";
import { TourvisorPublicProvider } from "./tourvisorPublicProvider.js";

export function createProvider(config: AppConfig): TourProvider {
  if (config.provider === "demo") {
    return new DemoProvider();
  }

  if (config.provider === "tourvisor-browser") {
    if (!config.tourvisorSearchUrlTemplate) {
      throw new Error("TOURVISOR_SEARCH_URL_TEMPLATE is required for tourvisor-browser provider");
    }
    return new TourvisorBrowserProvider({ searchUrlTemplate: config.tourvisorSearchUrlTemplate });
  }

  if (config.provider === "tourvisor-public") {
    if (!config.tourvisorModsearchUrl || !config.tourvisorModresultUrl) {
      throw new Error("TOURVISOR_MODSEARCH_URL and TOURVISOR_MODRESULT_URL are required");
    }
    return new TourvisorPublicProvider({
      modsearchUrl: config.tourvisorModsearchUrl,
      modresultUrl: config.tourvisorModresultUrl
    });
  }

  if (!config.tourvisorApiBaseUrl) {
    throw new Error("TOURVISOR_API_BASE_URL is required for tourvisor-api provider");
  }

  return new TourvisorApiProvider({
    baseUrl: config.tourvisorApiBaseUrl,
    apiKey: config.tourvisorApiKey
  });
}
