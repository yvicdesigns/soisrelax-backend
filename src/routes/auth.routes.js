const express = require('express');
const router = express.Router();
const { register, login, refresh, logout, me, changePassword } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.post('/change-password', authenticate, changePassword);

module.exports = router;
