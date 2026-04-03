const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Comment = sequelize.define('Comment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: { type: DataTypes.UUID, allowNull: false },
  content_id: { type: DataTypes.UUID, allowNull: false },
  text: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { len: [1, 500] },
  },
  parent_id: {
    type: DataTypes.UUID,
    allowNull: true, // Pour les réponses aux commentaires
  },
}, {
  tableName: 'comments',
});

module.exports = Comment;
