const jwt = require('jsonwebtoken');
const { User } = require('../models');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Accès non autorisé. Veuillez vous connecter.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password_hash', 'refresh_token'] },
    });

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Compte introuvable ou désactivé.' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Vous n\'avez pas les droits nécessaires.' });
    }
    next();
  };
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    User.findByPk(decoded.id).then((user) => {
      req.user = user;
      next();
    });
  } catch {
    next();
  }
}

module.exports = { authenticate, requireRole, optionalAuth };
