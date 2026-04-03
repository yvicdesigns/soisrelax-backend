const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  // ID transaction CinetPay
  cinetpay_transaction_id: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  // Référence interne
  reference: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  // Montant en FCFA
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 100 },
  },
  currency: {
    type: DataTypes.STRING(10),
    defaultValue: 'XAF', // Franc CFA BEAC
  },
  // Méthode de paiement
  payment_method: {
    type: DataTypes.ENUM('mtn_money', 'airtel_money', 'orange_money', 'card'),
    allowNull: true,
  },
  // Numéro de téléphone utilisé pour le paiement
  phone_number: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed', 'refunded'),
    defaultValue: 'pending',
  },
  // Type de paiement
  payment_type: {
    type: DataTypes.ENUM('subscription', 'ppv', 'tip'),
    allowNull: false,
  },
  // ID du créateur concerné
  creator_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  // ID du contenu (pour PPV)
  content_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  // Commission plateforme (20%)
  platform_fee: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  // Montant net pour le créateur
  creator_amount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  // Métadonnées CinetPay
  gateway_response: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'payments',
  hooks: {
    beforeCreate: (payment) => {
      // Commission plateforme: 20%
      payment.platform_fee = Math.round(payment.amount * 0.20);
      payment.creator_amount = payment.amount - payment.platform_fee;
    },
  },
});

module.exports = Payment;
