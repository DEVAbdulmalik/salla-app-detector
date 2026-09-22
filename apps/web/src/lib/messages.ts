import ar from "../../messages/ar.json";

/**
 * Every visible string lives in a message file rather than in a component, so another
 * language is a new file and a lookup, not a rewrite of the interface.
 */
export const locales = ["ar"] as const;

export type Locale = (typeof locales)[number];
export type Messages = typeof ar;

const dictionaries: Record<Locale, Messages> = { ar };

export const defaultLocale: Locale = "ar";

export function getMessages(locale: Locale = defaultLocale): Messages {
  return dictionaries[locale];
}
