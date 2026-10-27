// Writes docs/solution/RULES.md from the shared rulebook.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderRulebook } from '../shared/dist/rulebook-doc.js';

const target = fileURLToPath(
  new URL('../docs/solution/RULES.md', import.meta.url),
);
writeFileSync(target, renderRulebook());
console.log(`Wrote ${target}`);
