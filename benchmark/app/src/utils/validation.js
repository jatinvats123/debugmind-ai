const { ValidationError } = require('./errors');

const MAX_LINE_QUANTITY = 10;

/**
 * Parse a requested line quantity from a request body. JSON clients and HTML
 * forms both reach this, so numeric strings are accepted and converted.
 */
function parseQuantity(value, { min = 1 } = {}) {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < min || qty > MAX_LINE_QUANTITY) {
    throw new ValidationError(`Quantity must be a whole number from ${min} to ${MAX_LINE_QUANTITY}`);
  }
  return qty;
}

module.exports = { parseQuantity, MAX_LINE_QUANTITY };
