const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/content.controller');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { uploadContent } = require('../config/storage');

router.get('/admin/list', authenticate, requireRole('admin'), ctrl.adminListContent);
router.get('/feed', optionalAuth, ctrl.getFeed);
router.post('/', authenticate, uploadContent.fields([{ name: 'file', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), ctrl.createContent);
router.get('/creator/:userId', optionalAuth, ctrl.getCreatorContent);
router.get('/:id', optionalAuth, ctrl.getContent);
router.post('/:id/like', authenticate, ctrl.toggleLike);
router.post('/:id/comment', authenticate, ctrl.addComment);
router.patch('/:id', authenticate, ctrl.updateContent);
router.delete('/:id', authenticate, ctrl.deleteContent);

module.exports = router;
