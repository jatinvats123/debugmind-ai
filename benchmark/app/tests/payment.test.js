const { authorize, getAttempts, resetPayments, PaymentDeclinedError } = require('../src/services/paymentService');

const GOOD_CARD = '4111111111111111';
const DECLINED_CARD = '4000000000000002';

beforeEach(() => {
  resetPayments();
});

describe('authorize', () => {
  it('resolves with an authorisation record for a good card', async () => {
    const auth = await authorize(GOOD_CARD, 25.0);
    expect(auth.authorized).toBe(true);
    expect(auth.amount).toBe(25.0);
    expect(auth.reference).toMatch(/^auth_/);
  });

  it('rejects a declined card', async () => {
    await expect(authorize(DECLINED_CARD, 25.0)).rejects.toThrow(PaymentDeclinedError);
  });

  it('rejects when no card is supplied', async () => {
    await expect(authorize(null, 25.0)).rejects.toThrow(/no card/i);
  });

  it('rejects a non-positive amount', async () => {
    await expect(authorize(GOOD_CARD, 0)).rejects.toThrow(/invalid charge/i);
  });

  it('records every attempt, including declined ones', async () => {
    await authorize(GOOD_CARD, 10);
    await expect(authorize(DECLINED_CARD, 10)).rejects.toThrow();
    expect(getAttempts()).toHaveLength(2);
  });
});
