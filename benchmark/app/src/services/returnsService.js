const { ValidationError } = require('../utils/errors');
const { parseDateOnly, daysBetween } = require('../utils/dates');

// Customers may request a return up to and including the 7th day after delivery.
const RETURN_WINDOW_DAYS = 7;

function checkReturnEligibility({ deliveredOn, requestedOn }) {
  const delivered = parseDateOnly(deliveredOn);
  const requested = parseDateOnly(requestedOn);
  if (!delivered || !requested) {
    throw new ValidationError('deliveredOn and requestedOn must be valid YYYY-MM-DD dates');
  }

  const daysSinceDelivery = daysBetween(delivered, requested);
  if (daysSinceDelivery < 0) {
    throw new ValidationError('A return cannot be requested before the order is delivered');
  }

  return {
    deliveredOn,
    requestedOn,
    daysSinceDelivery,
    windowDays: RETURN_WINDOW_DAYS,
    eligible: daysSinceDelivery <= RETURN_WINDOW_DAYS,
  };
}

module.exports = { checkReturnEligibility, RETURN_WINDOW_DAYS };
