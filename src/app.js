const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Sécurité
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS — accepte le web prod + preview Vercel + mobile (no origin)
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL || 'http://localhost:3000',
  'http://localhost:3000',
  /\.vercel\.app$/,
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // mobile / curl
    const ok = ALLOWED_ORIGINS.some((o) =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    callback(null, ok);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Trop de requêtes. Veuillez réessayer dans 15 minutes.' },
});
app.use('/api/', limiter);

// Rate limiting strict pour auth (désactivé en développement)
if (process.env.NODE_ENV !== 'development') {
  const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Trop de tentatives de connexion. Réessayez dans 1 heure.' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
}

// Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logs
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Fichiers statiques (avatars locaux en dev)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes API
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'SoisRelax', version: '1.0.0' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

// Gestion des erreurs
app.use(errorHandler);

module.exports = app;
