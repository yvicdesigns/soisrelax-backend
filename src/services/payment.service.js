/**
 * Service de paiement manuel par Mobile Money
 * Contexte : Brazzaville, Congo — pas d'API automatisée disponible
 *
 * Flux : Initiation → Preuve → Validation manuelle → Accès accordé
 */
const crypto = require('crypto');
const { Op } = require('sequelize');
const { PaymentRequest, PaymentLog, Notification, User, Subscription, Content, sequelize } = require('../models');
const { notifyUser } = require('./push.service');

// ===== Comptes Mobile Money de la plateforme (depuis .env) =====
const PLATFORM_ACCOUNTS = {
  mtn_momo: {
    number: process.env.MTN_MOMO_NUMBER || '06X XXX XXX',
    name: process.env.MTN_MOMO_NAME || 'SoisRelax Congo',
    instructions: 'Effectuez un transfert MTN Mobile Money au numéro ci-dessus',
  },
  airtel_money: {
    number: process.env.AIRTEL_MONEY_NUMBER || '05X XXX XXX',
    name: process.env.AIRTEL_MONEY_NAME || 'SoisRelax Congo',
    instructions: 'Effectuez un transfert Airtel Money au numéro ci-dessus',
  },
};

const EXPIRY_MINUTES = 30;
const MAX_SUBMISSION_ATTEMPTS = 3;
const ESCALATION_CREATOR_MINUTES = 15;
const ESCALATION_ADMIN_MINUTES = 25;

/**
 * Génère un code de référence unique
 * Format : REF-XXXXXX-YYYYYY (ex: REF-483920-AB4X92)
 */
function generateReferenceCode() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `REF-${timestamp}-${random}`;
}

/**
 * Calcule le hash MD5 d'un buffer (pour anti-fraude doublon de preuve)
 */
function computeFileHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Crée une demande de paiement et génère les instructions
 */
async function createPaymentRequest({
  userId,
  creatorId,
  contentId = null,
  amount,
  paymentType,
  paymentMethod,
  months = 1,
}) {
  // Vérifier qu'une demande pending n'existe pas déjà pour cette paire
  const existing = await PaymentRequest.findOne({
    where: {
      user_id: userId,
      creator_id: creatorId,
      payment_type: paymentType,
      ...(contentId && { content_id: contentId }),
      status: { [Op.in]: ['pending', 'submitted'] },
      expires_at: { [Op.gt]: new Date() },
    },
  });

  if (existing) {
    return {
      existing: true,
      paymentRequest: existing,
      instructions: buildInstructions(existing),
    };
  }

  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);
  let referenceCode;

  // Garantir l'unicité du code (retry si collision)
  let attempts = 0;
  while (attempts < 5) {
    referenceCode = generateReferenceCode();
    const collision = await PaymentRequest.findOne({ where: { reference_code: referenceCode } });
    if (!collision) break;
    attempts++;
  }

  const paymentRequest = await PaymentRequest.create({
    user_id: userId,
    creator_id: creatorId,
    content_id: contentId,
    amount,
    payment_type: paymentType,
    payment_method: paymentMethod,
    reference_code: referenceCode,
    expires_at: expiresAt,
    months,
  });

  await logAction({
    paymentRequestId: paymentRequest.id,
    action: 'created',
    performedBy: null,
    previousStatus: null,
    newStatus: 'pending',
    metadata: { amount, paymentType, paymentMethod, userId, creatorId },
  });

  return {
    existing: false,
    paymentRequest,
    instructions: buildInstructions(paymentRequest),
  };
}

/**
 * Construit les instructions d'affichage pour l'utilisateur
 */
function buildInstructions(paymentRequest) {
  const account = PLATFORM_ACCOUNTS[paymentRequest.payment_method];
  const expiresAt = new Date(paymentRequest.expires_at);
  const remainingMs = expiresAt - Date.now();
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60000));

  return {
    account_number: account.number,
    account_name: account.name,
    amount: parseFloat(paymentRequest.amount),
    currency: paymentRequest.currency,
    reference_code: paymentRequest.reference_code,
    payment_method: paymentRequest.payment_method,
    expires_at: expiresAt,
    remaining_minutes: remainingMin,
    instructions: account.instructions,
    whatsapp_support: process.env.WHATSAPP_SUPPORT || '+242060000000',
  };
}

/**
 * Soumettre une preuve de paiement
 * @param {string} paymentRequestId
 * @param {string} userId
 * @param {Object} proof - { imageBuffer, imageMimetype, imageKey, imageUrl, transactionId }
 * @param {string} ipAddress
 */
async function submitProof({ paymentRequestId, userId, proof, ipAddress }) {
  const paymentRequest = await PaymentRequest.findByPk(paymentRequestId);

  if (!paymentRequest) {
    throw Object.assign(new Error('Demande de paiement introuvable.'), { statusCode: 404 });
  }

  if (paymentRequest.user_id !== userId) {
    throw Object.assign(new Error('Non autorisé.'), { statusCode: 403 });
  }

  if (paymentRequest.status === 'expired' || new Date() > paymentRequest.expires_at) {
    await paymentRequest.update({ status: 'expired' });
    throw Object.assign(new Error('Ce paiement a expiré. Veuillez recommencer.'), { statusCode: 410 });
  }

  if (paymentRequest.status === 'approved') {
    throw Object.assign(new Error('Ce paiement a déjà été approuvé.'), { statusCode: 409 });
  }

  if (paymentRequest.status === 'rejected') {
    if (paymentRequest.submission_attempts >= MAX_SUBMISSION_ATTEMPTS) {
      await logAction({
        paymentRequestId,
        action: 'max_attempts_reached',
        performedBy: userId,
        previousStatus: paymentRequest.status,
        newStatus: paymentRequest.status,
        metadata: { attempts: paymentRequest.submission_attempts },
        ipAddress,
      });
      throw Object.assign(
        new Error(`Nombre maximum de tentatives atteint (${MAX_SUBMISSION_ATTEMPTS}). Contactez le support.`),
        { statusCode: 429 }
      );
    }
  }

  // Vérification anti-doublon par hash MD5
  if (proof.imageBuffer) {
    const hash = computeFileHash(proof.imageBuffer);

    const duplicateProof = await PaymentRequest.findOne({
      where: {
        proof_hash: hash,
        id: { [Op.ne]: paymentRequestId },
      },
    });

    if (duplicateProof) {
      await logAction({
        paymentRequestId,
        action: 'duplicate_proof_blocked',
        performedBy: userId,
        previousStatus: paymentRequest.status,
        newStatus: paymentRequest.status,
        metadata: { hash, duplicate_request_id: duplicateProof.id },
        ipAddress,
      });

      // Incrémenter le compteur de tentatives frauduleuses sur l'utilisateur
      await checkAndFlagFraud(userId, paymentRequestId, ipAddress);

      throw Object.assign(
        new Error('Cette capture d\'écran a déjà été utilisée. Envoyez la vraie preuve de votre transfert.'),
        { statusCode: 422 }
      );
    }

    await paymentRequest.update({
      proof_image_url: proof.imageUrl,
      proof_image_key: proof.imageKey,
      proof_hash: hash,
      status: 'submitted',
      submission_attempts: paymentRequest.submission_attempts + 1,
    });
  } else if (proof.transactionId) {
    await paymentRequest.update({
      transaction_id: proof.transactionId.trim(),
      status: 'submitted',
      submission_attempts: paymentRequest.submission_attempts + 1,
    });
  } else {
    throw Object.assign(new Error('Fournissez une capture d\'écran ou un identifiant de transaction.'), { statusCode: 400 });
  }

  await logAction({
    paymentRequestId,
    action: paymentRequest.submission_attempts > 0 ? 'resubmitted' : 'proof_submitted',
    performedBy: userId,
    previousStatus: paymentRequest.status,
    newStatus: 'submitted',
    metadata: {
      has_image: !!proof.imageBuffer,
      has_transaction_id: !!proof.transactionId,
      attempt_number: paymentRequest.submission_attempts + 1,
    },
    ipAddress,
  });

  // Notifier le créateur
  await createNotification({
    userId: paymentRequest.creator_id,
    type: 'payment_pending_validation',
    title: '💰 Nouveau paiement à valider',
    body: `Un paiement de ${parseFloat(paymentRequest.amount).toLocaleString('fr-FR')} FCFA attend votre validation (Réf: ${paymentRequest.reference_code})`,
    data: { payment_request_id: paymentRequestId, type: 'validation' },
    relatedId: paymentRequestId,
  });

  return { message: 'Preuve soumise avec succès. En attente de validation (15-30 min).' };
}

/**
 * Approuver un paiement (créateur ou admin)
 */
async function approvePayment({ paymentRequestId, validatedBy, validatorRole, ipAddress }) {
  const transaction = await sequelize.transaction();

  try {
    const pr = await PaymentRequest.findByPk(paymentRequestId, { transaction, lock: true });

    if (!pr) throw Object.assign(new Error('Demande introuvable.'), { statusCode: 404 });

    // Empêcher la double validation
    if (pr.status !== 'submitted') {
      throw Object.assign(
        new Error(`Ce paiement ne peut pas être approuvé (statut actuel: ${pr.status}).`),
        { statusCode: 409 }
      );
    }

    if (pr.expires_at < new Date()) {
      await pr.update({ status: 'expired' }, { transaction });
      throw Object.assign(new Error('Ce paiement a expiré.'), { statusCode: 410 });
    }

    const previousStatus = pr.status;

    await pr.update({
      status: 'approved',
      validated_by: validatedBy,
      validated_at: new Date(),
    }, { transaction });

    // Traiter selon le type
    if (pr.payment_type === 'subscription') {
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + pr.months);

      const sub = await Subscription.create({
        subscriber_id: pr.user_id,
        creator_id: pr.creator_id,
        amount: parseFloat(pr.amount),
        status: 'active',
        expires_at: expiresAt,
      }, { transaction });

      await pr.update({ subscription_id: sub.id }, { transaction });
    }

    // Créditer le créateur (80%)
    await User.increment('balance', {
      by: parseFloat(pr.creator_amount),
      where: { id: pr.creator_id },
      transaction,
    });
    await User.increment('total_earnings', {
      by: parseFloat(pr.creator_amount),
      where: { id: pr.creator_id },
      transaction,
    });

    await transaction.commit();

    await logAction({
      paymentRequestId,
      action: 'approved',
      performedBy: validatedBy,
      performedByRole: validatorRole,
      previousStatus,
      newStatus: 'approved',
      metadata: { creator_amount: pr.creator_amount, platform_fee: pr.platform_fee },
      ipAddress,
    });

    // Notifier l'utilisateur (in-app)
    await createNotification({
      userId: pr.user_id,
      type: 'payment_approved',
      title: '✅ Paiement confirmé !',
      body: pr.payment_type === 'subscription'
        ? `Votre abonnement est maintenant actif. Profitez du contenu exclusif !`
        : `Votre paiement de ${parseFloat(pr.amount).toLocaleString('fr-FR')} FCFA a été confirmé. Accès accordé.`,
      data: { payment_request_id: paymentRequestId, type: pr.payment_type },
      relatedId: paymentRequestId,
    });

    // Notifier le créateur (nouvel abonné ou achat)
    if (pr.payment_type === 'subscription') {
      try {
        const [buyer, creator] = await Promise.all([
          User.findByPk(pr.user_id, { attributes: ['display_name', 'username'] }),
          User.findByPk(pr.creator_id, { attributes: ['expo_push_token'] }),
        ]);
        await notifyUser(
          creator?.expo_push_token,
          'Nouvel abonné !',
          `${buyer?.display_name || buyer?.username} vient de s'abonner à votre compte.`,
          { type: 'new_subscriber' }
        );
      } catch { }
    }

    return { message: 'Paiement approuvé. Accès accordé à l\'utilisateur.' };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * Rejeter un paiement (créateur ou admin)
 */
async function rejectPayment({ paymentRequestId, validatedBy, validatorRole, rejectionReason, ipAddress }) {
  if (!rejectionReason?.trim()) {
    throw Object.assign(new Error('Le motif de rejet est obligatoire.'), { statusCode: 400 });
  }

  const pr = await PaymentRequest.findByPk(paymentRequestId);
  if (!pr) throw Object.assign(new Error('Demande introuvable.'), { statusCode: 404 });

  if (pr.status !== 'submitted') {
    throw Object.assign(
      new Error(`Ce paiement ne peut pas être rejeté (statut actuel: ${pr.status}).`),
      { statusCode: 409 }
    );
  }

  const previousStatus = pr.status;

  await pr.update({
    status: 'rejected',
    validated_by: validatedBy,
    validated_at: new Date(),
    rejection_reason: rejectionReason.trim(),
    // Libérer le hash pour permettre re-soumission avec nouvelle preuve
    proof_hash: null,
  });

  await logAction({
    paymentRequestId,
    action: 'rejected',
    performedBy: validatedBy,
    performedByRole: validatorRole,
    previousStatus,
    newStatus: 'rejected',
    metadata: { reason: rejectionReason },
    ipAddress,
  });

  // Notifier l'utilisateur avec le motif
  await createNotification({
    userId: pr.user_id,
    type: 'payment_rejected',
    title: '❌ Paiement non confirmé',
    body: `Raison : ${rejectionReason}. Vous pouvez re-soumettre une preuve valide.`,
    data: {
      payment_request_id: paymentRequestId,
      rejection_reason: rejectionReason,
      can_resubmit: pr.submission_attempts < MAX_SUBMISSION_ATTEMPTS,
    },
    relatedId: paymentRequestId,
  });

  return { message: 'Paiement rejeté. L\'utilisateur a été notifié.' };
}

/**
 * Générer une URL signée Supabase pour visualiser une preuve (accès privé)
 */
async function getProofSignedUrl(key) {
  if (!key) return null;
  try {
    const { getSignedUrl } = require('../config/storage');
    return await getSignedUrl('proofs', key, 900); // 15 minutes
  } catch {
    return null;
  }
}

/**
 * Vérifier et bannir un utilisateur frauduleux
 */
async function checkAndFlagFraud(userId, paymentRequestId, ipAddress) {
  // Compter les tentatives de fraude récentes (7 derniers jours)
  const recentFraud = await PaymentLog.count({
    where: {
      action: 'duplicate_proof_blocked',
      performed_by: userId,
      created_at: { [Op.gte]: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
    },
  });

  await logAction({
    paymentRequestId,
    action: 'fraud_flagged',
    performedBy: userId,
    metadata: { fraud_count: recentFraud + 1, ip_address: ipAddress },
    ipAddress,
  });

  // Bannissement automatique après 2 tentatives confirmées
  if (recentFraud >= 1) {
    await User.update(
      { is_active: false },
      { where: { id: userId } }
    );
    // Notifier l'admin
    const admins = await User.findAll({ where: { role: 'admin', is_active: true }, attributes: ['id'] });
    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        type: 'payment_pending_validation',
        title: '🚨 Tentative de fraude détectée',
        body: `L'utilisateur ${userId} a soumis ${recentFraud + 1} preuves dupliquées. Compte suspendu automatiquement.`,
        data: { fraud_user_id: userId, payment_request_id: paymentRequestId },
        relatedId: paymentRequestId,
      });
    }
  }
}

/**
 * Enregistrer une action dans payment_logs
 */
async function logAction({
  paymentRequestId,
  action,
  performedBy = null,
  performedByRole = null,
  previousStatus = null,
  newStatus = null,
  metadata = null,
  ipAddress = null,
}) {
  try {
    await PaymentLog.create({
      payment_request_id: paymentRequestId,
      action,
      performed_by: performedBy,
      performed_by_role: performedByRole,
      previous_status: previousStatus,
      new_status: newStatus,
      metadata,
      ip_address: ipAddress,
    });
  } catch (err) {
    console.error('Erreur log paiement:', err.message);
  }
}

/**
 * Créer une notification et la pousser via socket.io
 */
async function createNotification({ userId, type, title, body, data, relatedId }) {
  try {
    const notif = await Notification.create({
      user_id: userId,
      type,
      title,
      body,
      data,
      related_id: relatedId,
    });

    // Pousser en temps réel via socket.io
    try {
      const { getIo } = require('../config/socket');
      getIo().to(`user:${userId}`).emit('notification', {
        id: notif.id,
        type,
        title,
        body,
        data,
        created_at: notif.created_at,
      });
    } catch { /* socket optionnel */ }

    return notif;
  } catch (err) {
    console.error('Erreur notification:', err.message);
  }
}

module.exports = {
  createPaymentRequest,
  buildInstructions,
  submitProof,
  approvePayment,
  rejectPayment,
  getProofSignedUrl,
  logAction,
  createNotification,
  computeFileHash,
  PLATFORM_ACCOUNTS,
  EXPIRY_MINUTES,
  MAX_SUBMISSION_ATTEMPTS,
  ESCALATION_CREATOR_MINUTES,
  ESCALATION_ADMIN_MINUTES,
};
