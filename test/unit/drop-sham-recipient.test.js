import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropShamRecipient } from '../../src/index.js';

test('dropShamRecipient: returns true for default sham address', () => {
  assert.equal(dropShamRecipient({ to: 'null@knowless.invalid' }), true);
});

test('dropShamRecipient: returns false for a real address', () => {
  assert.equal(dropShamRecipient({ to: 'alice@example.com' }), false);
});

test('dropShamRecipient: returns false for empty string', () => {
  assert.equal(dropShamRecipient({ to: '' }), false);
});

test('dropShamRecipient: returns false for partial match', () => {
  assert.equal(dropShamRecipient({ to: 'null@knowless.invalid.extra' }), false);
  assert.equal(dropShamRecipient({ to: 'other@knowless.invalid' }), false);
});

test('dropShamRecipient: honours custom shamRecipient', () => {
  const custom = 'sham@myapp.invalid';
  assert.equal(dropShamRecipient({ to: custom }, custom), true);
  assert.equal(dropShamRecipient({ to: 'null@knowless.invalid' }, custom), false);
});

test('dropShamRecipient: handles null/undefined envelope gracefully', () => {
  assert.equal(dropShamRecipient(null), false);
  assert.equal(dropShamRecipient(undefined), false);
  assert.equal(dropShamRecipient({}), false);
});
