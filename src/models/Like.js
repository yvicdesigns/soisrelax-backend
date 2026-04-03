const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Like = sequelize.define('Like', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: { type: DataTypes.UUID, allowNull: false },
  content_id: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: 'likes',
  indexes: [{ unique: true, fields: ['user_id', 'content_id'] }],
});

module.exports = Like;
