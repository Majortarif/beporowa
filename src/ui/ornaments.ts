/** Hand-drawn SVG ornaments for the UI. Static strings with no user text, so innerHTML is safe here. */

function petalRing(count: number, length: number, width: number, fill: string, offset = 0): string {
  let paths = '';
  for (let i = 0; i < count; i++) {
    const angle = ((i + offset) / count) * 360;
    paths += `<path transform="rotate(${angle} 50 50)" d="M50 50 Q${50 + width} ${50 - length * 0.5} 50 ${50 - length} Q${50 - width} ${50 - length * 0.5} 50 50Z" fill="${fill}"/>`;
  }
  return paths;
}

/** Shapla-style flower in rickshaw colours. */
export function flowerSvg(petal: string, inner: string, center: string, className = ''): string {
  return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true">
    ${petalRing(8, 47, 16, petal)}
    ${petalRing(8, 31, 11, inner, 0.5)}
    <circle cx="50" cy="50" r="12" fill="#1b1410"/>
    <circle cx="50" cy="50" r="8" fill="${center}"/>
  </svg>`;
}

/** A sprig of leaves that fills the gap beside a flower. */
export function leafSprigSvg(className = ''): string {
  return `<svg class="${className}" viewBox="0 0 120 60" aria-hidden="true">
    <path d="M4 30 Q60 -6 116 18 Q70 34 4 30Z" fill="#5fa52f"/>
    <path d="M4 30 Q60 66 116 42 Q70 26 4 30Z" fill="#3f7f24"/>
    <path d="M4 30 H104" stroke="#1b1410" stroke-width="2" fill="none"/>
  </svg>`;
}

/** A flying bird in the style of rickshaw back panels, used on the title board. */
export function birdSvg(className = ''): string {
  return `<svg class="${className}" viewBox="0 0 120 70" aria-hidden="true">
    <path d="M6 44 Q36 22 62 34 Q72 8 104 6 Q92 26 88 38 Q110 40 116 48 Q88 50 76 50 Q52 66 26 56 Q14 52 6 44Z" fill="#0f7f7a"/>
    <path d="M62 34 Q72 8 104 6 Q92 26 88 38 Q76 40 62 34Z" fill="#f2a20c"/>
    <circle cx="26" cy="42" r="3.4" fill="#efe3c8"/>
    <circle cx="26" cy="42" r="1.6" fill="#1b1410"/>
    <path d="M6 44 L-2 46 L8 49Z" fill="#d8402b"/>
  </svg>`;
}
