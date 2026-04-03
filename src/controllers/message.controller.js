const { Op } = require('sequelize');
const { Message, User, sequelize } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { createNotification } = require('../services/payment.service');

// GET /api/messages/conversations
const getConversations = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Obtenir les derniers messages de chaque conversation
  const conversations = await sequelize.query(`
    SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
      m.*,
      CASE WHEN m.sender_id = :userId THEN m.receiver_id ELSE m.sender_id END as other_user_id,
      (SELECT COUNT(*) FROM messages WHERE receiver_id = :userId AND sender_id = other_user_id_alias AND is_read = false) as unread_count
    FROM messages m
    LEFT JOIN LATERAL (
      SELECT CASE WHEN m.sender_id = :userId THEN m.receiver_id ELSE m.sender_id END as other_user_id_alias
    ) x ON true
    WHERE (m.sender_id = :userId AND m.is_deleted_sender = false)
       OR (m.receiver_id = :userId AND m.is_deleted_receiver = false)
    ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), m.created_at DESC
  `, {
    replacements: { userId },
    type: sequelize.QueryTypes.SELECT,
  });

  // Charger les infos des autres utilisateurs
  const otherUserIds = [...new Set(conversations.map((c) => c.other_user_id))];
  const users = await User.findAll({
    where: { id: { [Op.in]: otherUserIds } },
    attributes: ['id', 'username', 'display_name', 'avatar_url', 'last_seen'],
  });

  const usersMap = {};
  users.forEach((u) => { usersMap[u.id] = u; });

  const result = conversations.map((c) => ({
    ...c,
    other_user: usersMap[c.other_user_id],
  }));

  res.json({ conversations: result });
});

// GET /api/messages/:userId - Conversation avec un utilisateur
const getMessages = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const myId = req.user.id;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const messages = await Message.findAndCountAll({
    where: {
      [Op.or]: [
        { sender_id: myId, receiver_id: userId, is_deleted_sender: false },
        { sender_id: userId, receiver_id: myId, is_deleted_receiver: false },
      ],
    },
    include: [{
      model: User,
      as: 'sender',
      attributes: ['id', 'username', 'display_name', 'avatar_url'],
    }],
    limit: parseInt(limit),
    offset,
    order: [['created_at', 'DESC']],
  });

  // Marquer comme lus
  await Message.update(
    { is_read: true, read_at: new Date() },
    { where: { sender_id: userId, receiver_id: myId, is_read: false } }
  );

  const otherUser = await User.findByPk(userId, {
    attributes: ['id', 'username', 'display_name', 'avatar_url', 'last_seen'],
  });

  res.json({
    messages: messages.rows.reverse(),
    total: messages.count,
    page: parseInt(page),
    other_user: otherUser,
  });
});

// POST /api/messages/:userId - Envoyer un message
const sendMessage = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { content, message_type = 'text' } = req.body;
  const myId = req.user.id;

  if (userId === myId) {
    return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer un message à vous-même.' });
  }

  const receiver = await User.findByPk(userId);
  if (!receiver) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  if (!content?.trim() && !req.file) {
    return res.status(400).json({ error: 'Message vide.' });
  }

  const message = await Message.create({
    sender_id: myId,
    receiver_id: userId,
    content: content?.trim(),
    message_type,
    media_url: req.file?.location || null,
  });

  const full = await Message.findByPk(message.id, {
    include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'display_name', 'avatar_url'] }],
  });

  // Émettre via socket.io
  try {
    const { getIo } = require('../config/socket');
    getIo().to(`user:${userId}`).emit('new_message', full);
  } catch { /* socket optionnel */ }

  // Notification
  const sender = await User.findByPk(myId, { attributes: ['display_name'] });
  createNotification({
    userId,
    type: 'new_message',
    title: `Nouveau message de ${sender?.display_name}`,
    body: content?.trim()?.slice(0, 80) || 'Nouveau message',
    data: { screen: 'Conversation', userId: myId },
    relatedId: message.id,
  });

  res.status(201).json({ message: full });
});

// DELETE /api/messages/:messageId
const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findByPk(req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message introuvable.' });

  if (message.sender_id === req.user.id) {
    await message.update({ is_deleted_sender: true });
  } else if (message.receiver_id === req.user.id) {
    await message.update({ is_deleted_receiver: true });
  } else {
    return res.status(403).json({ error: 'Non autorisé.' });
  }

  res.json({ message: 'Message supprimé.' });
});

module.exports = { getConversations, getMessages, sendMessage, deleteMessage };
