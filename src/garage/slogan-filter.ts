/**
 * Keeps rude words off the tail of a car. A short list is never complete, so the aim is the
 * common words in Bangla, Banglish and English, including simple attempts to disguise them.
 */

import { SLOGAN_MAX_LENGTH } from '../config/cars';

/** Rude anywhere inside a word. */
const INSIDE_A_WORD = ['চোদ', 'চুদ', 'চুত', 'খানকি', 'খানকী', 'মাগি', 'মাগী', 'হারামজাদ', 'হারামি', 'হারামী', 'বেশ্যা', 'রেন্ডি', 'বাঞ্চোদ', 'choda', 'chudi', 'chud', 'bokachoda', 'banchod', 'madarchod', 'magi', 'khanki', 'harami', 'rendi', 'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy'];

/** Rude only as a whole word, since each also sits inside something innocent. */
const WHOLE_WORD = ['বাল', 'গুদ', 'ধোন', 'শালা', 'শালী', 'কুত্তা', 'bal', 'gud', 'dhon', 'shala', 'kutta', 'ass'];

/** Letters people swap in to get past a filter. */
const LOOKALIKES: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function normalize(text: string): string {
  return (
    text
      .normalize('NFC')
      .toLowerCase()
      // Zero-width joiners and marks can hide a word without changing how it looks.
      .replace(/[​-‍﻿]/g, '')
      .replace(/[0-9@$!]/g, (match) => LOOKALIKES[match] ?? match)
  );
}

export type SloganProblem = 'none' | 'tooLong' | 'rude';

/** Length as people count it: a conjunct or a letter with its vowel sign is one. */
export function visibleLength(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('bn', { granularity: 'grapheme' });
    let count = 0;
    for (const _segment of segmenter.segment(text)) count++;
    return count;
  }
  return Array.from(text).length;
}

/** Checks a slogan, and says what is wrong with it. */
export function checkSlogan(raw: string): SloganProblem {
  const text = raw.trim();
  if (visibleLength(text) > SLOGAN_MAX_LENGTH) return 'tooLong';
  const normal = normalize(text);
  // With spaces and marks gone, "f u c k" is caught too.
  const squeezed = normal.replace(/[\s._\-*]+/g, '');
  for (const word of INSIDE_A_WORD) {
    if (normal.includes(word) || squeezed.includes(word)) return 'rude';
  }
  const words = normal.split(/[\s._\-*,।!?]+/);
  for (const word of WHOLE_WORD) {
    if (words.includes(word)) return 'rude';
  }
  return 'none';
}
