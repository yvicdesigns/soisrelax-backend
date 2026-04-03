function errorHandler(err, req, res, next) {
  console.error('Erreur:', err);

  // Erreurs Sequelize
  if (err.name === 'SequelizeUniqueConstraintError') {
    const field = err.errors[0]?.path;
    const messages = {
      email: 'Cette adresse e-mail est déjà utilisée.',
      username: 'Ce nom d\'utilisateur est déjà pris.',
      phone: 'Ce numéro de téléphone est déjà utilisé.',
    };
    return res.status(409).json({ error: messages[field] || 'Cette information est déjà utilisée.' });
  }

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Données invalides.',
      details: err.errors.map((e) => e.message),
    });
  }

  // Erreurs Multer
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Fichier trop volumineux.' });
  }

  if (err.message?.includes('Type de fichier non autorisé')) {
    return res.status(415).json({ error: err.message });
  }

  // Erreur générique
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    error: err.message || 'Une erreur interne s\'est produite.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, asyncHandler };
