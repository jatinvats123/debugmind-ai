/**
 * Delivery estimates by Indian pincode.
 *
 * The courier's zone table lists the pincodes it serves quickly. Anything
 * else is still deliverable through the national network: slower, and
 * prepaid only.
 */
const { ValidationError } = require('../utils/errors');
const { parseDateOnly, formatDateOnly, addBusinessDays } = require('../utils/dates');

const ZONES = {
  metro: { name: 'metro', businessDays: 2, cod: true },
  regional: { name: 'regional', businessDays: 4, cod: true },
  national: { name: 'national', businessDays: 7, cod: false },
};

// First three digits of the pincode identify the sorting district.
const METRO_PREFIXES = ['110', '400', '560', '600', '700', '500']; // Delhi, Mumbai, Bengaluru, Chennai, Kolkata, Hyderabad
const REGIONAL_PREFIXES = ['122', '201', '411', '380', '302']; // Gurugram, Noida, Pune, Ahmedabad, Jaipur

// Cash on delivery is capped per order.
const COD_LIMIT_RUPEES = 50000;

// Six digits, and the first digit (the postal region) is never 0.
const PINCODE = /^[1-9][0-9]{5}$/;

class ZoneNotFoundError extends Error {
  constructor(pincode) {
    super(`No courier zone for pincode ${pincode}`);
    this.name = 'ZoneNotFoundError';
  }
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function isValidPincode(value) {
  return PINCODE.test(String(value));
}

/** Look a pincode up in the courier's zone table (an async call in production). */
async function lookupZone(pincode) {
  await tick();
  const prefix = pincode.slice(0, 3);
  if (METRO_PREFIXES.includes(prefix)) return ZONES.metro;
  if (REGIONAL_PREFIXES.includes(prefix)) return ZONES.regional;
  throw new ZoneNotFoundError(pincode);
}

async function resolveZone(pincode) {
  try {
    return await lookupZone(pincode);
  } catch (err) {
    if (err instanceof ZoneNotFoundError) return ZONES.national;
    throw err;
  }
}

function isCodAvailable(zone, orderTotal) {
  return zone.cod && orderTotal <= COD_LIMIT_RUPEES;
}

async function estimateDelivery({ pincode, orderDate, orderTotal = 0 }) {
  if (!isValidPincode(pincode)) {
    throw new ValidationError(`Invalid pincode: ${pincode}`);
  }
  const placed = parseDateOnly(orderDate);
  if (!placed) {
    throw new ValidationError(`Invalid order date: ${orderDate}`);
  }

  const zone = await resolveZone(String(pincode));
  return {
    pincode: String(pincode),
    zone: zone.name,
    estimatedDelivery: formatDateOnly(addBusinessDays(placed, zone.businessDays)),
    codAvailable: isCodAvailable(zone, orderTotal),
  };
}

module.exports = {
  estimateDelivery,
  resolveZone,
  lookupZone,
  isValidPincode,
  isCodAvailable,
  ZONES,
  COD_LIMIT_RUPEES,
  ZoneNotFoundError,
};
