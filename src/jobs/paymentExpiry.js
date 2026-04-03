/**
 * Job cron — Gestion automatique des paiements
 *
 * Tâches :
 *  - Expiration automatique des paiements non soumis après 30 min
 *  - Escalade créateur après 15 min sans validation (status: submitted)
 *  - Escalade admin après 25 min sans validation
 *  - Nettoyage des logs > 12 mois
 */
const cron = require('node-cron');
const { Op } = require('sequelize');
const { PaymentRequest, PaymentLog, Notification, User } = require('../models');
const { logAction, createNotification, EXPIRY_MINUTES,
  ESCALATION_CREATOR_MINUTES, ESCALATION_ADMIN_MINUTES } = require('../services/payment.service');

function startPaymentJobs() {
  // ─── Toutes les minutes : expiration et escalades ───
  cron.schedule('* * * * *', async () => {
    try {
      await expireStalePayments();
      await escalatePendingValidations();
    } catch (err) {
      console.error('[CRON] Erreur job paiements:', err.message);
    }
  });

  // ─── Chaque dimanche à 3h00 : nettoyage logs > 12 mois ───
  cron.schedule('0 3 * * 0', async () => {
    try {
      await cleanOldLogs();
    } catch (err) {
      console.error('[CRON] Erreur nettoyage logs:', err.message);
    }
  });

  console.log('✅ Jobs paiements démarrés (expiration + escalade)');
}

/**
 * Expire les paiements "pending" (sans preuve) dont le timer est dépassé.
 * Expire aussi les "submitted" dont le délai total est largement dépassé (60 min).
 */
async function expireStalePayments() {
  const now = new Date();

  // Expire les "pending" sans preuve après 30 min
  const expiredPending = await PaymentRequest.findAll({
    where: {
      status: 'pending',
      expires_at: { [Op.lt]: now },
    },
    attributes: ['id', 'user_id', 'reference_code'],
    limit: 100,
  });

  for (const pr of expiredPending) {
    await pr.update({ status: 'expired' });

    await logAction({
      paymentRequestId: pr.id,
      action: 'expired',
      performedBy: null,
      previousStatus: 'pending',
      newStatus: 'expired',
      metadata: { reason: 'no_proof_submitted', expired_at: now },
    });

    await createNotification({
      userId: pr.user_id,
      type: 'payment_expired',
      title: '⏱ Paiement expiré',
      body: `Votre demande (${pr.reference_code}) a expiré. Démarrez un nouveau paiement si nécessaire.`,
      data: { payment_request_id: pr.id },
      relatedId: pr.id,
    });
  }

  if (expiredPending.length > 0) {
    console.log(`[CRON] ${expiredPending.length} paiement(s) expiré(s)`);
  }
}

/**
 * Escalade si un paiement "submitted" attend trop longtemps.
 *
 * 15 min → notifier le créateur
 * 25 min → notifier l'admin
 * 30 min → expirer si toujours pas validé
 */
async function escalatePendingValidations() {
  const now = new Date();

  const submittedPayments = await PaymentRequest.findAll({
    where: {
      status: 'submitted',
    },
    include: [
      { model: User, as: 'creator', attributes: ['id', 'display_name'] },
      { model: User, as: 'user', attributes: ['id', 'display_name'] },
    ],
    limit: 200,
  });

  for (const pr of submittedPayments) {
    const ageMs = now - new Date(pr.updated_at);
    const ageMinutes = ageMs / 60000;

    // Expiration forcée à 30 min si toujours "submitted"
    if (ageMinutes >= EXPIRY_MINUTES) {
      await pr.update({ status: 'expired' });

      await logAction({
        paymentRequestId: pr.id,
        action: 'expired',
        performedBy: null,
        previousStatus: 'submitted',
        newStatus: 'expired',
        metadata: { reason: 'validation_timeout', age_minutes: Math.round(ageMinutes) },
      });

      await createNotification({
        userId: pr.user_id,
        type: 'payment_expired',
        title: '⏱ Paiement expiré — non validé',
        body: 'Votre paiement n\'a pas été validé à temps. Contactez le support ou recommencez.',
        data: { payment_request_id: pr.id, whatsapp: process.env.WHATSAPP_SUPPORT },
        relatedId: pr.id,
      });

      continue;
    }

    // Escalade créateur à 15 min
    if (ageMinutes >= ESCALATION_CREATOR_MINUTES && !pr.escalated_creator) {
      await pr.update({ escalated_creator: true });

      await logAction({
        paymentRequestId: pr.id,
        action: 'escalated_creator',
        performedBy: null,
        metadata: { age_minutes: Math.round(ageMinutes) },
      });

      await createNotification({
        userId: pr.creator_id,
        type: 'payment_pending_validation',
        title: '⚠️ Paiement en attente depuis 15 min',
        body: `Le paiement ${pr.reference_code} de ${parseFloat(pr.amount).toLocaleString('fr-FR')} FCFA attend votre validation urgente !`,
        data: { payment_request_id: pr.id, urgent: true },
        relatedId: pr.id,
      });

      console.log(`[CRON] Escalade créateur: ${pr.reference_code} (${Math.round(ageMinutes)} min)`);
    }

    // Escalade admin à 25 min
    if (ageMinutes >= ESCALATION_ADMIN_MINUTES && !pr.escalated_admin) {
      await pr.update({ escalated_admin: true });

      await logAction({
        paymentRequestId: pr.id,
        action: 'escalated_admin',
        performedBy: null,
        metadata: { age_minutes: Math.round(ageMinutes) },
      });

      const admins = await User.findAll({
        where: { role: 'admin', is_active: true },
        attributes: ['id'],
      });

      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          type: 'payment_escalated',
          title: '🚨 Intervention admin requise',
          body: `Le paiement ${pr.reference_code} attend validation depuis ${Math.round(ageMinutes)} min. Le créateur ${pr.creator?.display_name} n'a pas répondu.`,
          data: { payment_request_id: pr.id, creator_id: pr.creator_id, urgent: true },
          relatedId: pr.id,
        });
      }

      console.log(`[CRON] Escalade admin: ${pr.reference_code} (${Math.round(ageMinutes)} min)`);
    }
  }
}

/**
 * Supprime les logs de plus de 12 mois
 */
async function cleanOldLogs() {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  const deleted = await PaymentLog.destroy({
    where: { created_at: { [Op.lt]: cutoff } },
  });

  if (deleted > 0) {
    console.log(`[CRON] Nettoyage: ${deleted} logs supprimés (> 12 mois)`);
  }
}

module.exports = { startPaymentJobs };
