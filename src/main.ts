import { loadConfig } from "./config.js";
import { CurrencyConverter } from "./currency.js";
import { createProvider } from "./providers/index.js";
import { DealRules } from "./rules.js";
import { Storage } from "./storage.js";
import { TelegramNotifier } from "./telegram.js";
import { Worker } from "./worker.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const storage = new Storage(config.databasePath);
  storage.initializeSearchPresets(config.searchPresets);
  storage.setCheckIntervalSeconds(storage.getCheckIntervalSeconds(config.checkIntervalSeconds));
  storage.setMaxAlertsPerCheck(storage.getMaxAlertsPerCheck(10));
  storage.setNoDealReportsEnabled(storage.getNoDealReportsEnabled(true));
  storage.setNoDealReportIntervalSeconds(storage.getNoDealReportIntervalSeconds(3600));
  const currency = new CurrencyConverter(config.exchangeRates);
  const provider = createProvider(config);
  const rules = new DealRules(storage, currency);

  let worker: Worker;
  const notifier = new TelegramNotifier(
    config.telegramBotToken,
    config.telegramAdminChatId,
    storage,
    currency,
    async () => worker.checkOnce(),
    (paused) => worker.setPaused(paused),
    () => worker.status()
  );

  worker = new Worker(
    config.searchPresets,
    provider,
    storage,
    rules,
    notifier,
    config.checkIntervalSeconds
  );

  worker.start();
  console.log(`Tour deals bot started with ${config.searchPresets.length} presets`);
  await notifier.launch();

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down`);
    worker.stop();
    await notifier.stop(signal);
    storage.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
