/**
 * Recorded Bangla voice, if anyone has dropped some in. Add a file to public/voice and a line to
 * public/voice/manifest.json, and that line plays instead of the browser's own voice:
 *   { "lines": { "radio.lines.rainStart.0": { "file": "tuntuni-rain-1.ogg", "seconds": 3.2 } } }
 * The key is the language-file key, followed by the line's place in its list. See the README.
 */

interface VoiceEntry {
  file: string;
  seconds?: number;
}

export class VoiceLines {
  private table: Record<string, VoiceEntry> = {};
  private readonly decoded = new Map<string, AudioBuffer>();

  /** Reads the list of recordings. A missing list only means that there are none. */
  async load(): Promise<void> {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}voice/manifest.json`);
      if (!response.ok) return;
      const data = (await response.json()) as { lines?: Record<string, VoiceEntry> };
      this.table = data.lines ?? {};
    } catch {
      this.table = {};
    }
  }

  has(key: string): boolean {
    return this.table[key] !== undefined;
  }

  /** How long the recording runs, if the list says. */
  seconds(key: string): number | null {
    return this.table[key]?.seconds ?? null;
  }

  /** Plays a recording, fetching it the first time. @returns false if it could not be played */
  async play(key: string, context: AudioContext, destination: AudioNode): Promise<boolean> {
    const entry = this.table[key];
    if (!entry) return false;
    try {
      let buffer = this.decoded.get(key);
      if (!buffer) {
        const response = await fetch(`${import.meta.env.BASE_URL}voice/${entry.file}`);
        if (!response.ok) return false;
        buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.decoded.set(key, buffer);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start();
      return true;
    } catch {
      return false;
    }
  }
}
