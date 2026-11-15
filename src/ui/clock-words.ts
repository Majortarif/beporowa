/** The hour and the weather, in words a person would use. */

import type { WeatherKind } from '../config/atmosphere';
import { localizeDigits, t } from '../i18n';

/** A share of the day, as something like রাত ৮:৩০. */
export function clockWords(time: number): string {
  const minutes = Math.floor(time * 24 * 60);
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = Math.floor((minutes % 60) / 5) * 5;
  const part = hour24 < 4 ? 'night' : hour24 < 6 ? 'dawn' : hour24 < 12 ? 'morning' : hour24 < 15 ? 'noon' : hour24 < 18 ? 'afternoon' : hour24 < 20 ? 'evening' : 'night';
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return t('clock.format', { part: t(`clock.part.${part}`), hour: localizeDigits(String(hour)), minute: localizeDigits(String(minute).padStart(2, '0')) });
}

export function weatherWord(weather: WeatherKind, blackout: boolean): string {
  return t(blackout ? 'weather.blackout' : `weather.${weather}`);
}
