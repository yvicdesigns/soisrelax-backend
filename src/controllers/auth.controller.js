const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { User } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');

function generateTokens(userId) {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '15m' }
  );
  const refreshToken = jwt.sign(
    { id: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
  );
  return { accessToken, refreshToken };
}

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { username, display_name, email, phone, password, role } = req.body;

  if (!username || !display_name || !email || !password) {
    return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }

  const allowedRoles = ['subscriber', 'creator'];
  const userRole = allowedRoles.includes(role) ? role : 'subscriber';

  const user = await User.create({
    username: username.toLowerCase().trim(),
    display_name: display_name.trim(),
    email: email.toLowerCase().trim(),
    phone: phone || null,
    password_hash: password,
    role: userRole,
  });

  const { accessToken, refreshToken } = generateTokens(user.id);
  await user.update({ refresh_token: refreshToken });

  res.status(201).json({
    message: 'Compte créé avec succès ! Bienvenue sur SoisRelax.',
    user: user.toPublicJSON(),
    accessToken,
    refreshToken,
  });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail et mot de passe requis.' });
  }

  const user = await User.findOne({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user || !(await user.validatePassword(password))) {
    return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Votre compte a été suspendu. Contactez le support.' });
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  await user.update({
    refresh_token: refreshToken,
    last_seen: new Date(),
  });

  res.json({
    message: 'Connexion réussie !',
    user: user.toPublicJSON(),
    accessToken,
    refreshToken,
  });
});

// POST /api/auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Token de rafraîchissement manquant.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token de rafraîchissement invalide ou expiré.' });
  }

  const user = await User.findByPk(decoded.id);
  if (!user || user.refresh_token !== refreshToken) {
    return res.status(401).json({ error: 'Session invalide. Reconnectez-vous.' });
  }

  const tokens = generateTokens(user.id);
  await user.update({ refresh_token: tokens.refreshToken });

  res.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      await User.update({ refresh_token: null }, { where: { id: decoded.id } });
    } catch { /* ignore */ }
  }
  res.json({ message: 'Déconnecté avec succès.' });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.user.id, {
    attributes: { exclude: ['password_hash', 'refresh_token'] },
  });
  res.json({ user });
});

module.exports = { register, login, refresh, logout, me };
