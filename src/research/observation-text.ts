/**
 * READABLE OBSERVATION TEXT (presentation law).
 *
 * An evidence object stores exactly what the provider returned: that is the integrity
 * contract, and nothing here changes it. But the TRADER reads the observation, and a raw
 * transport payload on screen is not research output:
 *
 *   Established: - {"title":"Circle Launches Wrapped Bitcoin on Ethereum and Arc","publisher":
 *   "Yahoo Finance","publishedAt":"Fri, 02 Oct 2026 15:15:00 +0000","url":"https://...}
 *
 * That is what the accumulated-investigation surface and the evidence list used to show: the
 * model asked "what have we established" and got JSON back. This module renders the SAME
 * frozen bytes as prose, deterministically, with no model call and no invention: every number,
 * name and date below is read out of the payload, and anything unrecognised falls back to the
 * original text rather than being summarised away.
 */

/** Keys that are transport plumbing, never part of what the trader read. */
const NOISE_KEYS = new Set(["url", "link", "guid", "id", "description", "content", "summary", "image", "author"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A price with thousands separators and at most two decimals (crypto/equity/FX alike). */
function price(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** A compact magnitude for large money figures: 1713841563478 -> "1.71T". */
function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return price(value);
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** "Sat, 03 Oct 2026 16:00:00 +0000" -> "3 Oct 2026"; an ISO instant keeps its day. */
function day(value: string): string {
  const rfc = /^\w{3}, (\d{2}) (\w{3}) (\d{4})/.exec(value);
  if (rfc !== null) return `${Number(rfc[1])} ${rfc[2]} ${rfc[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return value;
}

function tail(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => p !== undefined && p.length > 0).join(", ");
}

/** A news item: the headline IS the observation, with its publisher and date. */
function newsText(o: Record<string, unknown>): string | undefined {
  const title = str(o["title"]);
  if (title === undefined) return undefined;
  const publisher = str(o["publisher"]) ?? str(o["source"]);
  const when = day(str(o["publishedAt"]) ?? str(o["pubDate"]) ?? str(o["asOf"]) ?? "");
  return tail(`"${title}"`, publisher, when === "" ? undefined : when);
}

/** A crypto/equity quote: the numbers a trader reads first. */
function quoteText(o: Record<string, unknown>): string | undefined {
  const priceValue = num(o["priceUsd"]) ?? num(o["price"]) ?? num(o["last"]) ?? num(o["close"]);
  if (priceValue === undefined) return undefined;
  const name = str(o["coin"]) ?? str(o["symbol"]) ?? str(o["instrument"]) ?? str(o["ticker"]);
  const unit = str(o["currency"]) ?? (num(o["priceUsd"]) !== undefined ? "USD" : undefined);
  const change = num(o["change24hPct"]) ?? num(o["changePct"]);
  const parts = [`${name ?? "price"} at ${price(priceValue)}${unit !== undefined ? ` ${unit}` : ""}`];
  if (change !== undefined) parts.push(`24h ${pct(change)}`);
  const cap = num(o["marketCapUsd"]) ?? num(o["marketCap"]);
  if (cap !== undefined) parts.push(`market cap ${compact(cap)}`);
  const volume = num(o["volume24hUsd"]) ?? num(o["volume24h"]) ?? num(o["volume"]);
  if (volume !== undefined) parts.push(`24h volume ${compact(volume)}`);
  const asOf = str(o["asOf"]) ?? str(o["observedAt"]);
  if (asOf !== undefined) parts.push(`as of ${asOf.slice(0, 16).replace("T", " ")} UTC`);
  const source = str(o["source"]);
  if (source !== undefined) parts.push(`source ${source}`);
  return parts.join(", ");
}

/**
 * A macro/market observable: a named measure with its value in the UNIT the measurement
 * declares. A yield is a percentage and an index level is points; neither is an amount of
 * money, and rendering either with a currency is a wrong reading of the observation.
 */
const UNIT_SUFFIX: Record<string, string> = {
  percent_per_year: "%",
  index_points: " index points",
  usd_per_troy_ounce: " USD per troy ounce",
  usd_per_barrel: " USD per barrel",
  percent: "%",
};

function metricText(o: Record<string, unknown>): string | undefined {
  const value = num(o["value"]);
  if (value === undefined) return undefined;
  const label = str(o["label"]) ?? str(o["instrument"]) ?? str(o["metric"]);
  const unit = str(o["unit"]);
  // A currency is only meaningful when the measurement says it is money; otherwise it is the
  // provider's quote convention leaking into the sentence.
  const suffix = unit !== undefined
    ? UNIT_SUFFIX[unit] ?? ""
    : (str(o["currency"]) !== undefined ? ` ${str(o["currency"])}` : "");
  const previous = num(o["previousClose"]);
  const change = num(o["changePct"]);
  return tail(
    `${label ?? "value"}: ${price(value)}${suffix}`,
    previous !== undefined ? `previous close ${price(previous)}${suffix}` : undefined,
    change !== undefined ? pct(change) : undefined,
    str(o["asOf"]) !== undefined ? `as of ${str(o["asOf"])!.slice(0, 10)}` : undefined,
  );
}

/** A month of daily candles: the range it covers and where it started and ended. */
function candleText(o: Record<string, unknown>): string | undefined {
  const month = str(o["month"]);
  const candles = o["candles"];
  if (month === undefined || !Array.isArray(candles) || candles.length === 0) return undefined;
  const first = isRecord(candles[0]) ? candles[0] : undefined;
  const last = isRecord(candles[candles.length - 1]) ? candles[candles.length - 1] : undefined;
  const count = num(o["candleCount"]) ?? candles.length;
  return tail(
    `${month}: ${count} daily candles`,
    first !== undefined && num(first["open"]) !== undefined && last !== undefined && num(last["close"]) !== undefined
      ? `open ${price(num(first["open"])!)} to close ${price(num(last["close"])!)}`
      : undefined,
  );
}

/** Anything else: its own key/value pairs, plumbing dropped, never a raw JSON blob. */
function pairsText(o: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(o)) {
    if (NOISE_KEYS.has(key)) continue;
    const text = str(value) ?? (num(value) !== undefined ? price(num(value)!) : undefined);
    if (text === undefined) continue;
    parts.push(`${key}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`);
    if (parts.length === 6) break;
  }
  return parts.join("; ");
}

function readableValue(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value.find((v) => v !== null && v !== undefined);
    const head = readableValue(first);
    return value.length === 1 ? head : `${value.length} records, first ${head}`;
  }
  if (isRecord(value)) return readableRecord(value);
  if (typeof value === "number") return price(value);
  return str(value) ?? "";
}

function readableRecord(o: Record<string, unknown>): string {
  return newsText(o) ?? quoteText(o) ?? metricText(o) ?? candleText(o) ?? pairsText(o);
}

/**
 * The trader-facing rendering of an evidence observation. Deterministic, allocation-free of
 * models, and lossless in the sense that it never asserts anything the payload does not say:
 * an unrecognised payload degrades to its own key/value pairs, and a non-JSON observation is
 * returned unchanged.
 */
export function readableObservation(observation: string, maxLength = 320): string {
  const collapsed = observation.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return observation;
  let parsed: unknown;
  try {
    parsed = JSON.parse(collapsed);
  } catch {
    return clip(collapsed, maxLength);
  }
  if (isRecord(parsed) || Array.isArray(parsed)) {
    const text = readableValue(parsed);
    return clip(text.length > 0 ? text : collapsed, maxLength);
  }
  return clip(collapsed, maxLength);
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}