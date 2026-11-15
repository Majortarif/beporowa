# Credits and licenses

## Fonts (bundled in `public/fonts/`, license texts in `public/fonts/licenses/`)

All fonts are under the **SIL Open Font License 1.1**. Files come from the `@fontsource` npm packages, version 5.3.0.

| Font | Used for | Copyright |
|---|---|---|
| Galada | Logo, callouts, painted signs | Pablo Impallari; black foundry |
| Hind Siliguri | Menus and body text | Indian Type Foundry |
| Anek Bangla | HUD numbers, buttons | The Anek Project Authors (Ek Type) |
| Tiro Bangla | Proverbs and tagline | The Indigo Project Authors (Tiro Typeworks) |
| Noto Sans Bengali | Fallback for missing glyphs | The Noto Project Authors |

## Code libraries

| Library | License | Use |
|---|---|---|
| three.js | MIT | Rendering |
| @dimforge/rapier3d-compat | Apache-2.0 | Physics engine |
| postprocessing | Zlib | Bloom, vignette, tone mapping, chromatic aberration, depth of field in photo mode |
| Vite, Vitest, TypeScript | MIT, MIT, Apache-2.0 | Build and tests (not shipped to players) |
| @netlify/blobs | MIT | Leaderboard storage, in the Netlify Function only |
| @anthropic-ai/sdk | Apache-2.0 | Optional AI-written lines, in the Netlify Function only |
| ws | MIT | The friends relay in `server/`, not shipped to players |

## Everything else is original

- The car, road, city, signs, flowers, birds and HUD are drawn by code in this repo. No external art, model or texture files are used.
- All sound and music is generated live with the Web Audio API. There are no audio files. The tunes, song titles, adverts and radio lines are all original and invented.
- The game name, city, characters, cars and sign text are fictional. Dhaka is only an inspiration.
- Proverbs on the loading board are traditional Bangla sayings in the public domain.
- "মায়ের দোয়া" on the car is a common blessing painted on Bangladeshi buses and trucks, not a brand.
