interface DirectoryItem {
  id: number;
  name: string;
  aliases: string[];
}

interface ResortItem extends DirectoryItem {
  countryId: number;
}

const departures: DirectoryItem[] = [
  { id: 57, name: "Minsk", aliases: ["minsk", "минск"] },
  { id: 1, name: "Moscow", aliases: ["moscow", "москва"] }
];

const countries: DirectoryItem[] = [
  { id: 16, name: "Vietnam", aliases: ["vietnam", "вьетнам", "viet nam"] },
  { id: 4, name: "Turkey", aliases: ["turkey", "турция"] },
  { id: 2, name: "Egypt", aliases: ["egypt", "египет"] },
  { id: 13, name: "Thailand", aliases: ["thailand", "тайланд", "таиланд"] },
  { id: 6, name: "UAE", aliases: ["uae", "оаэ", "emirates", "эмираты"] }
];

const resorts: ResortItem[] = [
  { id: 87, countryId: 16, name: "Nha Trang", aliases: ["nha trang", "nyachang", "нячанг", "ньячанг"] }
];

export function resolveDeparture(input: string): DirectoryItem | undefined {
  return resolveDirectoryItem(input, departures);
}

export function resolveCountry(input: string): DirectoryItem | undefined {
  return resolveDirectoryItem(input, countries);
}

export function resolveResorts(input: string, countryId?: number): ResortItem[] | undefined {
  const parts = splitInput(input);
  if (parts.length === 0) return undefined;

  const resolved: ResortItem[] = [];
  for (const part of parts) {
    const item = resolveDirectoryItem(part, resorts.filter((resort) => !countryId || resort.countryId === countryId));
    if (!item) return undefined;
    resolved.push(item);
  }

  return resolved;
}

export function isAllResortsInput(input: string): boolean {
  const value = normalize(input);
  return value === "all" || value === "any" || value === "все" || value === "любые" || value === "вся страна";
}

export function knownDirectionsHelp(): string {
  return [
    "Известные сейчас / Known now:",
    "Вылет: Минск, Москва",
    "Страны: Вьетнам, Турция, Египет, Таиланд, ОАЭ",
    "Курорты: Нячанг",
    "",
    "Если нужного нет, можно указать ID: Минск:57, Вьетнам:16, Нячанг:87"
  ].join("\n");
}

function resolveDirectoryItem<T extends DirectoryItem>(input: string, items: T[]): T | undefined {
  const explicit = parseExplicitId(input);
  if (explicit) {
    return {
      id: explicit.id,
      name: explicit.name,
      aliases: [explicit.name]
    } as T;
  }

  const value = normalize(input);
  return items.find((item) => item.aliases.some((alias) => normalize(alias) === value) || normalize(item.name) === value);
}

function parseExplicitId(input: string): { name: string; id: number } | undefined {
  const match = input.trim().match(/^(.+?)\s*[:#]\s*(\d+)$/);
  if (!match) return undefined;
  return { name: match[1].trim(), id: Number(match[2]) };
}

function splitInput(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}
