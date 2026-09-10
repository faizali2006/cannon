const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, timingSafeEqual } = require('node:crypto');
const config = require('./lib/config');
const store = require('./lib/store');
const ai = require('./lib/ai');
const { authenticate, sendOtp, verifyOtp } = require('./lib/auth');
const { saveDataUrl, deleteMediaUrl } = require('./lib/media');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg'
};

function commonHeaders(extra = {}, response) {
  return {
    'Access-Control-Allow-Origin': response?.corsOrigin || 'null',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https:",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(config.environment === 'production' ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    ...extra
  };
}

const mediaSigningKey = config.mediaSigningKey || 'local-development-media-key';
const heavyRequestLog = new Map();

function rateLimit(identity, limit = 20, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const entries = (heavyRequestLog.get(identity.uid) || []).filter(timestamp => timestamp > now - windowMs);
  if (entries.length >= limit) throw Object.assign(new Error('Too many AI requests. Try again later.'), { statusCode: 429, code: 'RATE_LIMITED' });
  entries.push(now);
  heavyRequestLog.set(identity.uid, entries);
}

function editableProductFields(body = {}) {
  const allowed = ['status', 'sourceLanguage', 'transcript', 'titleHi', 'titleEn', 'descriptionHi', 'descriptionEn', 'materials', 'features', 'culturalContext', 'priceMin', 'priceSuggested', 'priceMax'];
  return Object.fromEntries(allowed.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
}

function signedMediaUrl(mediaUrl, sellerId) {
  if (!mediaUrl?.startsWith('/uploads/')) return mediaUrl || null;
  const filename = path.basename(mediaUrl);
  const expires = Math.floor(Date.now() / 1000) + config.mediaUrlTtlSeconds;
  const signature = createHmac('sha256', mediaSigningKey).update(`${filename}.${sellerId}.${expires}`).digest('base64url');
  return `/api/media/${encodeURIComponent(filename)}?seller=${encodeURIComponent(sellerId)}&expires=${expires}&signature=${signature}`;
}

function serializeProduct(product) {
  if (!product) return null;
  return {
    ...product,
    originalImageUrl: signedMediaUrl(product.originalImageUrl, product.sellerId),
    enhancedImageUrl: signedMediaUrl(product.enhancedImageUrl, product.sellerId)
  };
}

function verifyMediaSignature(filename, sellerId, expires, signature) {
  if (!filename || !sellerId || !Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + config.mediaUrlTtlSeconds + 60) return false;
  const expected = createHmac('sha256', mediaSigningKey).update(`${filename}.${sellerId}.${expires}`).digest();
  let received;
  try { received = Buffer.from(signature || '', 'base64url'); } catch { return false; }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function serveSignedMedia(response, url) {
  const match = url.pathname.match(/^\/api\/media\/([^/]+)$/);
  if (!match) return false;
  const filename = path.basename(decodeURIComponent(match[1]));
  const sellerId = url.searchParams.get('seller') || '';
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature') || '';
  const storedUrl = `/uploads/${filename}`;
  if (!verifyMediaSignature(filename, sellerId, expires, signature) || !store.sellerOwnsMedia(sellerId, storedUrl)) {
    sendJson(response, 403, { error: 'Media link is invalid or expired', code: 'INVALID_MEDIA_LINK' });
    return true;
  }
  const filePath = path.join(config.uploadDir, filename);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { error: 'Media not found' });
    return true;
  }
  response.writeHead(200, commonHeaders({
    'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  }, response));
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function sendJson(response, status, payload) {
  response.writeHead(status, commonHeaders({ 'Content-Type': 'application/json; charset=utf-8' }, response));
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) return reject(Object.assign(new Error('Content-Type must be application/json'), { statusCode: 415 }));
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > config.maxJsonBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Request is too large'), { statusCode: 413 }));
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function sharePayload(product) {
  const title = product.titleHi || product.titleEn || 'Handmade product';
  const description = product.descriptionHi || product.descriptionEn || '';
  const range = product.priceMin && product.priceMax
    ? `Price range: ₹${Number(product.priceMin).toLocaleString('en-IN')} – ₹${Number(product.priceMax).toLocaleString('en-IN')}`
    : '';
  const price = product.priceSuggested ? `Best price: ₹${Number(product.priceSuggested).toLocaleString('en-IN')}` : '';
  const text = [title, description, range, price, 'शिल्पसारथी से साझा किया गया'].filter(Boolean).join('\n\n');
  return { text, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}` };
}

function serveFile(response, urlPath) {
  let filePath;
  const builtWebRoot = path.join(config.projectRoot, 'dist');
  const webRoot = fs.existsSync(path.join(builtWebRoot, 'index.html')) ? builtWebRoot : config.projectRoot;
  const requested = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const allowedTopLevel = /^(index\.html|[a-z0-9-]+\.(?:css|js))$/i.test(requested);
  const allowedAsset = requested.startsWith('assets/') && !requested.includes('..');
  if (!allowedTopLevel && !allowedAsset) return false;
  filePath = path.resolve(webRoot, requested);
  if (!filePath.startsWith(webRoot + path.sep)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, commonHeaders({
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': ['.html', '.css', '.js'].includes(extension) ? 'no-store' : 'public, max-age=3600'
  }, response));
  fs.createReadStream(filePath).pipe(response);
  return true;
}

async function generateListing(body, identity = { uid: 'local-seller' }) {
  if (!body.imageDataUrl) throw Object.assign(new Error('imageDataUrl is required'), { statusCode: 400 });
  const original = saveDataUrl(body.imageDataUrl, 'image', `original-${identity.uid.slice(0, 12)}`);
  let enhanced;
  try {
    enhanced = await ai.enhanceImage(body.imageDataUrl);
    const catalog = await ai.generateCatalog({
      audioDataUrl: body.audioDataUrl,
      transcript: body.transcript,
      language: body.language || 'hi',
      imageDataUrl: enhanced.dataUrl || body.imageDataUrl
    });
    const pricing = await ai.suggestPrice({
      title: catalog.titleEn || catalog.titleHi,
      description: catalog.descriptionEn || catalog.descriptionHi,
      materials: catalog.materials,
      materialCost: body.materialCost,
      laborHours: body.laborHours,
      hourlyRate: body.hourlyRate,
      marketSignals: body.marketSignals,
      imageDataUrl: enhanced.dataUrl || body.imageDataUrl
    });
    return store.saveProduct({
      sellerId: identity.uid, status: body.status || 'draft',
      sourceLanguage: body.language || 'hi', originalImageUrl: original.url,
      enhancedImageUrl: enhanced.url || original.url, transcript: catalog.transcript,
      titleHi: catalog.titleHi, titleEn: catalog.titleEn,
      descriptionHi: catalog.descriptionHi, descriptionEn: catalog.descriptionEn,
      materials: catalog.materials, features: catalog.features,
      culturalContext: catalog.culturalContext, priceMin: pricing.minimum,
      priceSuggested: pricing.suggested, priceMax: pricing.maximum,
      pricingExplanation: body.language === 'en' ? pricing.explanationEn : pricing.explanationHi
    });
  } catch (error) {
    deleteMediaUrl(original.url);
    if (enhanced?.url && enhanced.url !== original.url) deleteMediaUrl(enhanced.url);
    throw error;
  }
}

async function handleApi(request, response, url) {
  const { method } = request;
  if (method === 'OPTIONS') return sendJson(response, 204, {});
  if (method === 'GET' && url.pathname.startsWith('/api/media/')) {
    if (serveSignedMedia(response, url)) return;
  }
  if (method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, {
      ok: true, service: 'ShilpSarathi API', aiMode: config.aiMode,
      aiProvider: config.aiProvider, requestedAiMode: config.requestedMode,
      liveAIConfigured: config.hasOpenAIKey || config.hasGeminiKey,
      imageEnhancement: config.localImageEnhancement ? 'local-ai' : config.aiProvider,
      timestamp: new Date().toISOString()
    });
  }
  if (method === 'POST' && url.pathname === '/api/auth/send-otp') {
    const body = await readJson(request);
    if (!body.phoneNumber) return sendJson(response, 400, { error: 'Phone number is required' });
    return sendJson(response, 200, await sendOtp(body.phoneNumber));
  }
  if (method === 'POST' && url.pathname === '/api/auth/verify-otp') {
    const body = await readJson(request);
    if (!body.phoneNumber || !body.code) return sendJson(response, 400, { error: 'Phone number and code are required' });
    return sendJson(response, 200, await verifyOtp(body.phoneNumber, body.code));
  }
  const identity = await authenticate(request);
  const existingProfile = store.getProfile(identity.uid);
  if (!existingProfile || (identity.phoneNumber && identity.phoneNumber !== existingProfile.phoneNumber)) store.saveProfile(identity);
  if (method === 'GET' && url.pathname === '/api/me') {
    return sendJson(response, 200, { profile: store.getProfile(identity.uid) });
  }
  if (method === 'PATCH' && url.pathname === '/api/me') {
    const body = await readJson(request);
    return sendJson(response, 200, { profile: store.saveProfile(identity, {
      displayName: body.displayName,
      preferredLanguage: body.preferredLanguage,
      consentVersion: body.consentVersion,
      consentAcceptedAt: body.consentAcceptedAt
    }) });
  }
  if (method === 'GET' && url.pathname === '/api/products') {
    const status = url.searchParams.get('status') || undefined;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    return sendJson(response, 200, { products: store.listProducts({ sellerId: identity.uid, status, limit }).map(serializeProduct) });
  }

  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
  const shareMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/share$/);
  if (method === 'GET' && productMatch) {
    const product = store.getProductForSeller(decodeURIComponent(productMatch[1]), identity.uid);
    return product ? sendJson(response, 200, { product: serializeProduct(product) }) : sendJson(response, 404, { error: 'Product not found' });
  }
  if (method === 'POST' && url.pathname === '/api/products') {
    return sendJson(response, 201, { product: serializeProduct(store.saveProduct({ ...editableProductFields(await readJson(request)), sellerId: identity.uid })) });
  }
  if (method === 'PATCH' && productMatch) {
    const id = decodeURIComponent(productMatch[1]);
    if (!store.getProductForSeller(id, identity.uid)) return sendJson(response, 404, { error: 'Product not found' });
    const body = await readJson(request);
    const changes = editableProductFields(body);
    return sendJson(response, 200, { product: serializeProduct(store.saveProduct({ ...changes, id, sellerId: identity.uid })) });
  }
  if (method === 'DELETE' && productMatch) {
    const id = decodeURIComponent(productMatch[1]);
    const product = store.getProductForSeller(id, identity.uid);
    if (!product) return sendJson(response, 404, { error: 'Product not found' });
    const deleted = store.deleteProductForSeller(id, identity.uid);
    if (deleted) {
      deleteMediaUrl(product.originalImageUrl);
      if (product.enhancedImageUrl !== product.originalImageUrl) deleteMediaUrl(product.enhancedImageUrl);
    }
    return sendJson(response, 200, { deleted });
  }
  if (method === 'POST' && shareMatch) {
    const product = store.getProductForSeller(decodeURIComponent(shareMatch[1]), identity.uid);
    return product ? sendJson(response, 200, sharePayload(product)) : sendJson(response, 404, { error: 'Product not found' });
  }
  if (method === 'POST' && url.pathname === '/api/ai/enhance-image') {
    rateLimit(identity);
    const body = await readJson(request);
    const enhanced = await ai.enhanceImage(body.imageDataUrl);
    if (enhanced.url) deleteMediaUrl(enhanced.url);
    return sendJson(response, 200, { enhancedImageDataUrl: enhanced.dataUrl, provider: enhanced.provider, enhanced: enhanced.enhanced, note: enhanced.note });
  }
  if (method === 'POST' && url.pathname === '/api/ai/catalog') {
    rateLimit(identity);
    const body = await readJson(request);
    return sendJson(response, 200, await ai.generateCatalog(body));
  }
  if (method === 'POST' && url.pathname === '/api/ai/price') {
    rateLimit(identity);
    return sendJson(response, 200, await ai.suggestPrice(await readJson(request)));
  }
  if (method === 'POST' && url.pathname === '/api/listings/generate') {
    rateLimit(identity);
    return sendJson(response, 201, { product: serializeProduct(await generateListing(await readJson(request), identity)), aiMode: config.aiMode });
  }
  if (method === 'POST' && url.pathname === '/api/sync') {
    const body = await readJson(request);
    const results = [];
    for (const operation of Array.isArray(body.operations) ? body.operations.slice(0, 100) : []) {
      if (operation.action === 'delete' && operation.id) {
        const product = store.getProductForSeller(operation.id, identity.uid);
        const deleted = store.deleteProductForSeller(operation.id, identity.uid);
        if (deleted && product) {
          deleteMediaUrl(product.originalImageUrl);
          if (product.enhancedImageUrl !== product.originalImageUrl) deleteMediaUrl(product.enhancedImageUrl);
        }
        results.push({ clientId: operation.clientId, deleted });
      }
      else if (operation.action === 'upsert' && operation.product) {
        const requestedId = typeof operation.product.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(operation.product.id) ? operation.product.id : undefined;
        if (requestedId && store.getProduct(requestedId) && !store.getProductForSeller(requestedId, identity.uid)) throw Object.assign(new Error('Product belongs to another seller'), { statusCode: 403 });
        results.push({ clientId: operation.clientId, product: serializeProduct(store.saveProduct({ ...editableProductFields(operation.product), id: requestedId, sellerId: identity.uid })) });
      }
    }
    return sendJson(response, 200, { results });
  }
  return sendJson(response, 404, { error: 'API route not found' });
}

function isPrivateDevelopmentOrigin(origin) {
  if (config.environment === 'production') return false;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
    const match = hostname.match(/^172\.(\d+)\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const origin = request.headers.origin || '';
  const originAllowed = !origin || config.corsAllowedOrigins.includes(origin) || isPrivateDevelopmentOrigin(origin);
  response.corsOrigin = originAllowed && origin ? origin : 'null';
  try {
    if (!originAllowed) return sendJson(response, 403, { error: 'Origin is not allowed', code: 'ORIGIN_NOT_ALLOWED' });
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (serveFile(response, decodeURIComponent(url.pathname))) return;
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const isServerError = status >= 500;
    const safeOperationalError = ['AI_NOT_CONFIGURED', 'AUTH_NOT_CONFIGURED', 'AI_IMAGE_QUOTA_UNAVAILABLE', 'AI_IMAGE_ENHANCEMENT_FAILED'].includes(error.code);
    if (isServerError) console.error(`[${new Date().toISOString()}]`, error);
    if (!response.headersSent) sendJson(response, status, {
      error: isServerError && !safeOperationalError ? 'The service could not complete this request' : (error.message || 'Request failed'),
      ...(error.code ? { code: error.code } : {}),
      ...(!isServerError && error.details ? { details: error.details } : {})
    });
    else response.end();
  }
});

function validateServerConfig() {
  if (config.environment !== 'production') return;
  const failures = [];
  if (config.authMode !== 'twilio' || !config.twilioAccountSid || !config.twilioAuthToken || !config.twilioVerifyServiceSid) failures.push('Twilio authentication must be configured');
  if (!config.jwtSecret || config.jwtSecret.length < 32) failures.push('JWT_SECRET must contain at least 32 characters');
  if (config.mediaSigningKey.length < 32) failures.push('MEDIA_SIGNING_KEY must contain at least 32 characters');
  if (!config.corsAllowedOrigins.length || config.corsAllowedOrigins.some(origin => origin === '*' || !origin.startsWith('https://'))) failures.push('CORS origins must be explicit HTTPS origins');
  if (config.aiMode !== 'live') failures.push('Live AI must be configured');
  if (failures.length) throw new Error(`Unsafe production configuration: ${failures.join('; ')}`);
}

function startServer(port = config.port) {
  validateServerConfig();
  return new Promise(resolve => server.listen(port, '0.0.0.0', () => resolve(server)));
}

if (require.main === module) {
  startServer().then(() => {
    console.log(`ShilpSarathi running at http://localhost:${config.port}`);
    console.log(`AI mode: ${config.aiMode}; provider: ${config.aiProvider}${config.requestedMode === 'live' && config.aiProvider === 'demo' ? ' (server-side AI key missing)' : ''}`);
  });
}

module.exports = { server, startServer, generateListing, sharePayload, serializeProduct, verifyMediaSignature, validateServerConfig };
