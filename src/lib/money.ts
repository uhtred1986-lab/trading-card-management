/** Money is always integer minor units + a currency code. */

export type Currency = "USD" | "EUR";

const FORMATTERS: Record<Currency, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
  EUR: new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }),
};

export function formatCents(cents: number | null | undefined, currency: Currency = "EUR"): string {
  if (cents == null) return "—";
  return FORMATTERS[currency].format(cents / 100);
}

export function usdToEurCents(usdCents: number, rate: number): number {
  return Math.round(usdCents * rate);
}

/** "+12.5 %" / "−3.0 %" for movers. */
export function formatPct(fraction: number | null): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  const sign = fraction > 0 ? "+" : fraction < 0 ? "−" : "";
  return `${sign}${Math.abs(fraction * 100).toFixed(1)} %`;
}

export function parseEuroInput(raw: string): number | null {
  const s = raw.trim().replace(/€/g, "").replace(/\s/g, "");
  if (!s) return null;
  // Comma is the decimal separator when present ("1,50", "1.234,56"); otherwise dots are ("1.50").
  const normalised = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalised);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
