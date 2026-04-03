const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM(
      'payment_pending_validation',  // Pour le créateur/admin
      'payment_approved',            // Pour l'utilisateur
      'payment_rejected',            // Pour l'utilisateur
      'payment_expired',             // Pour l'utilisateur
      'payment_escalated',           // Pour l'admin
      'new_subscriber',              // Pour le créateur
      'new_message',                 // Pour le destinataire
    ),
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  // Données de navigation (JSON)
  data: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  read_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Référence à l'entité concernée
  related_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'notifications',
  indexes: [
    { fields: ['user_id', 'is_read'] },
    { fields: ['created_at'] },
  ],
});

module.exports = Notification;
