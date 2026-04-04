const { Op } = require('sequelize');
const { Content, User, Like, Comment, Subscription } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadToSupabase, deleteFromSupabase } = require('../config/storage');
const { sendPushNotifications } = require('../services/push.service');
const { createNotification } = require('../services/payment.service');

// Vérifie si l'utilisateur a accès au contenu
async function hasAccess(userId, content) {
  if (content.is_free) return true;
  if (!userId) return false;
  if (content.creator_id === userId) return true;

  if (!content.is_ppv) {
    const sub = await Subscription.findOne({
      where: {
        subscriber_id: userId,
        creator_id: content.creator_id,
        status: 'active',
        expires_at: { [Op.gt]: new Date() },
      },
    });
    return !!sub;
  }
  return false;
}

// POST /api/content - Publier un contenu
const createContent = asyncHandler(async (req, res) => {
  const { title, description, content_type, is_free, is_ppv, ppv_price } = req.body;

  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Seuls les créateurs peuvent publier du contenu.' });
  }

  let fileData = {};
  const mainFile = req.files?.file?.[0];
  const thumbFile = req.files?.thumbnail?.[0];

  if (mainFile) {
    const { key, url } = await uploadToSupabase(
      mainFile.buffer,
      'content',
      'content',
      mainFile.mimetype
    );
    fileData = {
      file_url: url,
      file_key: key,
      file_size: mainFile.size,
    };
  }

  if (thumbFile) {
    const { url: thumbUrl } = await uploadToSupabase(
      thumbFile.buffer,
      'content',
      'thumbnails',
      thumbFile.mimetype
    );
    fileData.thumbnail_url = thumbUrl;
  }

  const content = await Content.create({
    creator_id: req.user.id,
    title: title?.trim(),
    description: description?.trim(),
    content_type: content_type || 'image',
    is_free: is_free === 'true' || is_free === true,
    is_ppv: is_ppv === 'true' || is_ppv === true,
    ppv_price: parseInt(ppv_price) || 0,
    ...fileData,
  });

  // Incrémenter le compteur de posts
  await User.increment('posts_count', { where: { id: req.user.id } });

  const contentWithCreator = await Content.findByPk(content.id, {
    include: [{
      model: User,
      as: 'creator',
      attributes: ['id', 'username', 'display_name', 'avatar_url', 'is_verified'],
    }],
  });

  // Notifier les abonnés actifs
  try {
    const subscribers = await Subscription.findAll({
      where: {
        creator_id: req.user.id,
        status: 'active',
        expires_at: { [Op.gt]: new Date() },
      },
      include: [{ model: User, as: 'subscriber', attributes: ['expo_push_token'] }],
    });

    const notifTitle = `${req.user.display_name} a publié`;
    const notifBody = content.description?.slice(0, 80) || (content.content_type === 'video' ? 'Nouvelle vidéo' : 'Nouvelle publication');

    const pushMessages = [];
    for (const s of subscribers) {
      // In-app notification
      createNotification({
        userId: s.subscriber_id,
        type: 'new_content',
        title: notifTitle,
        body: notifBody,
        data: { screen: 'ContentView', contentId: content.id, username: req.user.username },
        relatedId: content.id,
      }).catch(() => {});

      if (s.subscriber?.expo_push_token) {
        pushMessages.push({
          to: s.subscriber.expo_push_token,
          title: notifTitle,
          body: notifBody,
          data: { type: 'new_content', contentId: content.id },
        });
      }
    }

    if (pushMessages.length > 0) {
      sendPushNotifications(pushMessages).catch(() => {});
    }
  } catch { }

  res.status(201).json({
    message: 'Contenu publié avec succès !',
    content: contentWithCreator,
  });
});

// GET /api/content/feed - Fil d'actualité
const getFeed = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Obtenir les créateurs auxquels l'utilisateur est abonné
  let subscribedCreatorIds = [];
  if (req.user) {
    const subs = await Subscription.findAll({
      where: {
        subscriber_id: req.user.id,
        status: 'active',
        expires_at: { [Op.gt]: new Date() },
      },
      attributes: ['creator_id'],
    });
    subscribedCreatorIds = subs.map((s) => s.creator_id);
  }

  const whereClause = {
    is_published: true,
    [Op.or]: [
      { is_free: true },
      ...(req.user ? [{ creator_id: req.user.id }] : []),
      ...(subscribedCreatorIds.length > 0 ? [{ creator_id: { [Op.in]: subscribedCreatorIds } }] : []),
    ],
  };

  const contents = await Content.findAndCountAll({
    where: whereClause,
    include: [{
      model: User,
      as: 'creator',
      attributes: ['id', 'username', 'display_name', 'avatar_url', 'is_verified'],
    }],
    limit: parseInt(limit),
    offset,
    order: [['created_at', 'DESC']],
  });

  // Masquer le contenu payant non accessible
  const items = contents.rows.map((c) => {
    const json = c.toJSON();
    const isOwner = req.user && req.user.id === c.creator_id;
    const isSubscribed = subscribedCreatorIds.includes(c.creator_id);

    if (!c.is_free && !isOwner && !isSubscribed) {
      json.file_url = null;
      json.gallery_urls = [];
      json.is_locked = true;
    } else {
      json.is_locked = false;
    }
    return json;
  });

  res.json({
    contents: items,
    total: contents.count,
    page: parseInt(page),
    totalPages: Math.ceil(contents.count / parseInt(limit)),
  });
});

// GET /api/content/:id - Détails d'un contenu
const getContent = asyncHandler(async (req, res) => {
  const content = await Content.findByPk(req.params.id, {
    include: [{
      model: User,
      as: 'creator',
      attributes: ['id', 'username', 'display_name', 'avatar_url', 'is_verified', 'subscription_price'],
    }, {
      model: Comment,
      as: 'comments',
      limit: 20,
      order: [['created_at', 'DESC']],
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'username', 'display_name', 'avatar_url'],
      }],
    }],
  });

  if (!content || !content.is_published) {
    return res.status(404).json({ error: 'Contenu introuvable.' });
  }

  const userId = req.user?.id;
  const access = await hasAccess(userId, content);

  // Incrémenter les vues
  await Content.increment('views_count', { where: { id: content.id } });

  const json = content.toJSON();

  let userLiked = false;
  if (userId) {
    const like = await Like.findOne({ where: { user_id: userId, content_id: content.id } });
    userLiked = !!like;
  }

  if (!access) {
    json.file_url = null;
    json.gallery_urls = [];
    json.is_locked = true;
  } else {
    json.is_locked = false;
  }

  res.json({ content: json, userLiked, hasAccess: access });
});

// GET /api/content/creator/:userId - Contenu d'un créateur
const getCreatorContent = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const isSubscribed = req.user ? await hasAccess(req.user.id, { is_free: false, creator_id: userId, is_ppv: false }) : false;
  const isOwner = req.user?.id === userId;

  const contents = await Content.findAndCountAll({
    where: {
      creator_id: userId,
      is_published: true,
    },
    attributes: { exclude: isOwner || isSubscribed ? [] : ['file_key'] },
    limit: parseInt(limit),
    offset,
    order: [['created_at', 'DESC']],
  });

  const items = contents.rows.map((c) => {
    const json = c.toJSON();
    if (!c.is_free && !isOwner && !isSubscribed) {
      json.file_url = c.thumbnail_url || null;
      json.gallery_urls = [];
      json.is_locked = true;
    } else {
      json.is_locked = false;
    }
    return json;
  });

  res.json({
    contents: items,
    total: contents.count,
    page: parseInt(page),
    totalPages: Math.ceil(contents.count / parseInt(limit)),
  });
});

// POST /api/content/:id/like
const toggleLike = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const content = await Content.findByPk(id);
  if (!content) return res.status(404).json({ error: 'Contenu introuvable.' });

  const [like, created] = await Like.findOrCreate({
    where: { user_id: req.user.id, content_id: id },
  });

  if (created) {
    await Content.increment('likes_count', { where: { id } });
    return res.json({ liked: true, likes_count: content.likes_count + 1 });
  }

  await like.destroy();
  await Content.decrement('likes_count', { where: { id } });
  res.json({ liked: false, likes_count: Math.max(0, content.likes_count - 1) });
});

// POST /api/content/:id/comment
const addComment = asyncHandler(async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Commentaire vide.' });

  const content = await Content.findByPk(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenu introuvable.' });

  const access = await hasAccess(req.user.id, content);
  if (!access) return res.status(403).json({ error: 'Abonnez-vous pour commenter.' });

  const comment = await Comment.create({
    user_id: req.user.id,
    content_id: req.params.id,
    text: text.trim(),
  });

  await Content.increment('comments_count', { where: { id: req.params.id } });

  const full = await Comment.findByPk(comment.id, {
    include: [{ model: User, as: 'user', attributes: ['id', 'username', 'display_name', 'avatar_url'] }],
  });

  res.status(201).json({ comment: full });
});

// PATCH /api/content/:id
const updateContent = asyncHandler(async (req, res) => {
  const content = await Content.findByPk(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenu introuvable.' });
  if (content.creator_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé.' });

  const { title, description, is_free, ppv_price } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description.trim();
  if (is_free !== undefined) updates.is_free = is_free === 'true' || is_free === true;
  if (ppv_price !== undefined && content.is_ppv) updates.ppv_price = parseInt(ppv_price);

  await content.update(updates);
  res.json({ message: 'Contenu mis à jour.', content });
});

// DELETE /api/content/:id
const deleteContent = asyncHandler(async (req, res) => {
  const content = await Content.findByPk(req.params.id);
  if (!content) return res.status(404).json({ error: 'Contenu introuvable.' });

  if (content.creator_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorisé.' });
  }

  await content.destroy();
  await User.decrement('posts_count', { where: { id: req.user.id } });

  res.json({ message: 'Contenu supprimé.' });
});

// GET /api/content/admin/list — liste admin avec filtre
const adminListContent = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = { is_published: true };
  if (search) {
    where[Op.or] = [
      { description: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { rows, count } = await Content.findAndCountAll({
    where,
    include: [{
      model: User,
      as: 'creator',
      attributes: ['id', 'username', 'display_name', 'avatar_url'],
    }],
    limit: parseInt(limit),
    offset,
    order: [['created_at', 'DESC']],
  });

  res.json({
    contents: rows,
    total: count,
    page: parseInt(page),
    totalPages: Math.ceil(count / parseInt(limit)),
  });
});

module.exports = {
  createContent,
  getFeed,
  getContent,
  getCreatorContent,
  toggleLike,
  addComment,
  updateContent,
  deleteContent,
  adminListContent,
};
