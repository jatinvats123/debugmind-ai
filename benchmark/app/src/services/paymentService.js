/**
 * Payment gateway stub.
 *
 * Authorisation is asynchronous and can fail. Failures must propagate: a
 * checkout that silently treats a declined card as success ships goods for free.
 */

const DECLINE_PREFIX = '4000';

let attemptLog = [];

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

class PaymentDeclinedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentDeclinedError';
    this.declined = true;
  }
}

/**
 * Authorise a charge. Resolves with an authorisation record, or rejects with
 * PaymentDeclinedError when the card is declined.
 */
async function authorize(cardNumber, amount) {
  await tick();
  attemptLog.push({ cardNumber, amount });

  if (!cardNumber) {
    throw new PaymentDeclinedError('No card supplied');
  }
  if (amount <= 0) {
    throw new PaymentDeclinedError(`Invalid charge amount: ${amount}`);
  }
  if (String(cardNumber).startsWith(DECLINE_PREFIX)) {
    throw new PaymentDeclinedError(`Card ${cardNumber} was declined`);
  }
  return { authorized: true, amount, reference: `auth_${attemptLog.length}` };
}

function getAttempts() {
  return [...attemptLog];
}

function resetPayments() {
  attemptLog = [];
}

module.exports = { authorize, getAttempts, resetPayments, PaymentDeclinedError, DECLINE_PREFIX };
