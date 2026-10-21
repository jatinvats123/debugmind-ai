const express = require('express');
const { planInstalments } = require('../services/instalmentService');

const router = express.Router();

// GET /instalments?total=200&count=3
router.get('/', (req, res, next) => {
  try {
    const total = Number(req.query.total);
    const count = Number(req.query.count);
    res.json({ total, count, instalments: planInstalments(total, count) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
