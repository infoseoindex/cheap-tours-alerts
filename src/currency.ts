import type { Currency, Money } from "./types.js";

export class CurrencyConverter {
  constructor(private readonly ratesToRub: Record<Currency, number>) {}

  toRub(money: Money): number {
    return Math.round(money.amount * this.ratesToRub[money.currency]);
  }

  format(money: Money): string {
    const formatted = new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0
    }).format(money.amount);

    return `${formatted} ${money.currency}`;
  }

  formatRub(amount: number): string {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount)} RUB`;
  }
}
