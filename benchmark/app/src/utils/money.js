/**
 * Money handling in integer cents.
 *
 * Currency must never be accumulated in floating point: 0.1 + 0.2 !== 0.3, and
 * those errors compound across line items until an order total is off by a cent.
 * Everything internal is cents; conversion happens only at the edges.
 */

function toCents(amount) {
  return Math.round(amount * 100);
}

function fromCents(cents) {
  return cents / 100;
}

/** Sum a list of dollar amounts exactly, by summing in cents. */
function sumMoney(amounts) {
  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));
}

/** Multiply a dollar amount by a whole quantity. */
function multiplyMoney(amount, quantity) {
  return fromCents(toCents(amount) * quantity);
}

/** Apply a percentage (0-100) to an amount, rounding to the nearest cent. */
function percentOf(amount, percent) {
  return fromCents(Math.round((toCents(amount) * percent) / 100));
}

/** Round a dollar amount to whole cents. */
function roundMoney(amount) {
  return fromCents(toCents(amount));
}

module.exports = { toCents, fromCents, sumMoney, multiplyMoney, percentOf, roundMoney };
