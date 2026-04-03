const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Content = sequelize.define('Content', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  creator_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  content_type: {
    type: DataTypes.ENUM('image', 'video', 'text', 'gallery'),
    allowNull: false,
    defaultValue: 'image',
  },
  // URL principale (S3)
  file_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Clé S3 pour suppression
  file_key: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Miniature basse résolution (prévisualisation)
  thumbnail_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Preview floutée pour contenu payant
  preview_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Galerie multiple (JSON array d'URLs)
  gallery_urls: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: [],
  },
  // Accès
  is_free: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  // Contenu exclusif payant à l'unité
  is_ppv: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  ppv_price: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: { min: 0 },
  },
  is_published: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  // Stats
  views_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  likes_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  comments_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  // Durée vidéo en secondes
  duration: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Taille fichier en bytes
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
}, {
  tableName: 'contents',
});

module.exports = Content;
