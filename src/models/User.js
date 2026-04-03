const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    validate: {
      len: [3, 50],
      is: /^[a-zA-Z0-9_]+$/,
    },
  },
  display_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true },
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
    // Format Congo: +242 xx xxx xxxx
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM('subscriber', 'creator', 'admin'),
    defaultValue: 'subscriber',
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  avatar_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  cover_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Prix abonnement mensuel en FCFA
  subscription_price: {
    type: DataTypes.INTEGER,
    defaultValue: 2500,
    validate: { min: 500 },
  },
  // Revenus totaux en FCFA
  total_earnings: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
  },
  // Solde disponible pour retrait
  balance: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
  },
  is_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  // Numéro Mobile Money pour les paiements sortants
  mobile_money_number: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  mobile_money_provider: {
    type: DataTypes.ENUM('mtn', 'airtel', 'orange'),
    allowNull: true,
  },
  refresh_token: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  last_seen: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  expo_push_token: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Stats
  followers_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  following_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  posts_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  tableName: 'users',
  hooks: {
    beforeCreate: async (user) => {
      if (user.password_hash) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password_hash')) {
        user.password_hash = await bcrypt.hash(user.password_hash, 12);
      }
    },
  },
});

User.prototype.validatePassword = async function (password) {
  return bcrypt.compare(password, this.password_hash);
};

User.prototype.toPublicJSON = function () {
  const { password_hash, refresh_token, mobile_money_number, ...data } = this.toJSON();
  return data;
};

module.exports = User;
