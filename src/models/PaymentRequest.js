const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PaymentRequest = sequelize.define('PaymentRequest', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  creator_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  content_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  subscription_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: { min: 100 },
  },
  currency: {
    type: DataTypes.STRING(10),
    defaultValue: 'FCFA',
  },
  // Format: REF-XXXXXX-YYYYYY
  reference_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  payment_method: {
    type: DataTypes.ENUM('mtn_momo', 'airtel_money'),
    allowNull: false,
  },
  // pending = en attente de preuve | submitted = preuve soumise | approved | rejected | expired
  status: {
    type: DataTypes.ENUM('pending', 'submitted', 'approved', 'rejected', 'expired'),
    defaultValue: 'pending',
  },
  // URL S3 (privée, accès par URL signée)
  proof_image_url: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Clé S3 pour génération URL signée
  proof_image_key: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // MD5 du fichier pour détecter les doublons (contrainte UNIQUE)
  proof_hash: {
    type: DataTypes.STRING(32),
    allowNull: true,
    unique: true,
  },
  // ID de transaction saisi manuellement
  transaction_id: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // Motif de rejet (obligatoire si rejected)
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Admin ou créateur qui a validé
  validated_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  validated_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Expiration 30 minutes après création
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  // Nombre de tentatives de soumission (max 3)
  submission_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: { max: 3 },
  },
  // Type de demande
  payment_type: {
    type: DataTypes.ENUM('subscription', 'ppv', 'tip'),
    allowNull: false,
  },
  // Notification d'escalade 15 min envoyée ?
  escalated_creator: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  // Notification d'escalade 25 min envoyée à l'admin ?
  escalated_admin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  // Durée abonnement (mois, si type subscription)
  months: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  // Commission plateforme 20%
  platform_fee: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
  // Montant net créateur 80%
  creator_amount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
}, {
  tableName: 'payment_requests',
  hooks: {
    beforeCreate: (req) => {
      req.platform_fee = Math.round(parseFloat(req.amount) * 0.20);
      req.creator_amount = parseFloat(req.amount) - req.platform_fee;
    },
  },
  indexes: [
    { fields: ['user_id'] },
    { fields: ['creator_id'] },
    { fields: ['status'] },
    { fields: ['reference_code'], unique: true },
    { fields: ['expires_at'] },
  ],
});

module.exports = PaymentRequest;
