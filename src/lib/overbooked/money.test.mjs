// Run: node --experimental-strip-types --test src/lib/overbooked/money.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { round2, netTotal, discountError } from './money.ts';

test('net total = items - discount, in paise', () => {
  assert.equal(netTotal(5000, 500), 4500);
  assert.equal(netTotal(299.97, 0), 299.97);
});

test('float noise is removed', () => {
  assert.equal(0.1 + 0.2 === 0.3, false); // the trap
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(netTotal(19.99 * 3, 0), 59.97);
  assert.equal(netTotal(100 / 3, 0), 33.33);
});

test('discount rules match the database', () => {
  assert.equal(discountError(5000, 0), null);
  assert.equal(discountError(5000, 5000), null); // a free rental is allowed
  assert.equal(discountError(5000, 5000.01) !== null, true);
  assert.equal(discountError(5000, 6000) !== null, true);
  assert.equal(discountError(5000, -1) !== null, true);
  assert.equal(discountError(5000, NaN) !== null, true);
});
