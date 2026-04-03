/**
 * Service de notifications push via Expo Push API
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const https = require('https');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Envoie une ou plusieurs notifications push via l'API Expo
 * @param {Array<{to, title, body, data}>} messages
 */
async function sendPushNotifications(messages) {
  if (!messages || messages.length === 0) return;

  // Filtrer les tokens invalides
  const valid = messages.filter((m) => m.to && typeof m.to === 'string' && m.to.startsWith('ExponentPushToken['));
  if (valid.length === 0) return;

  const payload = JSON.stringify(
    valid.map((m) => ({
      to: m.to,
      title: m.title,
      body: m.body,
      data: m.data || {},
      sound: 'default',
      priority: 'high',
    }))
  );

  return new Promise((resolve) => {
    const url = new URL(EXPO_PUSH_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.errors) {
            console.error('[Push] Expo errors:', result.errors);
          }
        } catch { }
        resolve();
      });
    });

    req.on('error', (err) => {
      console.error('[Push] Request error:', err.message);
      resolve(); // Ne pas bloquer l'app si push échoue
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Envoie une notification push à un utilisateur via son token
 * @param {string|null} pushToken
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function notifyUser(pushToken, title, body, data = {}) {
  if (!pushToken) return;
  try {
    await sendPushNotifications([{ to: pushToken, title, body, data }]);
  } catch (err) {
    console.error('[Push] notifyUser error:', err.message);
  }
}

module.exports = { notifyUser, sendPushNotifications };
