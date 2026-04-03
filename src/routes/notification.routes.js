const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { Notification } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/notifications
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const notifications = await Notification.findAll({
    where: { user_id: req.user.id },
    order: [['created_at', 'DESC']],
    limit: 30,
  });
  const unread_count = await Notification.count({
    where: { user_id: req.user.id, is_read: false },
  });
  res.json({ notifications, unread_count });
}));

// PATCH /api/notifications/read-all
router.patch('/read-all', authenticate, asyncHandler(async (req, res) => {
  await Notification.update(
    { is_read: true, read_at: new Date() },
    { where: { user_id: req.user.id, is_read: false } }
  );
  res.json({ message: 'Toutes les notifications marquées comme lues.' });
}));

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, asyncHandler(async (req, res) => {
  await Notification.update(
    { is_read: true, read_at: new Date() },
    { where: { id: req.params.id, user_id: req.user.id } }
  );
  res.json({ message: 'Notification lue.' });
}));

module.exports = router;
