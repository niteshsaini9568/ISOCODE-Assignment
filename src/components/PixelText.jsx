import { glyphs } from './mosaic-reference.js';

export default function PixelText({ text }) {
  let cursor = 0;
  const pixels = [];
  for (const character of text) {
    const rows = glyphs[character]?.split('/');
    if (!rows) { cursor += 3; continue; }
    rows.forEach((row, y) => [...row].forEach((cell, x) => {
      if (cell === '#') pixels.push(<rect key={`${cursor + x}-${y}`} x={cursor + x + .06} y={y + .06} width=".88" height=".88" rx=".16"/>);
    }));
    cursor += Math.max(...rows.map(row => row.length)) + 1;
  }
  return <span className="pixel-text"><span className="sr-only">{text}</span><svg viewBox={`-.5 -.5 ${Math.max(1, cursor)} 9`} aria-hidden="true" focusable="false">{pixels}</svg></span>;
}
