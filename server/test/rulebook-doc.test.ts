import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderRulebook } from '@crm/shared/rulebook-doc';

it('keeps docs/solution/RULES.md in sync with the rulebook (run pnpm rules:doc)', () => {
  assert.equal(
    readFileSync(resolve('../docs/solution/RULES.md'), 'utf8'),
    renderRulebook(),
  );
});
