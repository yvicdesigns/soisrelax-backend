const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  sender_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  receiver_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  message_type: {
    type: DataTypes.ENUM('text', 'image', 'video', 'audio'),
    defaultValue: 'text',
  },
  media_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Message payant (contenu exclusif en MP)
  is_paid: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  price: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  read_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  is_deleted_sender: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_deleted_receiver: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'messages',
  indexes: [
    { fields: ['sender_id', 'receiver_id'] },
    { fields: ['created_at'] },
  ],
});

module.exports = Message;
