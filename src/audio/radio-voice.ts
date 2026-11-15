/**
 * Optional spoken radio lines through the browser's own voices. Most machines have no Bangla voice,
 * so this stays silent then, and the painted radio plate always shows the words anyway.
 */

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function findVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined && cachedVoice !== null) return cachedVoice;
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  cachedVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith('bn')) ?? null;
  return cachedVoice;
}

/** Whether this browser can speak Bangla at all. The list can load late, so ask again later. */
export function hasBanglaVoice(): boolean {
  return findVoice() !== null;
}

/** Says a line over the radio, cutting off whatever came before. Does nothing without a voice. */
export function speakRadioLine(line: string): void {
  const voice = findVoice();
  if (!voice) return;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 1.12;
    utterance.pitch = 0.92;
    utterance.volume = 0.8;
    speechSynthesis.speak(utterance);
  } catch {
    // Speech is only ever a bonus, so a failure here is not worth reporting.
  }
}

export function stopRadioVoice(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
