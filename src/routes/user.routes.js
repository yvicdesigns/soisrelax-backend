const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/user.controller');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { uploadAvatar, uploadCover } = require('../config/storage');

router.get('/search', ctrl.searchUsers);
router.get('/discover', ctrl.discoverCreators);
router.get('/me/stats', authenticate, ctrl.getCreatorStats);
router.post('/me/push-token', authenticate, ctrl.savePushToken);
router.post('/me/become-creator', authenticate, ctrl.becomeCreator);
router.put('/me', authenticate, ctrl.updateProfile);
router.patch('/me/avatar', authenticate, uploadAvatar.single('avatar'), ctrl.updateAvatar);
router.patch('/me/cover', authenticate, uploadCover.single('cover'), ctrl.updateCover);
router.post('/:userId/follow', authenticate, ctrl.followUser);

// ===== Admin =====
router.get('/admin/list', authenticate, requireRole('admin'), ctrl.adminListUsers);
router.patch('/admin/:id/verify', authenticate, requireRole('admin'), ctrl.adminVerifyUser);
router.patch('/admin/:id/toggle-active', authenticate, requireRole('admin'), ctrl.adminToggleActive);

router.get('/:username', optionalAuth, ctrl.getProfile);

module.exports = router;
