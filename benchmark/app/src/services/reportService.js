/**
 * Daily sales (GMV) for the finance dashboard.
 *
 * The business day is the calendar day in India, so an order placed at
 * 01:30 IST counts towards that day, not the previous UTC day.
 */
const { istDateKey } = require('../utils/dates');
const { toPaise, fromPaise, sumPaise } = require('../utils/paise');

function dailySales(orders) {
  const days = new Map();
  for (const order of orders) {
    const date = istDateKey(order.createdAt);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(toPaise(order.total));
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amounts]) => {
      const gmvPaise = sumPaise(amounts);
      return { date, orders: amounts.length, gmvPaise, gmv: fromPaise(gmvPaise) };
    });
}

module.exports = { dailySales };
