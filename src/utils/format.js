function formatFCFA(amount) {
  if (!amount && amount !== 0) return '-';
  return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
}

module.exports = { formatFCFA };
