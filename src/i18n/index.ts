/**
 * Key-based i18n. All visible text comes from bn.json and en.json.
 * Numbers use Intl with an explicit numbering system so the digit setting
 * (Bangla or Western) is independent of the language setting.
 */

import bn from './bn.json';
import en from './en.json';
import { toBongabdo } from './bongabdo';

export type Locale = 'bn' | 'en';
export type DigitMode = 'bn' | 'latn';
type Params = Record<string, string | number>;

const TABLES: Record<Locale, unknown> = { bn, en };
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

let locale: Locale = 'bn';
let digitMode: DigitMode = 'bn';
const listeners = new Set<() => void>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<Locale, Intl.PluralRules>();

function lookup(table: unknown, key: string): unknown {
  let node: unknown = table;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function intlLocale(): string {
  const base = locale === 'bn' ? 'bn-BD' : 'en-US';
  return `${base}-u-nu-${digitMode === 'bn' ? 'beng' : 'latn'}`;
}

export function getLocale(): Locale {
  return locale;
}

export function getDigitMode(): DigitMode {
  return digitMode;
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  numberFormats.clear();
  notify();
}

export function setDigitMode(next: DigitMode): void {
  if (next === digitMode) return;
  digitMode = next;
  numberFormats.clear();
  notify();
}

function notify(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.title = t('app.documentTitle');
    applyI18n(document.body);
  }
  for (const listener of listeners) listener();
}

/** Runs the callback whenever language or digit mode changes. */
export function onI18nChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Formats a number with the active digits, for example ১২,৩৪,৫৬৭. */
export function formatNumber(value: number, decimals = 0): string {
  const cacheKey = String(decimals);
  let format = numberFormats.get(cacheKey);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(cacheKey, format);
  }
  return format.format(value);
}

/** Converts ASCII digits inside a string to the active digit mode. */
export function localizeDigits(text: string): string {
  if (digitMode === 'latn') return text;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    result += code >= 48 && code <= 57 ? BN_DIGITS[code - 48] : text[i];
  }
  return result;
}

/** Plain integer without grouping, for the speedometer. Avoids Intl on hot paths. */
export function formatInteger(value: number): string {
  return localizeDigits(String(Math.round(value)));
}

/** mm:ss.cc with the active digits. */
export function formatLapTime(ms: number): string {
  const totalCentis = Math.floor(ms / 10);
  const minutes = Math.floor(totalCentis / 6000);
  const seconds = Math.floor(totalCentis / 100) % 60;
  const centis = totalCentis % 100;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return localizeDigits(`${pad(minutes)}:${pad(seconds)}.${pad(centis)}`);
}

/** Ordinal for ranks and laps: ১ম, ২য়, ৩য়, ৪র্থ, ৫ম, ৬ষ্ঠ ... or 1st, 2nd, 3rd ... */
export function formatOrdinal(value: number): string {
  if (locale === 'bn') {
    const special: Record<number, string> = {
      1: 'ম',
      2: 'য়',
      3: 'য়',
      4: 'র্থ',
      5: 'ম',
      6: 'ষ্ঠ',
      7: 'ম',
      8: 'ম',
      9: 'ম',
      10: 'ম',
    };
    return localizeDigits(String(value)) + (special[value] ?? 'তম');
  }
  const tens = value % 100;
  let suffix = 'th';
  if (tens < 11 || tens > 13) {
    if (value % 10 === 1) suffix = 'st';
    else if (value % 10 === 2) suffix = 'nd';
    else if (value % 10 === 3) suffix = 'rd';
  }
  return localizeDigits(String(value)) + suffix;
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? formatNumber(value) : value;
  });
}

function selectPlural(entry: Record<string, string>, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale === 'bn' ? 'bn-BD' : 'en-US');
    pluralRules.set(locale, rules);
  }
  return entry[rules.select(count)] ?? entry.other ?? '';
}

/** Translates a key. A plural entry is chosen with params.count. */
export function t(key: string, params?: Params): string {
  const value = lookup(TABLES[locale], key);
  if (typeof value === 'string') return interpolate(value, params);
  if (value && typeof value === 'object' && !Array.isArray(value) && params && typeof params.count === 'number') {
    return interpolate(selectPlural(value as Record<string, string>, params.count), params);
  }
  if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
  return key;
}

/** Reads a list such as loading tips or month names. */
export function tList(key: string): string[] {
  const value = lookup(TABLES[locale], key);
  return Array.isArray(value) ? (value as string[]) : [];
}

/**
 * World text stays in Bangla in every language setting: painted signs, plates
 * and slogans belong to the city. The English values in en.json document their meaning.
 */
export function worldText(key: string): string {
  const value = lookup(TABLES.bn, key);
  return typeof value === 'string' ? value : key;
}

/** Today's date in the Bengali calendar, for example ২০ কার্তিক ১৪৩৩ বঙ্গাব্দ. */
export function formatBongabdoDate(date: Date): string {
  const bongabdo = toBongabdo(date);
  return t('calendar.format', {
    day: localizeDigits(String(bongabdo.day)),
    month: tList('calendar.months')[bongabdo.monthIndex],
    year: localizeDigits(String(bongabdo.year)),
  });
}

/** Fills every element under root that has a data-i18n attribute. */
export function applyI18n(root: Element): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n as string);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nLabel as string));
  });
}

/** Sets up language and digits from saved settings and applies them to the page. */
export function initI18n(nextLocale: Locale, nextDigits: DigitMode): void {
  locale = nextLocale;
  digitMode = nextDigits;
  numberFormats.clear();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.title = t('app.documentTitle');
  }
}
