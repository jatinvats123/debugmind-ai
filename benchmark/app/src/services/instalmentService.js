/**
 * No-cost EMI plans: an order total split into equal monthly instalments.
 */
const { ValidationError } = require('../utils/errors');
const { toPaise, fromPaise, splitPaise } = require('../utils/paise');

const MAX_INSTALMENTS = 24;

function planInstalments(total, count) {
  if (!Number.isFinite(total) || toPaise(total) <= 0) {
    throw new ValidationError('total must be a positive amount');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALMENTS) {
    throw new ValidationError(`count must be a whole number from 1 to ${MAX_INSTALMENTS}`);
  }

  return splitPaise(toPaise(total), count).map((amountPaise, index) => ({
    number: index + 1,
    amountPaise,
    amount: fromPaise(amountPaise),
  }));
}

module.exports = { planInstalments, MAX_INSTALMENTS };
