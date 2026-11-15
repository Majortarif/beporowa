/**
 * Puts the accessibility settings onto the page: colours for each kind of colour vision,
 * subtitle size and backing, and high contrast. The CSS reads these from the root element.
 */

import { MARKER_COLOURS, SUBTITLE_SCALE, type MarkerColours } from '../config/extras';
import { getSettings } from '../save/settings';

/** The marker colours for the player's colour vision. */
export function markerColours(): MarkerColours {
  return MARKER_COLOURS[getSettings().colourVision] ?? MARKER_COLOURS.normal;
}

export function applyAccessibility(): void {
  const settings = getSettings();
  const root = document.documentElement;
  const colours = markerColours();
  root.dataset.vision = settings.colourVision;
  root.dataset.contrast = settings.highContrast ? 'high' : 'normal';
  root.dataset.subtitleBacking = settings.subtitleBacking ? '1' : '0';
  root.style.setProperty('--subtitle-scale', String(SUBTITLE_SCALE[settings.subtitleSize] ?? 1));
  root.style.setProperty('--mark-good', colours.good);
  root.style.setProperty('--mark-bad', colours.bad);
  root.style.setProperty('--mark-ghost', colours.ghost);
  root.style.setProperty('--mark-friend', colours.friend);
  root.style.setProperty('--mark-police-a', colours.policeA);
  root.style.setProperty('--mark-police-b', colours.policeB);
}
