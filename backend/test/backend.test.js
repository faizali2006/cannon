process.env.ALLOW_DEMO_AI = 'true';
process.env.AI_MODE = 'demo';
process.env.AUTH_MODE = 'demo';
process.env.NODE_ENV = 'test';
process.env.FIREBASE_CHECK_REVOKED = 'false';
process.env.MEDIA_SIGNING_KEY = 'test-only-media-signing-key-with-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { calculatePrice } = require('../lib/pricing');
const store = require('../lib/store');
const ai = require('../lib/ai');
const media = require('../lib/media');
const auth = require('../lib/auth');
const config = require('../lib/config');
const { sharePayload, server, startServer } = require('../server');

test('pricing keeps an ordered editable INR range', () => {
  const price = calculatePrice({ title: 'Handwoven cotton dupatta', materialCost: 420, laborHours: 5, hourlyRate: 90 });
  assert.equal(price.currency, 'INR');
  assert.ok(price.minimum <= price.suggested);
  assert.ok(price.suggested <= price.maximum);
  assert.equal(price.suggested % 50, 0);
});

test('inventory stores, updates, lists, and deletes a listing', () => {
  const id = `test-${randomUUID()}`;
  const created = store.saveProduct({ id, titleHi: 'परीक्षण उत्पाद', titleEn: 'Test product', priceSuggested: 900 });
  assert.equal(created.id, id);
  assert.equal(created.priceSuggested, 900);
  const updated = store.saveProduct({ id, status: 'ready', priceSuggested: 950 });
  assert.equal(updated.status, 'ready');
  assert.equal(store.getProduct(id).priceSuggested, 950);
  assert.ok(store.listProducts().some(product => product.id === id));
  assert.equal(store.deleteProduct(id), true);
  assert.equal(store.getProduct(id), null);
});

test('demo catalog produces bilingual structured output', async () => {
  const catalog = await ai.generateCatalog({ transcript: 'यह हाथ से बनी बाँस की टोकरी है', language: 'hi' });
  assert.equal(catalog.provider, 'demo');
  assert.match(catalog.titleHi, /बाँस/);
  assert.match(catalog.titleEn, /Bamboo/);
  assert.ok(Array.isArray(catalog.materials));
});

test('demo catalog follows the seller description instead of a fixed dupatta', async () => {
  const catalog = await ai.generateCatalog({ transcript: 'Blue sarree', language: 'en' });
  assert.match(catalog.titleEn, /Saree/i);
  assert.doesNotMatch(catalog.titleEn, /Dupatta/i);
});

test('WhatsApp sharing URL contains the listing', () => {
  const share = sharePayload({ titleHi: 'हाथबुना दुपट्टा', descriptionHi: 'प्राकृतिक रंग', priceSuggested: 1299 });
  assert.match(share.whatsappUrl, /^https:\/\/wa\.me\/\?text=/);
  assert.match(decodeURIComponent(share.whatsappUrl), /हाथबुना दुपट्टा/);
});

test('WhatsApp sharing includes the competitive price range', () => {
  const share = sharePayload({ titleEn: 'Basket', priceMin: 700, priceSuggested: 850, priceMax: 1000 });
  assert.match(share.text, /₹700/);
  assert.match(share.text, /₹1,000/);
  assert.match(share.whatsappUrl, /^https:\/\/wa\.me\/\?text=/);
});

test('profile stores only trusted identity phone and validates consent date', () => {
  const uid = `profile-${randomUUID()}`;
  const profile = store.saveProfile({ uid, phoneNumber: '+919876543210' }, {
    displayName: '  Meera   Devi ', preferredLanguage: 'te', phoneNumber: '+911111111111',
    consentVersion: '2026-09-07', consentAcceptedAt: '2026-09-07T10:00:00.000Z'
  });
  assert.equal(profile.phoneNumber, '+919876543210');
  assert.equal(profile.displayName, 'Meera Devi');
  assert.equal(profile.preferredLanguage, 'te');
  assert.throws(() => store.saveProfile({ uid }, { consentVersion: '2026-09-07' }), /provided together/);
  assert.throws(() => store.saveProfile({ uid }, { consentVersion: '2026-09-07', consentAcceptedAt: 'not-a-date' }), /Consent date is invalid/);
});

test('inventory access is isolated by authenticated seller', () => {
  const sellerA = `seller-a-${randomUUID()}`;
  const sellerB = `seller-b-${randomUUID()}`;
  store.saveProfile({ uid: sellerA, phoneNumber: '+919000000001' });
  store.saveProfile({ uid: sellerB, phoneNumber: '+919000000002' });
  const product = store.saveProduct({ sellerId: sellerA, titleEn: 'Private basket' });
  assert.equal(store.getProductForSeller(product.id, sellerB), null);
  assert.equal(store.deleteProductForSeller(product.id, sellerB), false);
  assert.throws(() => store.saveProduct({ id: product.id, sellerId: sellerB, titleEn: 'Stolen' }), /another seller/);
  assert.throws(() => store.saveProduct({ id: product.id, sellerId: sellerA, priceMin: 1000, priceSuggested: 800, priceMax: 1200 }), /Minimum price/);
  assert.throws(() => store.saveProduct({ id: product.id, sellerId: sellerA, status: 'unknown' }), /status is invalid/);
  assert.equal(store.deleteProductForSeller(product.id, sellerA), true);
});

test('image parser rejects MIME spoofing and accepts a real product photo', () => {
  const fake = `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`;
  assert.throws(() => media.parseDataUrl(fake, 'image'), /does not match/);
  const malformedPng = Buffer.alloc(24);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(malformedPng);
  assert.throws(() => media.parseDataUrl(`data:image/png;base64,${malformedPng.toString('base64')}`, 'image'), /structure is invalid/);
  const photo = fs.readFileSync(path.resolve(__dirname, '../../assets/indigo-dupatta-720.jpg'));
  const parsed = media.parseDataUrl(`data:image/jpeg;base64,${photo.toString('base64')}`, 'image');
  assert.equal(parsed.mimeType, 'image/jpeg');
  assert.ok(parsed.dimensions.width > 0 && parsed.dimensions.height > 0);
});

test('Firebase verifier accepts a correctly signed ID token and rejects the wrong audience', async t => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const jwksServer = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise(resolve => jwksServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => jwksServer.close(resolve)));
  const oldProject = config.firebaseProjectId;
  const oldJwks = config.firebaseJwksUrl;
  config.firebaseProjectId = 'test-project';
  config.firebaseJwksUrl = `http://127.0.0.1:${jwksServer.address().port}`;
  t.after(() => { config.firebaseProjectId = oldProject; config.firebaseJwksUrl = oldJwks; });
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: 'firebase-user-1', phone_number: '+919876543210', auth_time: now - 5, firebase: { sign_in_provider: 'phone' } };
  const validToken = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://securetoken.google.com/test-project').setAudience('test-project').setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
  const identity = await auth.verifyFirebaseToken(validToken);
  assert.equal(identity.uid, 'firebase-user-1');
  assert.equal(identity.phoneNumber, '+919876543210');
  const wrongAudience = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://securetoken.google.com/test-project').setAudience('wrong-project').setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
  await assert.rejects(auth.verifyFirebaseToken(wrongAudience), error => error.statusCode === 401 && error.code === 'INVALID_TOKEN');
});

test('authenticated API creates a private listing and serves only signed media', async t => {
  await startServer(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const root = `http://127.0.0.1:${port}`;
  const blockedOrigin = await fetch(`${root}/api/health`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(blockedOrigin.status, 403);
  const page = await fetch(root);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const wrongContentType = await fetch(`${root}/api/products`, { method: 'POST', body: '{}' });
  assert.equal(wrongContentType.status, 415);
  const photo = fs.readFileSync(path.resolve(__dirname, '../../assets/indigo-dupatta-720.jpg'));
  const imageDataUrl = `data:image/jpeg;base64,${photo.toString('base64')}`;
  const response = await fetch(`${root}/api/listings/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, transcript: 'Blue handwoven saree', language: 'en' })
  });
  assert.equal(response.status, 201);
  const { product } = await response.json();
  assert.match(product.originalImageUrl, /^\/api\/media\//);
  assert.equal((await fetch(`${root}${product.originalImageUrl}`)).status, 200);
  const tampered = new URL(`${root}${product.originalImageUrl}`);
  tampered.searchParams.set('signature', 'invalid');
  assert.equal((await fetch(tampered)).status, 403);
  const storedFilename = decodeURIComponent(new URL(`${root}${product.originalImageUrl}`).pathname.split('/').pop());
  assert.equal((await fetch(`${root}/uploads/${storedFilename}`)).status, 404);
  const invalidPrice = await fetch(`${root}/api/products/${encodeURIComponent(product.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceMin: 2000, priceSuggested: 1000, priceMax: 3000 })
  });
  assert.equal(invalidPrice.status, 400);
  const deleted = await fetch(`${root}/api/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
});
