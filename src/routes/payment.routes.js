const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/payment.controller');
const { authenticate, requireRole } = require('../middleware/auth');

// Rate limiting strict sur la soumission de preuve (anti-fraude)
const proofRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Trop de tentatives. Attendez 1 heure avant de re-soumettre.' },
});

// Rate limiting sur l'initiation de paiement
const initiateRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Trop de demandes de paiement. Attendez quelques minutes.' },
});

// ===== Utilisateur =====
router.post('/initiate', authenticate, initiateRateLimit, ctrl.initiatePayment);
router.post('/:id/proof', authenticate, proofRateLimit, ctrl.proofUpload.single('proof_image'), ctrl.submitProof);
router.get('/:id/status', authenticate, ctrl.getPaymentStatus);

// ===== Notifications =====
router.get('/notifications', authenticate, ctrl.getNotifications);
router.patch('/notifications/read', authenticate, ctrl.markNotificationsRead);

// ===== Abonnements de l'utilisateur =====
router.get('/my-subscriptions', authenticate, ctrl.getMySubscriptions);

// ===== Créateur — Validation de ses paiements =====
router.get('/creator/pending', authenticate, requireRole('creator', 'admin'), ctrl.getCreatorPendingPayments);
router.get('/:id/detail', authenticate, requireRole('creator', 'admin'), ctrl.getPaymentDetail);
router.post('/:id/approve', authenticate, requireRole('creator', 'admin'), ctrl.approvePayment);
router.post('/:id/reject', authenticate, requireRole('creator', 'admin'), ctrl.rejectPayment);

// ===== Retraits créateur =====
router.post('/withdraw', authenticate, requireRole('creator'), ctrl.requestWithdraw);
router.get('/my-withdrawals', authenticate, requireRole('creator'), ctrl.getMyWithdrawals);

// ===== Admin uniquement =====
router.get('/admin/dashboard', authenticate, requireRole('admin'), ctrl.getAdminDashboard);
router.get('/admin/list', authenticate, requireRole('admin'), ctrl.getAdminPaymentList);
router.get('/admin/export.csv', authenticate, requireRole('admin'), ctrl.exportPaymentsCsv);
router.get('/admin/withdrawals', authenticate, requireRole('admin'), ctrl.getAdminWithdrawals);
router.post('/admin/withdrawals/:id/complete', authenticate, requireRole('admin'), ctrl.completeWithdrawal);
router.post('/admin/withdrawals/:id/reject', authenticate, requireRole('admin'), ctrl.rejectWithdrawal);

module.exports = router;
