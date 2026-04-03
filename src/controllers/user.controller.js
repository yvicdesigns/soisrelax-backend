const { Op } = require('sequelize');
const { User, Content, Subscription, Follow, sequelize } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadToSupabase } = require('../config/storage');
const { createNotification } = require('../services/payment.service');

// GET /api/users/:username
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    where: { username: req.params.username.toLowerCase() },
    attributes: { exclude: ['password_hash', 'refresh_token', 'mobile_money_number'] },
  });

  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  let isSubscribed = false;
  let isFollowing = false;

  if (req.user) {
    const sub = await Subscription.findOne({
      where: {
        subscriber_id: req.user.id,
        creator_id: user.id,
        status: 'active',
        expires_at: { [Op.gt]: new Date() },
      },
    });
    isSubscribed = !!sub;

    const follow = await Follow.findOne({
      where: { follower_id: req.user.id, following_id: user.id },
    });
    isFollowing = !!follow;
  }

  res.json({ user, isSubscribed, isFollowing });
});

// GET /api/users/search
const searchUsers = asyncHandler(async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;
  if (!q || q.length < 2) return res.json({ users: [] });

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const users = await User.findAll({
    where: {
      [Op.or]: [
        { username: { [Op.iLike]: `%${q}%` } },
        { display_name: { [Op.iLike]: `%${q}%` } },
      ],
      is_active: true,
      role: { [Op.in]: ['creator', 'subscriber'] },
    },
    attributes: ['id', 'username', 'display_name', 'avatar_url', 'role', 'is_verified', 'followers_count', 'subscription_price'],
    limit: parseInt(limit),
    offset,
    order: [['followers_count', 'DESC']],
  });

  res.json({ users });
});

// GET /api/users/discover
const discoverCreators = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const creators = await User.findAndCountAll({
    where: { role: 'creator', is_active: true },
    attributes: ['id', 'username', 'display_name', 'avatar_url', 'cover_url', 'bio',
      'is_verified', 'followers_count', 'posts_count', 'subscription_price'],
    limit: parseInt(limit),
    offset,
    order: [
      ['is_verified', 'DESC'],
      ['followers_count', 'DESC'],
    ],
  });

  res.json({
    creators: creators.rows,
    total: creators.count,
    page: parseInt(page),
    totalPages: Math.ceil(creators.count / parseInt(limit)),
  });
});

// PUT /api/users/me
const updateProfile = asyncHandler(async (req, res) => {
  const { display_name, bio, subscription_price, mobile_money_number, mobile_money_provider } = req.body;
  const user = req.user;

  const updates = {};
  if (display_name) updates.display_name = display_name.trim();
  if (bio !== undefined) updates.bio = bio;
  if (subscription_price && user.role === 'creator') {
    const price = parseInt(subscription_price);
    if (price < 500) return res.status(400).json({ error: 'Prix minimum: 500 FCFA' });
    updates.subscription_price = price;
  }
  if (mobile_money_number) updates.mobile_money_number = mobile_money_number;
  if (mobile_money_provider) updates.mobile_money_provider = mobile_money_provider;

  await User.update(updates, { where: { id: user.id } });
  const updated = await User.findByPk(user.id, {
    attributes: { exclude: ['password_hash', 'refresh_token'] },
  });

  res.json({ message: 'Profil mis à jour.', user: updated });
});

// PATCH /api/users/me/avatar
const updateAvatar = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  const { url } = await uploadToSupabase(req.file.buffer, 'avatars', 'avatars', req.file.mimetype);
  await User.update({ avatar_url: url }, { where: { id: req.user.id } });

  res.json({ message: 'Photo de profil mise à jour.', avatar_url: url });
});

// PATCH /api/users/me/cover
const updateCover = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  const { url } = await uploadToSupabase(req.file.buffer, 'covers', 'covers', req.file.mimetype);
  await User.update({ cover_url: url }, { where: { id: req.user.id } });

  res.json({ message: 'Photo de couverture mise à jour.', cover_url: url });
});

// POST /api/users/:userId/follow
const followUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas vous suivre vous-même.' });
  }

  const target = await User.findByPk(userId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const [follow, created] = await Follow.findOrCreate({
    where: { follower_id: req.user.id, following_id: userId },
  });

  if (created) {
    await User.increment('followers_count', { where: { id: userId } });
    await User.increment('following_count', { where: { id: req.user.id } });
    createNotification({
      userId,
      type: 'new_subscriber',
      title: `${req.user.display_name} vous suit maintenant`,
      body: 'Vous avez un nouvel abonné.',
      data: { screen: 'PublicProfile', username: req.user.username },
      relatedId: req.user.id,
    });
    return res.json({ message: `Vous suivez maintenant ${target.display_name}.`, following: true });
  }

  // Unfollow
  await follow.destroy();
  await User.decrement('followers_count', { where: { id: userId } });
  await User.decrement('following_count', { where: { id: req.user.id } });
  res.json({ message: `Vous ne suivez plus ${target.display_name}.`, following: false });
});

// GET /api/users/me/stats (pour les créateurs)
const getCreatorStats = asyncHandler(async (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Réservé aux créateurs.' });
  }

  const [activeSubscriptions, totalEarnings, thisMonthEarnings] = await Promise.all([
    Subscription.count({
      where: {
        creator_id: req.user.id,
        status: 'active',
        expires_at: { [Op.gt]: new Date() },
      },
    }),
    sequelize.query(
      `SELECT COALESCE(SUM(creator_amount), 0) as total FROM payment_requests WHERE creator_id = :creatorId AND status = 'approved'`,
      { replacements: { creatorId: req.user.id }, type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT COALESCE(SUM(creator_amount), 0) as total FROM payment_requests WHERE creator_id = :creatorId AND status = 'approved' AND created_at >= date_trunc('month', NOW())`,
      { replacements: { creatorId: req.user.id }, type: sequelize.QueryTypes.SELECT }
    ),
  ]);

  const user = await User.findByPk(req.user.id, { attributes: ['balance', 'total_earnings', 'posts_count', 'followers_count'] });

  res.json({
    active_subscribers: activeSubscriptions,
    total_earnings: parseInt(totalEarnings[0].total),
    this_month_earnings: parseInt(thisMonthEarnings[0].total),
    balance: user.balance,
    posts_count: user.posts_count,
    followers_count: user.followers_count,
  });
});

// POST /api/users/me/push-token
const savePushToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requis.' });
  await User.update({ expo_push_token: token }, { where: { id: req.user.id } });
  res.json({ message: 'Token enregistré.' });
});

module.exports = {
  getProfile,
  searchUsers,
  discoverCreators,
  updateProfile,
  updateAvatar,
  updateCover,
  followUser,
  getCreatorStats,
  savePushToken,
};
