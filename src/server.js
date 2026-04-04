require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const { sequelize } = require('./models');
const { startPaymentJobs } = require('./jobs/paymentExpiry');

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
initSocket(server);

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connexion PostgreSQL établie');

    await sequelize.sync({ alter: true });
    console.log('✅ Modèles synchronisés');

    // Ajouter les nouvelles valeurs ENUM si elles n'existent pas encore
    try {
      await sequelize.query(`ALTER TYPE "enum_notifications_type" ADD VALUE IF NOT EXISTS 'new_content'`);
    } catch { /* enum type may not exist yet or value already added */ }

    // Démarrer les jobs cron (expiration + escalade paiements)
    startPaymentJobs();

    server.listen(PORT, () => {
      console.log(`🚀 Serveur SoisRelax démarré sur le port ${PORT}`);
      console.log(`🌍 Environnement: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('❌ Erreur de démarrage:', error);
    process.exit(1);
  }
}

startServer();
