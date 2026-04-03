const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/content.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { uploadContent } = require('../config/storage');

router.get('/feed', optionalAuth, ctrl.getFeed);
router.post('/', authenticate, uploadContent.single('file'), ctrl.createContent);
router.get('/creator/:userId', optionalAuth, ctrl.getCreatorContent);
router.get('/:id', optionalAuth, ctrl.getContent);
router.post('/:id/like', authenticate, ctrl.toggleLike);
router.post('/:id/comment', authenticate, ctrl.addComment);
router.delete('/:id', authenticate, ctrl.deleteContent);

module.exports = router;
