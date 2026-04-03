const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Client Supabase avec la clé service (accès complet au storage)
// Lazy init — évite le crash au démarrage si les vars ne sont pas encore définies
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis pour le stockage de fichiers.');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}
// Compatibilité : accès direct via supabase.storage...
const supabase = new Proxy({}, {
  get(_, prop) { return getSupabase()[prop]; },
});

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

const MAX_IMAGE_SIZE = (parseInt(process.env.MAX_IMAGE_SIZE_MB) || 10) * 1024 * 1024;
const MAX_VIDEO_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 200) * 1024 * 1024;

// Multer stocke en mémoire — on upload ensuite vers Supabase
function createUploader(allowedTypes, maxSize) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSize },
    fileFilter: (req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Type de fichier non autorisé. Acceptés: ${allowedTypes.join(', ')}`));
      }
    },
  });
}

const uploadAvatar  = createUploader(ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE);
const uploadCover   = createUploader(ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE);
const uploadContent = createUploader(ALLOWED_TYPES, MAX_VIDEO_SIZE);

/**
 * Upload un fichier vers Supabase Storage
 * @param {Buffer} buffer - Contenu du fichier
 * @param {string} bucket - Nom du bucket (avatars, covers, content, proofs)
 * @param {string} folder - Sous-dossier (ex: "avatars")
 * @param {string} mimetype - Type MIME
 * @returns {Promise<{key: string, url: string}>}
 */
async function uploadToSupabase(buffer, bucket, folder, mimetype) {
  const ext = mimetype === 'image/png' ? '.png'
    : mimetype === 'image/webp' ? '.webp'
    : mimetype === 'video/mp4' ? '.mp4'
    : mimetype === 'video/quicktime' ? '.mov'
    : '.jpg';

  const key = `${folder}/${uuidv4()}${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, buffer, {
      contentType: mimetype,
      upsert: false,
    });

  if (error) throw new Error(`Erreur upload Supabase: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);

  return { key, url: data.publicUrl };
}

/**
 * Supprimer un fichier de Supabase Storage
 */
async function deleteFromSupabase(bucket, key) {
  try {
    await supabase.storage.from(bucket).remove([key]);
  } catch (error) {
    console.error('Erreur suppression Supabase:', error);
  }
}

/**
 * Générer une URL signée pour un fichier privé (preuves de paiement)
 */
async function getSignedUrl(bucket, key, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(key, expiresIn);

  if (error) return null;
  return data.signedUrl;
}

// Compatibilité avec l'ancien code qui utilisait S3
const s3 = null; // Plus utilisé

module.exports = {
  supabase,
  uploadAvatar,
  uploadCover,
  uploadContent,
  uploadToSupabase,
  deleteFromSupabase,
  getSignedUrl,
  s3, // null — gardé pour éviter les erreurs d'import
};
