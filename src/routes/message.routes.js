const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/message.controller');
const { authenticate } = require('../middleware/auth');

router.get('/conversations', authenticate, ctrl.getConversations);
router.get('/:userId', authenticate, ctrl.getMessages);
router.post('/:userId', authenticate, ctrl.sendMessage);
router.delete('/:messageId', authenticate, ctrl.deleteMessage);

module.exports = router;
