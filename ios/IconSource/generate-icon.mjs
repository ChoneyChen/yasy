import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Original Yasy artwork. Flat SVG layers only: Icon Composer owns background,
// Liquid Glass, shadows and platform masking. No fonts or external resources.
const output = join(dirname(fileURLToPath(import.meta.url)), 'layers');
const nativeAssets = join(dirname(fileURLToPath(import.meta.url)), '../Yasy/AppIcon.icon/Assets');
mkdirSync(output, { recursive: true });
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="translate(-76.8 -76.8) scale(1.15)">${body}</g></svg>\n`;
const layers = {
  '01-Left-page.svg': '<path fill="#F3F5D9" d="M266 452C350 431 436 455 495 513V771C432 723 352 705 269 723C256 726 244 716 244 703V475C244 463 253 455 266 452Z"/>',
  '02-Right-page.svg': '<path fill="#E1EDB8" d="M758 452C674 431 588 455 529 513V771C592 723 672 705 755 723C768 726 780 716 780 703V475C780 463 771 455 758 452Z"/>',
  '03-New-growth.svg': '<path d="M512 534C512 447 520 392 565 341" fill="none" stroke="#B6D58B" stroke-width="30" stroke-linecap="round"/><path fill="#B6D58B" d="M506 422C422 434 372 396 367 319C443 309 501 345 506 422Z"/><path fill="#B6D58B" d="M518 372C521 284 575 239 663 250C664 322 609 381 518 372Z"/>',
};
for (const [filename, body] of Object.entries(layers)) {
  writeFileSync(join(output, filename), svg(body));
  if (existsSync(nativeAssets)) writeFileSync(join(nativeAssets, filename), svg(body));
}
console.log(`Created ${Object.keys(layers).length} original 1024×1024 SVG layers in ios/IconSource/layers.`);
