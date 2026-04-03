const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Subscription = sequelize.define('Subscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  subscriber_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  creator_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  payment_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  // Montant payé en FCFA
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('active', 'expired', 'cancelled'),
    defaultValue: 'active',
  },
  started_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  // Renouvellement automatique
  auto_renew: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'subscriptions',
  indexes: [
    { fields: ['subscriber_id', 'creator_id'] },
    { fields: ['expires_at'] },
  ],
});

module.exports = Subscription;
