import type { SearchPreset } from "./types.js";

export class PresetValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`Invalid search settings:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

export function validatePreset(preset: SearchPreset): string[] {
  const errors: string[] = [];

  if (!preset.departureCity?.trim()) errors.push("Укажите город вылета / Set departure city.");
  if (!positiveInt(preset.departureId)) errors.push("Укажите корректный ID города вылета / Set valid departure city ID.");
  if (!preset.countries?.length || !preset.countries[0]?.trim()) errors.push("Укажите страну / Set country.");
  if (!positiveInt(preset.countryId)) errors.push("Укажите корректный ID страны / Set valid country ID.");

  if (preset.regionIds?.some((id) => !positiveInt(id))) {
    errors.push("ID курортов должны быть положительными числами / Resort IDs must be positive numbers.");
  }

  const from = parseIsoDate(preset.dateFrom);
  const to = parseIsoDate(preset.dateTo);
  if (!from) errors.push("Дата начала должна быть в формате YYYY-MM-DD / Start date must be YYYY-MM-DD.");
  if (!to) errors.push("Дата окончания должна быть в формате YYYY-MM-DD / End date must be YYYY-MM-DD.");
  if (from && to && from.getTime() > to.getTime()) errors.push("Дата начала не может быть позже даты окончания / Start date cannot be after end date.");

  if (!positiveInt(preset.nightsFrom) || !positiveInt(preset.nightsTo)) {
    errors.push("Ночи должны быть положительными числами / Nights must be positive numbers.");
  } else if (preset.nightsFrom > preset.nightsTo) {
    errors.push("Минимум ночей не может быть больше максимума / Min nights cannot be greater than max nights.");
  }

  if (!positiveInt(preset.adults)) errors.push("Взрослых должен быть минимум 1 / Adults must be at least 1.");
  if (!nonNegativeInt(preset.children)) errors.push("Дети должны быть числом 0 или больше / Children must be 0 or more.");

  if (preset.budget && (!Number.isFinite(preset.budget.amount) || preset.budget.amount <= 0)) {
    errors.push("Бюджет должен быть положительным числом / Budget must be positive.");
  }

  if (preset.hotelStarsMin !== undefined && (!positiveInt(preset.hotelStarsMin) || preset.hotelStarsMin > 5)) {
    errors.push("Звезды должны быть от 1 до 5 / Stars must be from 1 to 5.");
  }

  if (preset.hotelNames?.some((name) => isMenuLike(name))) {
    errors.push("В фильтр отелей попала кнопка меню. Введите название отеля или all / Menu button was entered as hotel filter. Enter hotel name or all.");
  }

  return errors;
}

export function assertValidPreset(preset: SearchPreset): void {
  const errors = validatePreset(preset);
  if (errors.length > 0) throw new PresetValidationError(errors);
}

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function positiveInt(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInt(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isMenuLike(value: string): boolean {
  return /check|проверить|settings|настройки|status|статус|pause|пауза|resume|старт/i.test(value);
}
