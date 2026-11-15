/**
 * Waits for the Bangla fonts before anything is drawn, which prevents a flash of
 * broken glyphs and guarantees that the Canvas-painted signs use the right fonts.
 * A timeout keeps a slow network from blocking the game: text then uses the fallback.
 */

const REQUIRED: ReadonlyArray<readonly [string, string]> = [
  ['400 64px "Galada"', 'বেপরোয়া ক্ষ জ্ঞ'],
  ['500 20px "Hind Siliguri"', 'গাড়ি স্টার্ট দিন'],
  ['700 20px "Hind Siliguri"', 'গাড়ি স্টার্ট দিন'],
  ['800 32px "Anek Bangla"', '০১২৩৪৫৬৭৮৯ ক্ষ'],
  ['400 20px "Tiro Bangla"', 'প্রবাদ'],
];

export async function waitForFonts(timeoutMs = 7000): Promise<void> {
  if (!document.fonts) return;
  const loads = Promise.all(REQUIRED.map(([font, text]) => document.fonts.load(font, text)));
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs));
  try {
    await Promise.race([loads, timeout]);
  } catch {
    // A failed font is not fatal; the stack falls back to the next family.
  }
}
