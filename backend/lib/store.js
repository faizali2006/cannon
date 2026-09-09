const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const database = new DatabaseSync(path.join(config.dataDir, 'shilpsarathi.db'));
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    phone_number TEXT,
    display_name TEXT,
    preferred_language TEXT NOT NULL DEFAULT 'hi',
    consent_version TEXT,
    consent_accepted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL DEFAULT 'local-seller',
    status TEXT NOT NULL DEFAULT 'draft',
    source_language TEXT,
    original_image_url TEXT,
    enhanced_image_url TEXT,
    transcript TEXT,
    title_hi TEXT,
    title_en TEXT,
    description_hi TEXT,
    description_en TEXT,
    materials_json TEXT NOT NULL DEFAULT '[]',
    features_json TEXT NOT NULL DEFAULT '[]',
    cultural_context TEXT,
    price_min INTEGER,
    price_suggested INTEGER,
    price_max INTEGER,
    pricing_explanation TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS products_seller_updated_idx ON products (seller_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS products_seller_status_updated_idx ON products (seller_id, status, updated_at DESC);
`);

const localNow = new Date().toISOString();
database.prepare(`INSERT OR IGNORE INTO users (uid, phone_number, display_name, preferred_language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  'local-seller', '+910000000000', 'Local seller', 'hi', localNow, localNow
);

const selectColumns = `
  id, seller_id, status, source_language, original_image_url, enhanced_image_url,
  transcript, title_hi, title_en, description_hi, description_en, materials_json,
  features_json, cultural_context, price_min, price_suggested, price_max,
  pricing_explanation, created_at, updated_at
`;

function safeJson(value, fallback = []) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    sellerId: row.seller_id,
    status: row.status,
    sourceLanguage: row.source_language,
    originalImageUrl: row.original_image_url,
    enhancedImageUrl: row.enhanced_image_url,
    transcript: row.transcript,
    titleHi: row.title_hi,
    titleEn: row.title_en,
    descriptionHi: row.description_hi,
    descriptionEn: row.description_en,
    materials: safeJson(row.materials_json),
    features: safeJson(row.features_json),
    culturalContext: row.cultural_context,
    priceMin: row.price_min,
    priceSuggested: row.price_suggested,
    priceMax: row.price_max,
    pricingExplanation: row.pricing_explanation,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProfile(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    preferredLanguage: row.preferred_language,
    consentVersion: row.consent_version,
    consentAcceptedAt: row.consent_accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getProfile(uid) {
  return mapProfile(database.prepare('SELECT * FROM users WHERE uid = ?').get(uid));
}

function saveProfile(identity, input = {}) {
  if (!identity?.uid || typeof identity.uid !== 'string' || identity.uid.length > 128) throw Object.assign(new Error('Authenticated user is required'), { statusCode: 401 });
  const existing = getProfile(identity.uid);
  const now = new Date().toISOString();
  const displayName = input.displayName === undefined ? existing?.displayName || null : String(input.displayName).trim().replace(/\s+/g, ' ').slice(0, 60);
  if (input.displayName !== undefined && displayName.length < 2) throw Object.assign(new Error('Name must contain at least 2 characters'), { statusCode: 400 });
  const allowedLanguages = new Set(['hi', 'en', 'mr', 'ta', 'te', 'kn', 'bn', 'gu', 'pa', 'ml']);
  const preferredLanguage = allowedLanguages.has(input.preferredLanguage) ? input.preferredLanguage : existing?.preferredLanguage || 'hi';
  const changesConsentVersion = input.consentVersion !== undefined;
  const changesConsentDate = input.consentAcceptedAt !== undefined;
  if (changesConsentVersion !== changesConsentDate) throw Object.assign(new Error('Consent version and acceptance date must be provided together'), { statusCode: 400 });
  const consentVersion = input.consentVersion === undefined ? existing?.consentVersion || null : String(input.consentVersion).trim().slice(0, 40);
  if (changesConsentVersion && !consentVersion) throw Object.assign(new Error('Consent version is required'), { statusCode: 400 });
  let consentAcceptedAt = existing?.consentAcceptedAt || null;
  if (input.consentAcceptedAt !== undefined) {
    const parsedConsentDate = new Date(input.consentAcceptedAt);
    if (!Number.isFinite(parsedConsentDate.getTime())) throw Object.assign(new Error('Consent date is invalid'), { statusCode: 400 });
    if (parsedConsentDate.getTime() > Date.now() + 5 * 60 * 1000) throw Object.assign(new Error('Consent date cannot be in the future'), { statusCode: 400 });
    consentAcceptedAt = parsedConsentDate.toISOString();
  }
  database.prepare(`
    INSERT INTO users (uid, phone_number, display_name, preferred_language, consent_version, consent_accepted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET phone_number=excluded.phone_number, display_name=excluded.display_name,
      preferred_language=excluded.preferred_language, consent_version=excluded.consent_version,
      consent_accepted_at=excluded.consent_accepted_at, updated_at=excluded.updated_at
  `).run(identity.uid, identity.phoneNumber || existing?.phoneNumber || null, displayName, preferredLanguage, consentVersion, consentAcceptedAt, existing?.createdAt || now, now);
  return getProfile(identity.uid);
}

function listProducts({ sellerId = 'local-seller', status, limit = 100 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Math.round(Number(limit) || 100)));
  const rows = status
    ? database.prepare(`SELECT ${selectColumns} FROM products WHERE seller_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?`).all(sellerId, status, safeLimit)
    : database.prepare(`SELECT ${selectColumns} FROM products WHERE seller_id = ? ORDER BY updated_at DESC LIMIT ?`).all(sellerId, safeLimit);
  return rows.map(mapProduct);
}

function getProduct(id) {
  return mapProduct(database.prepare(`SELECT ${selectColumns} FROM products WHERE id = ?`).get(id));
}

function getProductForSeller(id, sellerId) {
  return mapProduct(database.prepare(`SELECT ${selectColumns} FROM products WHERE id = ? AND seller_id = ?`).get(id, sellerId));
}

function cleanText(value, maximum, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return String(value).trim().slice(0, maximum);
}

function cleanList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 20).map(item => String(item).trim().slice(0, 100)).filter(Boolean);
}

function cleanPrice(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw Object.assign(new Error('Price must be a number'), { statusCode: 400 });
  return Math.round(number);
}

function normalizeProduct(input = {}, existing = {}) {
  const now = new Date().toISOString();
  const requestedStatus = input.status ?? existing.status ?? 'draft';
  if (!['draft', 'ready', 'published', 'archived'].includes(requestedStatus)) throw Object.assign(new Error('Product status is invalid'), { statusCode: 400 });
  const allowedLanguages = new Set(['hi', 'en', 'mr', 'ta', 'te', 'kn', 'bn', 'gu', 'pa', 'ml']);
  const sourceLanguage = cleanText(input.sourceLanguage, 10, existing.sourceLanguage ?? null);
  if (sourceLanguage && !allowedLanguages.has(sourceLanguage)) throw Object.assign(new Error('Product language is invalid'), { statusCode: 400 });
  const product = {
    id: input.id || existing.id || randomUUID(),
    sellerId: input.sellerId ?? existing.sellerId ?? 'local-seller',
    status: requestedStatus,
    sourceLanguage,
    originalImageUrl: input.originalImageUrl ?? existing.originalImageUrl ?? null,
    enhancedImageUrl: input.enhancedImageUrl ?? existing.enhancedImageUrl ?? null,
    transcript: cleanText(input.transcript, 5000, existing.transcript ?? null),
    titleHi: cleanText(input.titleHi, 180, existing.titleHi ?? null),
    titleEn: cleanText(input.titleEn, 180, existing.titleEn ?? null),
    descriptionHi: cleanText(input.descriptionHi, 5000, existing.descriptionHi ?? null),
    descriptionEn: cleanText(input.descriptionEn, 5000, existing.descriptionEn ?? null),
    materials: cleanList(input.materials, existing.materials || []),
    features: cleanList(input.features, existing.features || []),
    culturalContext: cleanText(input.culturalContext, 1000, existing.culturalContext ?? null),
    priceMin: cleanPrice(input.priceMin, existing.priceMin ?? null),
    priceSuggested: cleanPrice(input.priceSuggested, existing.priceSuggested ?? null),
    priceMax: cleanPrice(input.priceMax, existing.priceMax ?? null),
    pricingExplanation: cleanText(input.pricingExplanation, 2000, existing.pricingExplanation ?? null),
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now
  };
  for (const value of [product.priceMin, product.priceSuggested, product.priceMax]) {
    if (value !== null && (value < 1 || value > 100000000)) throw Object.assign(new Error('Price must be between 1 and 100,000,000 INR'), { statusCode: 400 });
  }
  if (product.priceMin !== null && product.priceSuggested !== null && product.priceMin > product.priceSuggested) throw Object.assign(new Error('Minimum price cannot exceed suggested price'), { statusCode: 400 });
  if (product.priceSuggested !== null && product.priceMax !== null && product.priceSuggested > product.priceMax) throw Object.assign(new Error('Suggested price cannot exceed maximum price'), { statusCode: 400 });
  if (product.priceMin !== null && product.priceMax !== null && product.priceMin > product.priceMax) throw Object.assign(new Error('Minimum price cannot exceed maximum price'), { statusCode: 400 });
  return product;
}

function saveProduct(input) {
  const existing = input.id ? getProduct(input.id) : null;
  if (existing && input.sellerId && existing.sellerId !== input.sellerId) {
    throw Object.assign(new Error('Product belongs to another seller'), { statusCode: 403 });
  }
  const product = normalizeProduct(input, existing || {});
  database.prepare(`
    INSERT INTO products (
      id, seller_id, status, source_language, original_image_url, enhanced_image_url,
      transcript, title_hi, title_en, description_hi, description_en, materials_json,
      features_json, cultural_context, price_min, price_suggested, price_max,
      pricing_explanation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      seller_id=excluded.seller_id, status=excluded.status,
      source_language=excluded.source_language, original_image_url=excluded.original_image_url,
      enhanced_image_url=excluded.enhanced_image_url, transcript=excluded.transcript,
      title_hi=excluded.title_hi, title_en=excluded.title_en,
      description_hi=excluded.description_hi, description_en=excluded.description_en,
      materials_json=excluded.materials_json, features_json=excluded.features_json,
      cultural_context=excluded.cultural_context, price_min=excluded.price_min,
      price_suggested=excluded.price_suggested, price_max=excluded.price_max,
      pricing_explanation=excluded.pricing_explanation, updated_at=excluded.updated_at
  `).run(
    product.id, product.sellerId, product.status, product.sourceLanguage,
    product.originalImageUrl, product.enhancedImageUrl, product.transcript,
    product.titleHi, product.titleEn, product.descriptionHi, product.descriptionEn,
    JSON.stringify(product.materials), JSON.stringify(product.features),
    product.culturalContext, product.priceMin, product.priceSuggested,
    product.priceMax, product.pricingExplanation, product.createdAt, product.updatedAt
  );
  return getProduct(product.id);
}

function deleteProduct(id) {
  return database.prepare('DELETE FROM products WHERE id = ?').run(id).changes > 0;
}

function deleteProductForSeller(id, sellerId) {
  return database.prepare('DELETE FROM products WHERE id = ? AND seller_id = ?').run(id, sellerId).changes > 0;
}

function sellerOwnsMedia(sellerId, mediaUrl) {
  return Boolean(database.prepare('SELECT 1 FROM products WHERE seller_id = ? AND (original_image_url = ? OR enhanced_image_url = ?) LIMIT 1').get(sellerId, mediaUrl, mediaUrl));
}

function closeStore() {
  database.close();
}

module.exports = {
  listProducts, getProduct, getProductForSeller, saveProduct, deleteProduct,
  deleteProductForSeller, sellerOwnsMedia, getProfile, saveProfile, closeStore
};
