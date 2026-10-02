/**
 * The collection's fixed vocabularies, in a module of their own so the client
 * components that offer them as choices (`BulkEntry`, `QuickCapture`,
 * `ScanFlow`) do not pull `./queries` — drizzle, the whole schema and the price
 * reads — into the browser bundle to get three arrays.
 */
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export const FINISHES = ["normal", "foil"] as const;
export const LANGUAGES = ["EN", "JP", "DE", "FR", "IT", "ES", "PT", "KR", "ZH"] as const;
