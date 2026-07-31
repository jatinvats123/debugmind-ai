module.exports = {
  id: '06-race-order-sequence',
  category: 'promise-race',
  difficulty: 'hard',
  description:
    'The order id sequence is read before the await and written after it, so concurrent saves interleave and allocate duplicate ids. Sequential saves look fine; only concurrency exposes it.',
  expectedResolution: 'fixed',
  rootCause: {
    file: 'src/data/orderRepository.js',
    summary:
      'Read-modify-write of the shared sequence counter spans an await point, so overlapping calls observe the same starting value.',
  },
  edits: [
    {
      file: 'src/data/orderRepository.js',
      find:
        'async function saveOrder(order) {\n  await tick();\n  sequence += 1;\n  const stored = { ...order, id: order.id || `order_${sequence}`, savedAt: sequence };',
      replace:
        'async function saveOrder(order) {\n  const next = sequence + 1;\n  await tick();\n  sequence = next;\n  const stored = { ...order, id: order.id || `order_${next}`, savedAt: next };',
    },
  ],
  expectedFailing: ['orderRepository assigns distinct ids to concurrently saved orders'],
};
