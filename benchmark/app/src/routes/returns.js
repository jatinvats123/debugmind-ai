const express = require('express');
const { checkReturnEligibility } = require('../services/returnsService');

const router = express.Router();

// GET /returns/eligibility?deliveredOn=2026-03-10&requestedOn=2026-03-14
router.get('/eligibility', (req, res, next) => {
  try {
    res.json(checkReturnEligibility({ deliveredOn: req.query.deliveredOn, requestedOn: req.query.requestedOn }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
