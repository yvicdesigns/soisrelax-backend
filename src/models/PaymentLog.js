const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Audit trail complet de toutes les actions sur les paiements.
 * Conservation minimum 12 mois.
 */
const PaymentLog = sequelize.define('PaymentLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  payment_request_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  // Action effectuée
  action: {
    type: DataTypes.ENUM(
      'created',
      'proof_submitted',
      'approved',
      'rejected',
      'expired',
      'escalated_creator',
      'escalated_admin',
      'resubmitted',
      'duplicate_proof_blocked',
      'max_attempts_reached',
      'fraud_flagged',
    ),
    allowNull: false,
  },
  // Qui a effectué l'action (null = système automatique)
  performed_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  performed_by_role: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  previous_status: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  new_status: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  // Données additionnelles (JSON)
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  // IP de l'acteur
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true,
  },
}, {
  tableName: 'payment_logs',
  updatedAt: false, // logs immuables
  indexes: [
    { fields: ['payment_request_id'] },
    { fields: ['created_at'] },
    { fields: ['action'] },
  ],
});

module.exports = PaymentLog;
