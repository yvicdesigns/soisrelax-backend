const sequelize = require('../config/database');
const User = require('./User');
const Content = require('./Content');
const Subscription = require('./Subscription');
const Payment = require('./Payment');
const PaymentRequest = require('./PaymentRequest');
const PaymentLog = require('./PaymentLog');
const Notification = require('./Notification');
const Message = require('./Message');
const Like = require('./Like');
const Comment = require('./Comment');
const Follow = require('./Follow');

// ===== Relations User =====
User.hasMany(Content, { foreignKey: 'creator_id', as: 'contents' });
User.hasMany(Subscription, { foreignKey: 'subscriber_id', as: 'subscriptions' });
User.hasMany(Subscription, { foreignKey: 'creator_id', as: 'subscribers' });
User.hasMany(Payment, { foreignKey: 'user_id', as: 'payments' });
User.hasMany(Message, { foreignKey: 'sender_id', as: 'sentMessages' });
User.hasMany(Message, { foreignKey: 'receiver_id', as: 'receivedMessages' });
User.hasMany(Like, { foreignKey: 'user_id', as: 'likes' });
User.hasMany(Comment, { foreignKey: 'user_id', as: 'comments' });
User.hasMany(Follow, { foreignKey: 'follower_id', as: 'following' });
User.hasMany(Follow, { foreignKey: 'following_id', as: 'followers' });
User.hasMany(PaymentRequest, { foreignKey: 'user_id', as: 'paymentRequests' });
User.hasMany(PaymentRequest, { foreignKey: 'creator_id', as: 'receivedPaymentRequests' });
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });

// ===== Relations Content =====
Content.belongsTo(User, { foreignKey: 'creator_id', as: 'creator' });
Content.hasMany(Like, { foreignKey: 'content_id', as: 'likes' });
Content.hasMany(Comment, { foreignKey: 'content_id', as: 'comments' });
Content.hasMany(PaymentRequest, { foreignKey: 'content_id', as: 'paymentRequests' });

// ===== Relations Subscription =====
Subscription.belongsTo(User, { foreignKey: 'subscriber_id', as: 'subscriber' });
Subscription.belongsTo(User, { foreignKey: 'creator_id', as: 'creator' });
Subscription.belongsTo(Payment, { foreignKey: 'payment_id', as: 'payment' });

// ===== Relations PaymentRequest =====
PaymentRequest.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
PaymentRequest.belongsTo(User, { foreignKey: 'creator_id', as: 'creator' });
PaymentRequest.belongsTo(User, { foreignKey: 'validated_by', as: 'validator' });
PaymentRequest.belongsTo(Content, { foreignKey: 'content_id', as: 'content' });
PaymentRequest.belongsTo(Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
PaymentRequest.hasMany(PaymentLog, { foreignKey: 'payment_request_id', as: 'logs' });

// ===== Relations PaymentLog =====
PaymentLog.belongsTo(PaymentRequest, { foreignKey: 'payment_request_id', as: 'paymentRequest' });
PaymentLog.belongsTo(User, { foreignKey: 'performed_by', as: 'actor' });

// ===== Relations Notification =====
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// ===== Relations Payment =====
Payment.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// ===== Relations Message =====
Message.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });
Message.belongsTo(User, { foreignKey: 'receiver_id', as: 'receiver' });

// ===== Relations Like =====
Like.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Like.belongsTo(Content, { foreignKey: 'content_id', as: 'content' });

// ===== Relations Comment =====
Comment.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Comment.belongsTo(Content, { foreignKey: 'content_id', as: 'content' });

// ===== Relations Follow =====
Follow.belongsTo(User, { foreignKey: 'follower_id', as: 'follower' });
Follow.belongsTo(User, { foreignKey: 'following_id', as: 'followed' });

module.exports = {
  sequelize,
  User,
  Content,
  Subscription,
  Payment,
  PaymentRequest,
  PaymentLog,
  Notification,
  Message,
  Like,
  Comment,
  Follow,
};
