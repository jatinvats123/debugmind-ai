module.exports = {
  id: '02-float-money-accumulation',
  category: 'floating-point-money',
  difficulty: 'medium',
  description:
    'Money is summed and multiplied in floating point instead of integer cents, so totals drift by fractions of a cent and compound across line items.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/utils/money.js',
    summary:
      'sumMoney and multiplyMoney operate on dollar floats directly rather than converting to cents, reintroducing binary floating-point error.',
  },
  edits: [
    {
      file: 'src/utils/money.js',
      find: 'function sumMoney(amounts) {\n  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));\n}',
      replace: 'function sumMoney(amounts) {\n  return amounts.reduce((total, amount) => total + amount, 0);\n}',
    },
    {
      file: 'src/utils/money.js',
      find: 'function multiplyMoney(amount, quantity) {\n  return fromCents(toCents(amount) * quantity);\n}',
      replace: 'function multiplyMoney(amount, quantity) {\n  return amount * quantity;\n}',
    },
  ],
  expectedFailing: [
    'money arithmetic sums amounts exactly where floating point would drift',
    'money arithmetic sums many line items without accumulating error',
    'money arithmetic multiplies a price by a quantity exactly',
  ],
};
