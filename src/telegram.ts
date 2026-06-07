import { Markup, Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { CurrencyConverter } from "./currency.js";
import { validatePreset } from "./presetValidation.js";
import { Storage, type BestDealObservation } from "./storage.js";
import { isAllResortsInput, knownDirectionsHelp, resolveCountry, resolveDeparture, resolveResorts } from "./tourvisorDirectory.js";
import type { Currency, MealCode, SearchPreset, TourDeal } from "./types.js";

type PendingField =
  | "departure"
  | "country"
  | "resorts"
  | "budget"
  | "dates"
  | "nights"
  | "people"
  | "hotels"
  | "interval"
  | "maxAlerts"
  | "reportInterval";

export class TelegramNotifier {
  readonly bot: Telegraf;
  private pendingField?: PendingField;

  constructor(
    token: string,
    private readonly adminChatId: string,
    private readonly storage: Storage,
    private readonly currency: CurrencyConverter,
    private readonly onManualCheck: () => Promise<void>,
    private readonly setPaused: (paused: boolean) => void,
    private readonly getStatus: () => string
  ) {
    this.bot = new Telegraf(token);
    this.registerCommands();
  }

  async launch(): Promise<void> {
    await this.bot.telegram.setMyCommands([
      { command: "menu", description: "Главное меню / Main menu" },
      { command: "settings", description: "Настройки / Settings" },
      { command: "status", description: "Статус / Status" },
      { command: "check", description: "Проверить сейчас / Check now" },
      { command: "best", description: "Лучшие за 24 часа / Best 24h" },
      { command: "besthour", description: "Лучшие за час / Best hour" },
      { command: "pause", description: "Пауза / Pause" },
      { command: "resume", description: "Старт / Resume" },
      { command: "stop", description: "Unsubscribe" }
    ]);
    await this.bot.launch();
  }

  async stop(reason: string): Promise<void> {
    this.bot.stop(reason);
  }

  async sendDeal(preset: SearchPreset, deal: TourDeal, reasons: string[]): Promise<void> {
    const room = rawString(deal.raw, "room");
    const tourId = rawString(deal.raw, "id");
    const hotelId = rawString(deal.raw, "hotelId");
    const bookingLink = bookingLinkFromRaw(deal.raw);
    const lines = [
      `🔥 Deal: ${escapeHtml(preset.title)}`,
      "",
      `<b>${escapeHtml(deal.title)}</b>`,
      deal.hotelName ? `🏨 Hotel: ${escapeHtml(deal.hotelName)}${deal.hotelStars ? ` ${deal.hotelStars}*` : ""}` : undefined,
      deal.country || deal.resort ? `📍 Place: ${escapeHtml([deal.country, deal.resort].filter(Boolean).join(", "))}` : undefined,
      deal.dateStart || deal.nights
        ? `📅 Dates: ${escapeHtml([deal.dateStart, deal.nights ? `${deal.nights} nights` : ""].filter(Boolean).join(", "))}`
        : undefined,
      room ? `🛏 Room: ${escapeHtml(room)}` : undefined,
      deal.meal ? `🍽 Meal: ${escapeHtml(String(deal.meal))}` : undefined,
      deal.operator ? `✈️ Operator: ${escapeHtml(deal.operator)}` : undefined,
      deal.availabilityText ? `🟢 Status: ${escapeHtml(deal.availabilityText)}` : undefined,
      tourId || hotelId ? `IDs: ${escapeHtml([tourId ? `tour ${tourId}` : "", hotelId ? `hotel ${hotelId}` : ""].filter(Boolean).join(", "))}` : undefined,
      `💰 Price: <b>${escapeHtml(this.currency.format(deal.price))}</b>`,
      "",
      ...reasons.map((reason) => `✅ ${escapeHtml(reason)}`)
    ].filter(Boolean);

    const tourUrl = tourUrlWithCurrency(deal.url, deal.price.currency);
    const buttons = [[Markup.button.url("🔎 Открыть тур / Open tour", tourUrl)]];
    if (bookingLink) buttons.push([Markup.button.url("🧾 Оформить / Book", bookingLink)]);

    await this.sendToDealSubscribers(lines.join("\n"), Markup.inlineKeyboard(buttons));
  }

  async sendNoDealReport(
    preset: SearchPreset,
    result: { checkedDeals: number; minDeal?: TourDeal }
  ): Promise<void> {
    const lines = [
      `🟡 Отчет по поиску / Search report`,
      "",
      `<b>${escapeHtml(preset.title)}</b>`,
      `🎯 Бюджет / Budget: ${preset.budget ? escapeHtml(this.currency.format(preset.budget)) : "not set"}`,
      `📅 Даты / Dates: ${escapeHtml(`${preset.dateFrom} - ${preset.dateTo}`)}`,
      `🌙 Ночи / Nights: ${preset.nightsFrom}-${preset.nightsTo}`,
      "",
      "Подходящих туров сейчас нет.",
      "No matching deals right now.",
      "",
      result.minDeal
        ? `Текущий минимум / Current minimum: <b>${escapeHtml(this.currency.format(result.minDeal.price))}</b>`
        : "Текущий минимум / Current minimum: не найден",
      result.minDeal?.hotelName ? `🏨 ${escapeHtml(result.minDeal.hotelName)}${result.minDeal.hotelStars ? ` ${result.minDeal.hotelStars}*` : ""}` : undefined,
      result.minDeal?.dateStart || result.minDeal?.nights
        ? `📅 ${escapeHtml([result.minDeal.dateStart, result.minDeal.nights ? `${result.minDeal.nights} nights` : ""].filter(Boolean).join(", "))}`
        : undefined,
      `Проверено вариантов / Checked variants: ${result.checkedDeals}`,
      `Следующий отчет не чаще чем раз в ${Math.round(this.storage.getNoDealReportIntervalSeconds(3600) / 60)} мин.`
    ].filter(Boolean);

    const extra = result.minDeal
      ? Markup.inlineKeyboard([Markup.button.url("🔎 Открыть минимум / Open minimum", result.minDeal.url)])
      : mainKeyboard();

    await this.bot.telegram.sendMessage(this.adminChatId, lines.join("\n"), {
      parse_mode: "HTML",
      ...extra
    });
  }

  async sendBestDealsDigest(deals: BestDealObservation[], title: string): Promise<void> {
    await this.sendToDealSubscribers(this.formatBestDeals(title, deals), bestDealsKeyboard(deals));
  }

  private registerCommands(): void {
    this.bot.start(async (ctx) => {
      await this.subscribeCurrentChat(ctx);
      if (!this.isAdmin(ctx)) {
        await ctx.reply("Alerts enabled. You will receive cheap tour alerts. Search settings are admin-only. Use /stop to unsubscribe.");
        return;
      }
      await ctx.reply("🧭 Cheap Tours Alerts готов / ready", replyKeyboard());
      await ctx.reply("Выберите действие / Choose an action", mainKeyboard());
    });

    this.bot.command("stop", async (ctx) => {
      const chatId = String(ctx.chat?.id ?? "");
      if (chatId) this.storage.deactivateSubscriber(chatId);
      await ctx.reply("Alerts disabled. Use /start to subscribe again.");
    });

    this.bot.command("menu", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await ctx.reply("🧭 Главное меню / Main menu", replyKeyboard());
      await ctx.reply("Выберите действие / Choose an action", mainKeyboard());
    });

    this.bot.command("status", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await ctx.reply(this.getStatus(), mainKeyboard());
    });

    this.bot.command("settings", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await this.sendSettings(ctx);
    });

    this.bot.command("preset", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await this.sendSettings(ctx);
    });

    this.bot.command("check", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await this.runManualCheck(ctx);
    });

    this.bot.command("best", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await this.sendBestDeals(ctx, 24);
    });

    this.bot.command("besthour", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await this.sendBestDeals(ctx, 1);
    });

    this.bot.command("pause", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      this.setPaused(true);
      await ctx.reply("⏸ Проверки остановлены / Checks paused.", mainKeyboard());
    });

    this.bot.command("resume", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      this.setPaused(false);
      await ctx.reply("▶️ Проверки включены / Checks resumed.", mainKeyboard());
    });

    this.bot.command("last", async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await this.sendLastAlerts(ctx);
    });

    this.bot.action(/^menu:(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      const action = ctx.match[1];
      await ctx.answerCbQuery();

      if (action === "settings" || action === "preset") return this.sendSettings(ctx);
      if (action === "check") return this.runManualCheck(ctx);
      if (action === "best") return this.sendBestDeals(ctx, 24);
      if (action === "besthour") return this.sendBestDeals(ctx, 1);
      if (action === "status") return ctx.reply(this.getStatus(), mainKeyboard());
      if (action === "pause") {
        this.setPaused(true);
        return ctx.reply("⏸ Проверки остановлены / Checks paused.", mainKeyboard());
      }
      if (action === "resume") {
        this.setPaused(false);
        return ctx.reply("▶️ Проверки включены / Checks resumed.", mainKeyboard());
      }

      return undefined;
    });

    this.bot.action(/^set:(.+)$/, async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      await ctx.answerCbQuery();
      await this.handleSetAction(ctx, ctx.match[1]);
    });

    this.bot.on("text", async (ctx) => {
      if (!this.isAdmin(ctx)) return;

      if (!this.pendingField) {
        await this.handleMenuText(ctx, ctx.message.text.trim());
        return;
      }

      if (isMenuText(ctx.message.text.trim())) {
        this.pendingField = undefined;
        await this.handleMenuText(ctx, ctx.message.text.trim());
        return;
      }

      const field = this.pendingField;
      this.pendingField = undefined;
      await this.applyTextSetting(ctx, field, ctx.message.text.trim());
    });
  }

  private async runManualCheck(ctx: Context): Promise<void> {
    await ctx.reply("🔎 Ручная проверка запущена / Manual check started.");
    try {
      await this.onManualCheck();
      await ctx.reply("✅ Ручная проверка завершена / Manual check finished.", mainKeyboard());
    } catch (error) {
      console.error("Manual check failed", error);
      await ctx.reply(`❌ Ошибка проверки / Manual check failed: ${error instanceof Error ? error.message : "unknown error"}`, mainKeyboard());
    }
  }

  private async sendSettings(ctx: Context): Promise<void> {
    await ctx.reply(this.formatPreset(), settingsKeyboard());
  }

  private async sendLastAlerts(ctx: Context): Promise<void> {
    const alerts = this.storage.listRecentAlerts(10);
    if (alerts.length === 0) {
      await ctx.reply("Истории уведомлений пока нет / No alerts yet.", mainKeyboard());
      return;
    }

    await ctx.reply(
      alerts
        .map((alert) => {
          const reasons = JSON.parse(alert.reasons_json) as string[];
          return `${alert.sent_at}\n${alert.title}\n${reasons.join("; ")}\n${alert.url}`;
        })
        .join("\n\n"),
      mainKeyboard()
    );
  }

  private async sendBestDeals(ctx: Context, hours: number): Promise<void> {
    const deals = this.storage.listBestDealObservationsSince(new Date(Date.now() - hours * 3600_000).toISOString(), 5);
    if (deals.length === 0) {
      await ctx.reply(`No best deals recorded in the last ${hours === 1 ? "hour" : `${hours} hours`} yet.`, mainKeyboard());
      return;
    }

    const title = hours === 1 ? "Лучшие туры за час / Best tours in the last hour" : "Лучшие туры за 24 часа / Best tours in the last 24 hours";
    await ctx.reply(this.formatBestDeals(title, deals), {
      parse_mode: "HTML",
      ...bestDealsKeyboard(deals)
    });
  }

  private async handleSetAction(ctx: Context, action: string): Promise<void> {
    if (action === "departure") return this.ask(ctx, "departure", `Введите город вылета / Enter departure city.\nНапример: Минск\n\n${knownDirectionsHelp()}`);
    if (action === "country") return this.ask(ctx, "country", `Введите страну / Enter country.\nНапример: Вьетнам\n\n${knownDirectionsHelp()}`);
    if (action === "resorts") return this.ask(ctx, "resorts", `Введите курорт(ы) через запятую / Enter resort(s) separated by comma.\nНапример: Нячанг\nЧтобы искать всю страну: all или все\n\n${knownDirectionsHelp()}`);
    if (action === "budget") return this.ask(ctx, "budget", "Введите бюджет / Enter budget, например: 3000");
    if (action === "dates") return this.ask(ctx, "dates", "Введите даты / Enter dates: 07.06.2026-25.06.2026");
    if (action === "nights") return this.ask(ctx, "nights", "Введите ночи / Enter nights: 12-14");
    if (action === "people") return this.ask(ctx, "people", "Введите взрослых/детей / Enter adults/children.\nНапример: 2/0 или 2,1");
    if (action === "hotels") return this.ask(ctx, "hotels", "Введите отели через запятую / Enter hotels separated by comma.\nНапример: Amiana, Regalia Gold\nЧтобы очистить: all или все");
    if (action === "interval") return this.ask(ctx, "interval", "Интервал проверки в минутах / Check interval in minutes: 5");
    if (action === "maxAlerts") return this.ask(ctx, "maxAlerts", "Сколько туров слать за проверку / Alerts per check: 10. 0 = без лимита / unlimited.");
    if (action === "reportInterval") return this.ask(ctx, "reportInterval", "Как часто слать отчет без находок, в минутах / No-deal report interval in minutes: 60");

    if (action === "reports:on") {
      this.storage.setNoDealReportsEnabled(true);
      await ctx.reply(`✅ Отчеты без находок включены.\n\n${this.formatPreset()}`, settingsKeyboard());
      return;
    }

    if (action === "reports:off") {
      this.storage.setNoDealReportsEnabled(false);
      await ctx.reply(`⛔️ Отчеты без находок выключены.\n\n${this.formatPreset()}`, settingsKeyboard());
      return;
    }

    if (action.startsWith("currency:")) {
      return this.updatePreset(ctx, (preset) => {
        const currency = action.split(":")[1] as Currency;
        preset.budget = { amount: preset.budget?.amount ?? 3000, currency };
      });
    }

    if (action.startsWith("meal:")) {
      return this.updatePreset(ctx, (preset) => {
        preset.meal = action.split(":")[1] as MealCode;
      });
    }

    if (action.startsWith("stars:")) {
      return this.updatePreset(ctx, (preset) => {
        const value = action.split(":")[1];
        if (value === "any") {
          delete preset.hotelStarsMin;
        } else {
          preset.hotelStarsMin = Number(value);
        }
      });
    }

    return undefined;
  }

  private async ask(ctx: Context, field: PendingField, message: string): Promise<void> {
    this.pendingField = field;
    await ctx.reply(message);
  }

  private async applyTextSetting(ctx: Context, field: PendingField, text: string): Promise<void> {
    try {
      if (field === "departure") {
        const departure = resolveDeparture(text);
        if (!departure) throw new Error(`Не знаю такой город вылета. Можно ввести с ID, например Минск:57.\n\n${knownDirectionsHelp()}`);
        await this.updatePreset(ctx, (preset) => {
          preset.departureCity = departure.name;
          preset.departureId = departure.id;
        });
        return;
      }

      if (field === "country") {
        const country = resolveCountry(text);
        if (!country) throw new Error(`Не знаю такую страну. Можно ввести с ID, например Вьетнам:16.\n\n${knownDirectionsHelp()}`);
        await this.updatePreset(ctx, (preset) => {
          preset.countries = [country.name];
          preset.countryId = country.id;
          preset.resorts = [];
          preset.regionIds = [];
        });
        return;
      }

      if (field === "resorts") {
        if (isAllResortsInput(text)) {
          await this.updatePreset(ctx, (preset) => {
            preset.resorts = [];
            preset.regionIds = [];
          });
          return;
        }

        const presets = this.storage.getSearchPresets();
        const countryId = presets[0]?.countryId;
        const resorts = resolveResorts(text, countryId);
        if (!resorts) throw new Error(`Не знаю такой курорт. Можно ввести с ID, например Нячанг:87, или all для всей страны.\n\n${knownDirectionsHelp()}`);
        await this.updatePreset(ctx, (preset) => {
          preset.resorts = resorts.map((item) => item.name);
          preset.regionIds = resorts.map((item) => item.id);
        });
        return;
      }

      if (field === "budget") {
        const amount = Number(text.replace(",", "."));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Бюджет должен быть положительным числом / Budget must be positive.");
        await this.updatePreset(ctx, (preset) => {
          preset.budget = { amount, currency: preset.budget?.currency ?? "USD" };
        });
        return;
      }

      if (field === "dates") {
        const [from, to] = text.split("-").map((item) => normalizeDate(item.trim()));
        if (!from || !to) throw new Error("Формат / Format: 07.06.2026-25.06.2026.");
        await this.updatePreset(ctx, (preset) => {
          preset.dateFrom = from;
          preset.dateTo = to;
        });
        return;
      }

      if (field === "nights") {
        const [fromRaw, toRaw] = text.split("-").map((item) => Number(item.trim()));
        if (!Number.isInteger(fromRaw) || !Number.isInteger(toRaw) || fromRaw <= 0 || toRaw < fromRaw) {
          throw new Error("Формат / Format: 12-14.");
        }
        await this.updatePreset(ctx, (preset) => {
          preset.nightsFrom = fromRaw;
          preset.nightsTo = toRaw;
        });
        return;
      }

      if (field === "people") {
        const people = parsePeople(text);
        if (!people) throw new Error("Формат / Format: 2/0 или 2,1. Взрослых минимум 1, детей 0 или больше.");
        await this.updatePreset(ctx, (preset) => {
          preset.adults = people.adults;
          preset.children = people.children;
        });
        return;
      }

      if (field === "hotels") {
        const normalized = text.trim().toLowerCase();
        if (normalized === "all" || normalized === "any" || normalized === "все" || normalized === "любые") {
          await this.updatePreset(ctx, (preset) => {
            delete preset.hotelNames;
          });
          return;
        }

        const hotelNames = text
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        if (hotelNames.length === 0) throw new Error("Введите хотя бы один отель или all / Enter at least one hotel or all.");
        await this.updatePreset(ctx, (preset) => {
          preset.hotelNames = hotelNames;
        });
        return;
      }

      if (field === "interval") {
        const minutes = Number(text.replace(",", "."));
        if (!Number.isFinite(minutes) || minutes < 1) throw new Error("Минимальный интервал 1 минута / Minimum interval is 1 minute.");
        this.storage.setCheckIntervalSeconds(Math.round(minutes * 60));
        await ctx.reply(`⏱ Интервал обновлен / Interval updated: ${Math.round(minutes * 60)}s`, mainKeyboard());
        return;
      }

      if (field === "maxAlerts") {
        const value = Number(text);
        if (!Number.isInteger(value) || value < 0) throw new Error("Введите целое число / Use a whole number: 0, 5, 10, 20.");
        this.storage.setMaxAlertsPerCheck(value);
        await ctx.reply(`🔔 Лимит обновлен / Limit updated: ${value || "unlimited"}`, mainKeyboard());
        return;
      }

      if (field === "reportInterval") {
        const minutes = Number(text.replace(",", "."));
        if (!Number.isFinite(minutes) || minutes < 1) throw new Error("Минимум 1 минута / Minimum is 1 minute.");
        this.storage.setNoDealReportIntervalSeconds(Math.round(minutes * 60));
        await ctx.reply(`🟡 Частота отчетов обновлена / Report interval updated: ${Math.round(minutes * 60)}s`, settingsKeyboard());
        return;
      }
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Invalid value.", settingsKeyboard());
    }
  }

  private async updatePreset(ctx: Context, update: (preset: SearchPreset) => void): Promise<void> {
    const presets = this.storage.getSearchPresets();
    const preset = presets[0];
    if (!preset) {
      await ctx.reply("Поиск не настроен / No preset configured.");
      return;
    }

    update(preset);
    const errors = validatePreset(preset);
    if (errors.length > 0) {
      await ctx.reply(`⚠️ Не сохранил настройку: есть ошибка.\n\n${errors.join("\n")}`, settingsKeyboard());
      return;
    }

    this.storage.saveSearchPresets(presets);
    await ctx.reply(`✅ Обновлено / Updated\n\n${this.formatPreset()}`, settingsKeyboard());
  }

  private formatPreset(): string {
    const preset = this.storage.getSearchPresets()[0];
    if (!preset) return "Поиск не настроен / No preset configured.";

    return [
      "⚙️ Текущий поиск / Current search",
      "",
      `🛫 Вылет / Departure: ${preset.departureCity}${preset.departureId ? ` #${preset.departureId}` : ""}`,
      `🌍 Страна / Country: ${preset.countries.join(", ")}${preset.countryId ? ` #${preset.countryId}` : ""}`,
      `📍 Курорт / Resort: ${preset.resorts.length ? preset.resorts.join(", ") : "all / вся страна"}${preset.regionIds?.length ? ` #${preset.regionIds.join(",")}` : ""}`,
      `📅 Даты / Dates: ${preset.dateFrom} - ${preset.dateTo}`,
      `🌙 Ночи / Nights: ${preset.nightsFrom}-${preset.nightsTo}`,
      `👥 Туристы / People: ${preset.adults} adults, ${preset.children} children`,
      `🍽 Питание / Meal: ${preset.meal}`,
      `🏨 Отели / Hotels: ${preset.hotelNames?.length ? preset.hotelNames.join(", ") : "any / любые"}`,
      `⭐️ Звезды / Stars: ${preset.hotelStarsMin ? `from ${preset.hotelStarsMin}*` : "any / любые"}`,
      `💰 Бюджет / Budget: ${preset.budget ? this.currency.format(preset.budget) : "none / нет"}`,
      `📉 Скидка / Discount: ${preset.discountPercent ? `${preset.discountPercent}% below baseline` : "off / выкл"}`,
      `⏱ Интервал / Interval: ${this.storage.getCheckIntervalSeconds(300)}s`,
      `🔔 Туров за проверку / Alerts per check: ${this.storage.getMaxAlertsPerCheck(10) || "unlimited / без лимита"}`,
      `🟡 Отчеты без находок / No-deal reports: ${this.storage.getNoDealReportsEnabled(false) ? `on, every ${this.storage.getNoDealReportIntervalSeconds(3600)}s` : "off / выкл"}`,
      "▶️ Автоуведомления / Auto alerts: active unless paused"
    ].join("\n");
  }

  private async handleMenuText(ctx: Context, text: string): Promise<void> {
    if (text.includes("Текущий поиск") || text.includes("Current search") || text.includes("Настройки") || text.includes("Settings")) {
      await this.sendSettings(ctx);
      return;
    }
    if (text.includes("Проверить") || text.includes("Check")) {
      await this.runManualCheck(ctx);
      return;
    }
    if (text.includes("Лучшие за 24") || text.includes("Best 24")) {
      await this.sendBestDeals(ctx, 24);
      return;
    }
    if (text.includes("Лучшие за час") || text.includes("Best hour") || text.includes("Best tours")) {
      await this.sendBestDeals(ctx, 1);
      return;
    }
    if (text.includes("Статус") || text.includes("Status")) {
      await ctx.reply(this.getStatus(), mainKeyboard());
      return;
    }
    if (text.includes("Пауза") || text.includes("Pause")) {
      this.setPaused(true);
      await ctx.reply("⏸ Проверки остановлены / Checks paused.", mainKeyboard());
      return;
    }
    if (text.includes("Старт") || text.includes("Resume")) {
      this.setPaused(false);
      await ctx.reply("▶️ Проверки включены / Checks resumed.", mainKeyboard());
    }
  }

  private isAdmin(ctx: Context): boolean {
    return String(ctx.chat?.id ?? "") === this.adminChatId;
  }

  private async subscribeCurrentChat(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    this.storage.upsertSubscriber({
      chatId: String(ctx.chat.id),
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      languageCode: ctx.from?.language_code
    });
  }

  private dealSubscriberChatIds(): string[] {
    return Array.from(new Set([this.adminChatId, ...this.storage.listActiveSubscriberChatIds()]));
  }

  private formatBestDeals(title: string, deals: BestDealObservation[]): string {
    return [
      `🏆 <b>${escapeHtml(title)}</b>`,
      "",
      ...deals.map((deal, index) => formatBestDealLine(deal, index + 1))
    ].join("\n\n");
  }

  private async sendToDealSubscribers(
    text: string,
    keyboard: ReturnType<typeof Markup.inlineKeyboard>
  ): Promise<void> {
    for (const chatId of this.dealSubscriberChatIds()) {
      try {
        await this.bot.telegram.sendMessage(chatId, text, {
          parse_mode: "HTML",
          ...keyboard
        });
        console.log(`Sent deal message to chat ${chatId}`);
      } catch (error) {
        console.error(`Failed to send deal alert to chat ${chatId}`, error);
        if (telegramErrorCode(error) === 403) {
          this.storage.deactivateSubscriber(chatId);
        }
      }
    }
  }
}

function telegramErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as { response?: { error_code?: number } }).response;
  return response?.error_code;
}

function formatBestDealLine(deal: BestDealObservation, rank: number): string {
  const price = `${Math.round(deal.priceAmount).toLocaleString("en-US")} ${deal.priceCurrency}`;
  const title = deal.hotelName || deal.title;
  const tourUrl = tourUrlWithCurrency(deal.url, deal.priceCurrency);
  const details = [
    deal.dateStart,
    deal.nights ? `${deal.nights} nights` : undefined,
    deal.meal,
    deal.operator
  ].filter(Boolean);
  const reasons = deal.reasons.length ? `\n✅ ${escapeHtml(deal.reasons.join("; "))}` : "";

  return [
    `<b>#${rank}. ${escapeHtml(price)}</b>`,
    `<a href="${escapeHtml(tourUrl)}">${escapeHtml(title)}</a>`,
    details.length ? escapeHtml(details.join(", ")) : undefined,
    `<a href="${escapeHtml(tourUrl)}">Open tour</a>`,
    reasons
  ]
    .filter(Boolean)
    .join("\n");
}

function bestDealsKeyboard(deals: BestDealObservation[]): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard(
    deals.map((deal, index) => [Markup.button.url(`#${index + 1} Open tour`, tourUrlWithCurrency(deal.url, deal.priceCurrency))])
  );
}

function tourUrlWithCurrency(urlValue: string, currency: Currency | string): string {
  try {
    const url = new URL(urlValue);
    url.searchParams.set("currency", currencyParam(currency));
    return url.toString();
  } catch {
    return urlValue;
  }
}

function currencyParam(currency: Currency | string): string {
  const normalized = currency.toUpperCase();
  if (normalized === "USD") return "5";
  if (normalized === "EUR") return "6";
  return "0";
}

function mainKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🧭 Текущий поиск", "menu:preset")],
    [Markup.button.callback("🔎 Проверить", "menu:check")],
    [Markup.button.callback("🏆 Лучшие за 24 часа", "menu:best")],
    [Markup.button.callback("⏱ Лучшие за час", "menu:besthour")],
    [Markup.button.callback("📊 Статус", "menu:status")],
    [Markup.button.callback("⏸ Пауза", "menu:pause"), Markup.button.callback("▶️ Старт", "menu:resume")]
  ]);
}

function replyKeyboard(): ReturnType<typeof Markup.keyboard> {
  return Markup.keyboard([
    ["🧭 Текущий поиск"],
    ["🔎 Проверить"],
    ["🏆 Лучшие за 24 часа"],
    ["⏱ Лучшие за час"],
    ["📊 Статус", "⏸ Пауза", "▶️ Старт"]
  ]).resize();
}

function isMenuText(text: string): boolean {
  return (
    text.includes("Настройки") ||
    text.includes("Settings") ||
    text.includes("Текущий поиск") ||
    text.includes("Current search") ||
    text.includes("Проверить") ||
    text.includes("Check") ||
    text.includes("Лучшие за 24") ||
    text.includes("Best 24") ||
    text.includes("Лучшие за час") ||
    text.includes("Best hour") ||
    text.includes("Best tours") ||
    text.includes("Статус") ||
    text.includes("Status") ||
    text.includes("Пауза") ||
    text.includes("Pause") ||
    text.includes("Старт") ||
    text.includes("Resume")
  );
}

function settingsKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛫 Вылет", "set:departure"), Markup.button.callback("🌍 Страна", "set:country")],
    [Markup.button.callback("📍 Курорт / вся страна", "set:resorts")],
    [Markup.button.callback("💰 Бюджет", "set:budget"), Markup.button.callback("📅 Даты", "set:dates")],
    [Markup.button.callback("🌙 Ночи", "set:nights"), Markup.button.callback("👥 Туристы", "set:people")],
    [Markup.button.callback("🏨 Отели", "set:hotels")],
    [Markup.button.callback("⏱ Интервал", "set:interval")],
    [Markup.button.callback("🔔 Лимит туров", "set:maxAlerts")],
    [
      Markup.button.callback("USD", "set:currency:USD"),
      Markup.button.callback("EUR", "set:currency:EUR"),
      Markup.button.callback("RUB", "set:currency:RUB")
    ],
    [
      Markup.button.callback("🍽 Любое", "set:meal:any"),
      Markup.button.callback("BB", "set:meal:BB"),
      Markup.button.callback("AI", "set:meal:AI")
    ],
    [
      Markup.button.callback("⭐️ Любые", "set:stars:any"),
      Markup.button.callback("3+", "set:stars:3"),
      Markup.button.callback("4+", "set:stars:4"),
      Markup.button.callback("5", "set:stars:5")
    ],
    [Markup.button.callback("🏆 Лучшие за 24 часа", "menu:best")],
    [Markup.button.callback("⏱ Лучшие за час", "menu:besthour")],
    [Markup.button.callback("🔎 Проверить сейчас", "menu:check")]
  ]);
}

function rawString(raw: unknown, key: string): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bookingLinkFromRaw(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;

  const share = record.share;
  const shareOperatorLink = rawString(share, "operatorlink");
  if (shareOperatorLink) return shareOperatorLink;

  const client = record.client;
  if (!client || typeof client !== "object" || Array.isArray(client)) return undefined;

  const clientOperatorLink = rawString(client, "operatorlink");
  if (clientOperatorLink) return clientOperatorLink;

  const bookcenters = (client as Record<string, unknown>).bookcenters;
  if (!Array.isArray(bookcenters)) return undefined;

  for (const item of bookcenters) {
    const link = rawString(item, "link");
    if (link) return link;
  }

  return undefined;
}

function normalizeDate(value: string): string | undefined {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;

  const ru = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!ru) return undefined;
  return `${ru[3]}-${ru[2]}-${ru[1]}`;
}

function parsePeople(text: string): { adults: number; children: number } | undefined {
  const values = text.match(/\d+/g)?.map((value) => Number(value)) ?? [];
  if (values.length < 1 || values.length > 2) return undefined;
  const [adults, children = 0] = values;
  if (!Number.isInteger(adults) || !Number.isInteger(children) || adults < 1 || children < 0) return undefined;
  return { adults, children };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
