const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/content', require('./content.routes'));
router.use('/payments', require('./payment.routes'));
router.use('/messages', require('./message.routes'));
router.use('/notifications', require('./notification.routes'));

module.exports = router;
