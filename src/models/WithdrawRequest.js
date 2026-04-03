const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const WithdrawRequest = sequelize.define('WithdrawRequest', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  creator_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1000 },
  },
  phone_number: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  provider: {
    type: DataTypes.ENUM('mtn', 'airtel', 'orange'),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'rejected'),
    defaultValue: 'pending',
  },
  admin_note: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  processed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  processed_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'withdraw_requests',
  indexes: [
    { fields: ['creator_id'] },
    { fields: ['status'] },
  ],
});

module.exports = WithdrawRequest;
