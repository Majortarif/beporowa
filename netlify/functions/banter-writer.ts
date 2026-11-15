/**
 * Asks Claude for one short line. Runs only on the server: the API key comes from the
 * environment and never reaches the browser. Any failure gives null, and the game then uses a
 * line written by hand, so a player never waits on it.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BanterPrompt, BanterWriter } from '../../src/online/banter-core';

/** The model unless BANTER_MODEL names another. */
export const DEFAULT_BANTER_MODEL = 'claude-opus-5-5';

export function createBanterWriter(model: string = DEFAULT_BANTER_MODEL): BanterWriter {
  // A game cannot wait long, so one short try and no retries: the written lines are the fallback.
  const client = new Anthropic({ timeout: 8000, maxRetries: 0 });
  return async (prompt: BanterPrompt): Promise<string | null> => {
    try {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 1024,
        // A one-line quip needs little thought.
        output_config: { effort: 'low' },
        // If the model declines on policy grounds, the server retries on its default fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      });
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      let text = '';
      for (const block of response.content) {
        if (block.type === 'text') text += block.text;
      }
      return text.trim() || null;
    } catch (error) {
      if (error instanceof Anthropic.APIError) console.error(`banter: API error ${error.status ?? ''}`);
      else console.error('banter: request failed');
      return null;
    }
  };
}
