const { Op } = require('sequelize');
const multer = require('multer');
const { PaymentRequest, PaymentLog, Notification, User, Content, Subscription, sequelize } = require('../models');
const paymentService = require('../services/payment.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { getProofSignedUrl } = require('../services/payment.service');

// Upload proof en mémoire (pour calcul MD5 avant envoi S3)
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format non supporté. Utilisez JPG ou PNG.'));
    }
  },
});

// ────────────────────────────────────────────────────────────────
// ÉTAPE 1 — Initier un paiement (générer référence + instructions)
// ────────────────────────────────────────────────────────────────

// POST /api/payments/initiate
const initiatePayment = asyncHandler(async (req, res) => {
  const { creator_id, payment_type, payment_method, months = 1, content_id } = req.body;
  const userId = req.user.id;

  if (!creator_id || !payment_type || !payment_method) {
    return res.status(400).json({ error: 'Données manquantes : créateur, type et méthode requis.' });
  }

  if (!['mtn_momo', 'airtel_money'].includes(payment_method)) {
    return res.status(400).json({ error: 'Méthode de paiement invalide.' });
  }

  if (userId === creator_id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas vous payer vous-même.' });
  }

  const creator = await User.findByPk(creator_id, {
    attributes: ['id', 'display_name', 'subscription_price', 'role'],
  });
  if (!creator || creator.role !== 'creator') {
    return res.status(404).json({ error: 'Créateur introuvable.' });
  }

  let amount;
  if (payment_type === 'subscription') {
    amount = creator.subscription_price * parseInt(months);
  } else if (payment_type === 'ppv') {
    if (!content_id) return res.status(400).json({ error: 'Contenu requis pour un achat PPV.' });
    const content = await Content.findByPk(content_id);
    if (!content || !content.is_ppv) return res.status(404).json({ error: 'Contenu introuvable ou non disponible à l\'achat.' });
    amount = content.ppv_price;
  } else if (payment_type === 'tip') {
    const { tip_amount } = req.body;
    if (!tip_amount || tip_amount < 500) return res.status(400).json({ error: 'Montant minimum du pourboire: 500 FCFA' });
    amount = parseInt(tip_amount);
  } else {
    return res.status(400).json({ error: 'Type de paiement invalide.' });
  }

  const { existing, paymentRequest, instructions } = await paymentService.createPaymentRequest({
    userId,
    creatorId: creator_id,
    contentId: content_id || null,
    amount,
    paymentType: payment_type,
    paymentMethod: payment_method,
    months: parseInt(months),
  });

  res.status(existing ? 200 : 201).json({
    message: existing
      ? 'Une demande de paiement en cours existe déjà.'
      : 'Instructions de paiement générées. Effectuez le transfert.',
    payment_request_id: paymentRequest.id,
    instructions,
    is_existing: existing,
  });
});

// ────────────────────────────────────────────────────────────────
// ÉTAPE 2 — Soumettre la preuve de paiement
// ────────────────────────────────────────────────────────────────

// POST /api/payments/:id/proof
const submitProof = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { transaction_id } = req.body;
  const userId = req.user.id;
  const ipAddress = req.ip || req.connection?.remoteAddress;

  let proof = {};

  if (req.file) {
    // Upload vers Supabase Storage (bucket privé "proofs")
    const { uploadToSupabase } = require('../config/storage');
    const { key } = await uploadToSupabase(req.file.buffer, 'proofs', 'proofs', req.file.mimetype);

    proof = {
      imageBuffer: req.file.buffer,
      imageKey: key,
      imageUrl: key,
    };
  } else if (transaction_id) {
    proof = { transactionId: transaction_id };
  } else {
    return res.status(400).json({
      error: 'Envoyez une capture d\'écran ou saisissez l\'identifiant de votre transaction.'
    });
  }

  const result = await paymentService.submitProof({
    paymentRequestId: id,
    userId,
    proof,
    ipAddress,
  });

  res.json(result);
});

// ────────────────────────────────────────────────────────────────
// ÉTAPE 4A — Approuver (créateur ou admin)
// ────────────────────────────────────────────────────────────────

// POST /api/payments/:id/approve
const approvePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const validator = req.user;

  // Vérifier les droits : admin accès total, créateur accès à ses paiements
  const pr = await PaymentRequest.findByPk(id);
  if (!pr) return res.status(404).json({ error: 'Demande introuvable.' });

  if (validator.role !== 'admin' && pr.creator_id !== validator.id) {
    return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à valider ce paiement.' });
  }

  const result = await paymentService.approvePayment({
    paymentRequestId: id,
    validatedBy: validator.id,
    validatorRole: validator.role,
    ipAddress: req.ip,
  });

  // Notifier via socket.io en temps réel
  try {
    const { getIo } = require('../config/socket');
    getIo().to(`user:${pr.user_id}`).emit('payment_approved', { payment_request_id: id });
  } catch { }

  res.json(result);
});

// ────────────────────────────────────────────────────────────────
// ÉTAPE 4B — Rejeter (créateur ou admin)
// ────────────────────────────────────────────────────────────────

// POST /api/payments/:id/reject
const rejectPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body;
  const validator = req.user;

  const pr = await PaymentRequest.findByPk(id);
  if (!pr) return res.status(404).json({ error: 'Demande introuvable.' });

  if (validator.role !== 'admin' && pr.creator_id !== validator.id) {
    return res.status(403).json({ error: 'Non autorisé.' });
  }

  const result = await paymentService.rejectPayment({
    paymentRequestId: id,
    validatedBy: validator.id,
    validatorRole: validator.role,
    rejectionReason: rejection_reason,
    ipAddress: req.ip,
  });

  try {
    const { getIo } = require('../config/socket');
    getIo().to(`user:${pr.user_id}`).emit('payment_rejected', {
      payment_request_id: id,
      rejection_reason,
    });
  } catch { }

  res.json(result);
});

// ────────────────────────────────────────────────────────────────
// GET — Statut d'une demande de paiement (polling)
// ────────────────────────────────────────────────────────────────

// GET /api/payments/:id/status
const getPaymentStatus = asyncHandler(async (req, res) => {
  const pr = await PaymentRequest.findByPk(req.params.id, {
    attributes: ['id', 'status', 'reference_code', 'amount', 'payment_type',
      'rejection_reason', 'expires_at', 'submission_attempts', 'created_at'],
  });

  if (!pr || pr.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }

  // Auto-expire à la lecture
  if (pr.status === 'pending' && new Date() > pr.expires_at) {
    await pr.update({ status: 'expired' });
    await paymentService.logAction({
      paymentRequestId: pr.id,
      action: 'expired',
      previousStatus: 'pending',
      newStatus: 'expired',
    });
  }

  res.json({
    status: pr.status,
    reference_code: pr.reference_code,
    amount: pr.amount,
    payment_type: pr.payment_type,
    rejection_reason: pr.rejection_reason,
    expires_at: pr.expires_at,
    submission_attempts: pr.submission_attempts,
    remaining_attempts: paymentService.MAX_SUBMISSION_ATTEMPTS - pr.submission_attempts,
    can_resubmit: pr.status === 'rejected' && pr.submission_attempts < paymentService.MAX_SUBMISSION_ATTEMPTS,
  });
});

// ────────────────────────────────────────────────────────────────
// CRÉATEUR — Liste des paiements à valider
// ────────────────────────────────────────────────────────────────

// GET /api/payments/creator/pending
const getCreatorPendingPayments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status = 'submitted', date_from, date_to } = req.query;
  const creatorId = req.user.id;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = { creator_id: creatorId };
  if (status !== 'all') where.status = status;
  if (date_from || date_to) {
    where.created_at = {};
    if (date_from) where.created_at[Op.gte] = new Date(date_from);
    if (date_to) where.created_at[Op.lte] = new Date(date_to);
  }

  const { rows, count } = await PaymentRequest.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'username', 'display_name', 'avatar_url', 'phone'],
      },
      {
        model: Content,
        as: 'content',
        attributes: ['id', 'title', 'content_type'],
        required: false,
      },
    ],
    limit: parseInt(limit),
    offset,
    order: [['created_at', 'ASC']], // FIFO
  });

  // Générer les URLs signées pour les preuves
  const payments = await Promise.all(rows.map(async (pr) => {
    const json = pr.toJSON();
    if (json.proof_image_key) {
      json.proof_signed_url = await getProofSignedUrl(json.proof_image_key);
    }
    return json;
  }));

  // Compte des "submitted" pour le badge
  const pendingCount = await PaymentRequest.count({
    where: { creator_id: creatorId, status: 'submitted' },
  });

  res.json({
    payments,
    total: count,
    page: parseInt(page),
    totalPages: Math.ceil(count / parseInt(limit)),
    pending_count: pendingCount,
  });
});

// ────────────────────────────────────────────────────────────────
// ADMIN — Tableau de bord global
// ────────────────────────────────────────────────────────────────

// GET /api/payments/admin/dashboard
const getAdminDashboard = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalSubmitted,
    approvedToday,
    rejectedToday,
    totalAmountToday,
    totalAmountAllTime,
    recentPayments,
  ] = await Promise.all([
    PaymentRequest.count({ where: { status: 'submitted' } }),
    PaymentRequest.count({ where: { status: 'approved', validated_at: { [Op.gte]: today } } }),
    PaymentRequest.count({ where: { status: 'rejected', validated_at: { [Op.gte]: today } } }),
    PaymentRequest.sum('amount', { where: { status: 'approved', validated_at: { [Op.gte]: today } } }),
    PaymentRequest.sum('amount', { where: { status: 'approved' } }),
    PaymentRequest.findAll({
      where: { status: 'submitted' },
      include: [
        { model: User, as: 'user', attributes: ['id', 'username', 'display_name', 'avatar_url'] },
        { model: User, as: 'creator', attributes: ['id', 'username', 'display_name'] },
        { model: Content, as: 'content', attributes: ['id', 'title'], required: false },
      ],
      order: [['created_at', 'ASC']],
      limit: 50,
    }),
  ]);

  const totalProcessed = approvedToday + rejectedToday;
  const rejectionRate = totalProcessed > 0 ? Math.round((rejectedToday / totalProcessed) * 100) : 0;

  const payments = await Promise.all(recentPayments.map(async (pr) => {
    const json = pr.toJSON();
    if (json.proof_image_key) {
      json.proof_signed_url = await getProofSignedUrl(json.proof_image_key);
    }
    // Minutes depuis la soumission
    json.waiting_minutes = Math.floor((Date.now() - new Date(pr.created_at)) / 60000);
    return json;
  }));

  res.json({
    kpis: {
      pending_validation: totalSubmitted,
      approved_today: approvedToday,
      rejected_today: rejectedToday,
      amount_today: parseFloat(totalAmountToday || 0),
      amount_total: parseFloat(totalAmountAllTime || 0),
      rejection_rate: rejectionRate,
    },
    pending_payments: payments,
  });
});

// GET /api/payments/admin/list (filtres avancés)
const getAdminPaymentList = asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 50,
    status, creator_id, payment_method,
    date_from, date_to, search,
  } = req.query;

  const where = {};
  if (status && status !== 'all') where.status = status;
  if (creator_id) where.creator_id = creator_id;
  if (payment_method) where.payment_method = payment_method;

  if (date_from || date_to) {
    where.created_at = {};
    if (date_from) where.created_at[Op.gte] = new Date(date_from);
    if (date_to) where.created_at[Op.lte] = new Date(date_to + 'T23:59:59');
  }

  const { rows, count } = await PaymentRequest.findAndCountAll({
    where,
    include: [
      { model: User, as: 'user', attributes: ['id', 'username', 'display_name'] },
      { model: User, as: 'creator', attributes: ['id', 'username', 'display_name'] },
      { model: User, as: 'validator', attributes: ['id', 'username', 'display_name'], required: false },
    ],
    limit: parseInt(limit),
    offset: (parseInt(page) - 1) * parseInt(limit),
    order: [['created_at', 'DESC']],
  });

  res.json({
    payments: rows,
    total: count,
    page: parseInt(page),
    totalPages: Math.ceil(count / parseInt(limit)),
  });
});

// GET /api/payments/admin/export.csv
const exportPaymentsCsv = asyncHandler(async (req, res) => {
  const { date_from, date_to, status } = req.query;

  const where = {};
  if (status && status !== 'all') where.status = status;
  if (date_from || date_to) {
    where.created_at = {};
    if (date_from) where.created_at[Op.gte] = new Date(date_from);
    if (date_to) where.created_at[Op.lte] = new Date(date_to + 'T23:59:59');
  }

  const payments = await PaymentRequest.findAll({
    where,
    include: [
      { model: User, as: 'user', attributes: ['username', 'email', 'phone'] },
      { model: User, as: 'creator', attributes: ['username', 'display_name'] },
      { model: User, as: 'validator', attributes: ['username'], required: false },
    ],
    order: [['created_at', 'DESC']],
  });

  const headers = [
    'Référence', 'Date', 'Utilisateur', 'Email', 'Téléphone',
    'Créateur', 'Type', 'Méthode', 'Montant (FCFA)', 'Montant Créateur',
    'Commission', 'Statut', 'ID Transaction', 'Validé par', 'Date validation', 'Motif rejet'
  ].join(',');

  const rows = payments.map((p) => [
    p.reference_code,
    new Date(p.created_at).toLocaleString('fr-FR'),
    p.user?.username || '',
    p.user?.email || '',
    p.user?.phone || '',
    p.creator?.display_name || '',
    p.payment_type,
    p.payment_method,
    parseFloat(p.amount),
    parseFloat(p.creator_amount),
    parseFloat(p.platform_fee),
    p.status,
    p.transaction_id || '',
    p.validator?.username || '',
    p.validated_at ? new Date(p.validated_at).toLocaleString('fr-FR') : '',
    (p.rejection_reason || '').replace(/,/g, ';'),
  ].join(','));

  const csv = [headers, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="soisrelax-paiements-${Date.now()}.csv"`);
  res.send('\uFEFF' + csv); // BOM UTF-8 pour Excel
});

// GET /api/payments/:id/detail (vue validateur avec checklist)
const getPaymentDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const validator = req.user;

  const pr = await PaymentRequest.findByPk(id, {
    include: [
      { model: User, as: 'user', attributes: ['id', 'username', 'display_name', 'avatar_url', 'phone', 'email'] },
      { model: User, as: 'creator', attributes: ['id', 'username', 'display_name'] },
      { model: Content, as: 'content', attributes: ['id', 'title', 'ppv_price'], required: false },
      {
        model: PaymentLog,
        as: 'logs',
        include: [{ model: User, as: 'actor', attributes: ['username', 'role'], required: false }],
        order: [['created_at', 'ASC']],
        limit: 20,
      },
    ],
  });

  if (!pr) return res.status(404).json({ error: 'Demande introuvable.' });

  if (validator.role !== 'admin' && pr.creator_id !== validator.id) {
    return res.status(403).json({ error: 'Non autorisé.' });
  }

  const json = pr.toJSON();
  if (json.proof_image_key) {
    json.proof_signed_url = await getProofSignedUrl(json.proof_image_key);
  }

  // Checklist de vérification pour le validateur
  const waitingMinutes = Math.floor((Date.now() - new Date(pr.created_at)) / 60000);
  json.waiting_minutes = waitingMinutes;
  json.checklist = [
    { id: 1, label: `Le montant correspond (${parseFloat(pr.amount).toLocaleString('fr-FR')} FCFA)` },
    { id: 2, label: `Le numéro destinataire est le bon (${paymentService.PLATFORM_ACCOUNTS[pr.payment_method]?.number || '—'})` },
    { id: 3, label: 'La date du transfert est dans la fenêtre valide (moins de 30 min)' },
    { id: 4, label: `Le code de référence est visible (${pr.reference_code}) ou l'ID transaction correspond` },
  ];

  res.json({ payment: json });
});

// GET /api/payments/notifications
const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.findAll({
    where: { user_id: req.user.id },
    order: [['created_at', 'DESC']],
    limit: 30,
  });

  const unreadCount = await Notification.count({
    where: { user_id: req.user.id, is_read: false },
  });

  res.json({ notifications, unread_count: unreadCount });
});

// PATCH /api/payments/notifications/read
const markNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.update(
    { is_read: true, read_at: new Date() },
    { where: { user_id: req.user.id, is_read: false } }
  );
  res.json({ message: 'Notifications marquées comme lues.' });
});

// GET /api/payments/my-subscriptions
const getMySubscriptions = asyncHandler(async (req, res) => {
  const subscriptions = await Subscription.findAll({
    where: { subscriber_id: req.user.id, status: 'active' },
    include: [{
      model: User,
      as: 'creator',
      attributes: ['id', 'username', 'display_name', 'avatar_url', 'bio', 'subscription_price', 'is_verified'],
    }],
    order: [['expires_at', 'ASC']],
  });

  res.json({ subscriptions });
});

module.exports = {
  proofUpload,
  initiatePayment,
  submitProof,
  approvePayment,
  rejectPayment,
  getPaymentStatus,
  getCreatorPendingPayments,
  getAdminDashboard,
  getAdminPaymentList,
  exportPaymentsCsv,
  getPaymentDetail,
  getNotifications,
  markNotificationsRead,
  getMySubscriptions,
};
