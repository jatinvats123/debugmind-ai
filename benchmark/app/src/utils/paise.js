/**
 * Indian rupee amounts as integer paise (1 rupee = 100 paise).
 *
 * Sales reports and instalment plans work in paise so that every stored
 * amount is a whole number and nothing is lost to rounding.
 */

function toPaise(rupees) {
  return Math.round(rupees * 100);
}

function fromPaise(paise) {
  return paise / 100;
}

function sumPaise(amounts) {
  return amounts.reduce((total, paise) => total + paise, 0);
}

/**
 * Split an amount into `parts` shares that differ by at most one paisa and
 * always add back up to the original amount. Earlier shares take the extra
 * paise, so the first instalment is never the smallest.
 */
function splitPaise(totalPaise, parts) {
  const base = Math.floor(totalPaise / parts);
  let remainder = totalPaise - base * parts;
  const shares = [];
  for (let i = 0; i < parts; i++) {
    shares.push(base + (remainder > 0 ? 1 : 0));
    remainder -= 1;
  }
  return shares;
}

module.exports = { toPaise, fromPaise, sumPaise, splitPaise };
