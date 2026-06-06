import { CurrencyConverter } from "./currency.js";
import { Storage } from "./storage.js";
import type { DealDecision, SearchPreset, TourDeal } from "./types.js";

export class DealRules {
  constructor(
    private readonly storage: Storage,
    private readonly currency: CurrencyConverter
  ) {}

  evaluate(preset: SearchPreset, deal: TourDeal): DealDecision {
    const reasons: string[] = [];
    const priceRub = this.currency.toRub(deal.price);

    if (preset.budget) {
      const budgetRub = this.currency.toRub(preset.budget);
      if (priceRub <= budgetRub) {
        reasons.push(`under budget: ${this.currency.format(deal.price)} <= ${this.currency.format(preset.budget)}`);
      }
    }

    const baselineRub = this.storage.getBaselineRub(preset.id, deal.externalId);
    if (preset.discountPercent && baselineRub && baselineRub > 0) {
      const discount = Math.round((1 - priceRub / baselineRub) * 100);
      if (discount >= preset.discountPercent) {
        reasons.push(`price drop: ${discount}% below baseline ${this.currency.formatRub(baselineRub)}`);
      }
    }

    return {
      isGood: reasons.length > 0,
      reasons,
      priceRub,
      baselineRub
    };
  }
}
