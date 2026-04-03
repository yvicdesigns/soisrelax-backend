/**
 * Seed — Données de test SoisRelax
 * Exécuter : node src/seed.js
 */
require('dotenv').config();
const { sequelize, User } = require('./models');

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connexion PostgreSQL OK');

    await sequelize.sync({ alter: true });
    console.log('✅ Modèles synchronisés');

    // ─── Comptes à créer ────────────────────────────────────
    const accounts = [
      {
        username: 'admin',
        display_name: 'Admin SoisRelax',
        email: 'admin@soisrelax.cg',
        password_hash: 'Admin2024!',
        role: 'admin',
        is_verified: true,
        bio: 'Administrateur de la plateforme',
        mobile_money_provider: 'mtn',
        mobile_money_number: '+242060000000',
      },
      {
        username: 'createur_test',
        display_name: 'Sophie Makaya',
        email: 'createur@test.com',
        password_hash: 'Test1234!',
        role: 'creator',
        is_verified: true,
        bio: 'Créatrice de contenu lifestyle & beauté 🇨🇬',
        subscription_price: 2500,
        mobile_money_provider: 'mtn',
        mobile_money_number: '+242061234567',
      },
      {
        username: 'user_test',
        display_name: 'Jean Moukala',
        email: 'user@test.com',
        password_hash: 'Test1234!',
        role: 'subscriber',
        is_verified: false,
        bio: 'Abonné SoisRelax',
        mobile_money_provider: 'airtel',
        mobile_money_number: '+242051234567',
      },
    ];

    for (const account of accounts) {
      const existing = await User.findOne({ where: { email: account.email } });
      if (existing) {
        console.log(`⏭  Compte existant ignoré : ${account.email}`);
        continue;
      }
      await User.create(account);
      console.log(`✅ Créé : ${account.role.padEnd(10)} ${account.email}`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log('  Comptes de test disponibles :');
    console.log('═══════════════════════════════════════');
    console.log('  ADMIN');
    console.log('  Email    : admin@soisrelax.cg');
    console.log('  Mot de passe : Admin2024!');
    console.log('  Accès    : /admin/paiements');
    console.log('───────────────────────────────────────');
    console.log('  CRÉATEUR');
    console.log('  Email    : createur@test.com');
    console.log('  Mot de passe : Test1234!');
    console.log('  Accès    : /tableau-de-bord  /paiements');
    console.log('───────────────────────────────────────');
    console.log('  ABONNÉ');
    console.log('  Email    : user@test.com');
    console.log('  Mot de passe : Test1234!');
    console.log('  Accès    : /fil');
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur seed :', error.message || error);
    console.error(error.stack);
    process.exit(1);
  }
}

seed();
