const fs = require('node:fs');
const path = require('node:path');

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
}

const values = { ...readEnv(path.resolve('.env.production')), ...process.env };
const failures = [];
const apiOrigin = values.VITE_API_ORIGIN || '';

if (!/^https:\/\//.test(apiOrigin) || /localhost|127\.0\.0\.1|YOUR-/i.test(apiOrigin)) failures.push('VITE_API_ORIGIN must be the real HTTPS backend URL.');
if (values.VITE_AUTH_MODE !== 'firebase') failures.push('VITE_AUTH_MODE must be firebase.');
if (values.VITE_RELEASE !== 'true') failures.push('VITE_RELEASE must be true.');
if (!values.FIREBASE_PROJECT_ID || /your-/i.test(values.FIREBASE_PROJECT_ID)) failures.push('FIREBASE_PROJECT_ID is required.');
if (values.NODE_ENV !== 'production') failures.push('NODE_ENV must be production.');
if (values.AUTH_MODE !== 'firebase') failures.push('AUTH_MODE must be firebase on the API.');
if (values.FIREBASE_CHECK_REVOKED !== 'true') failures.push('FIREBASE_CHECK_REVOKED must be true.');
if (values.FIREBASE_JWKS_URL && values.FIREBASE_JWKS_URL !== 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') failures.push('Custom Firebase JWKS URLs are not permitted in production.');
if (!values.MEDIA_SIGNING_KEY || values.MEDIA_SIGNING_KEY.length < 32 || /replace-/i.test(values.MEDIA_SIGNING_KEY)) failures.push('MEDIA_SIGNING_KEY must be a real random value with at least 32 characters.');
const corsOrigins = (values.CORS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
if (!corsOrigins.length || corsOrigins.some(origin => origin === '*' || !origin.startsWith('https://')) || /your-web-origin/i.test(values.CORS_ALLOWED_ORIGINS || '')) failures.push('CORS_ALLOWED_ORIGINS must list explicit HTTPS app origins.');
if (values.AI_MODE !== 'live') failures.push('AI_MODE must be live for production enhancement.');
if (!values.GEMINI_API_KEY && !values.OPENAI_API_KEY) failures.push('A server-side Gemini or OpenAI key is required.');
if (!fs.existsSync(path.resolve('android/app/google-services.json'))) failures.push('android/app/google-services.json is required for real phone OTP.');
const businessConfig = fs.existsSync(path.resolve('business-config.js')) ? fs.readFileSync(path.resolve('business-config.js'), 'utf8') : '';
for (const field of ['legalName', 'address', 'email', 'phone', 'registration', 'grievanceOfficer']) {
  const match = businessConfig.match(new RegExp(`${field}\\s*:\\s*['\"]([^'\"]*)['\"]`));
  if (!match || !match[1].trim()) failures.push(`business-config.js requires ${field}.`);
}
if (values.ASSET_RIGHTS_CONFIRMED !== 'true') failures.push('ASSET_RIGHTS_CONFIRMED=true is required after documenting licenses for every bundled image and audio file.');
if (values.LEGAL_TRANSLATIONS_REVIEWED !== 'true') failures.push('LEGAL_TRANSLATIONS_REVIEWED=true is required after the policies and consent copy are professionally reviewed in every offered language.');
if (values.LEGAL_REVIEW_CONFIRMED !== 'true') failures.push('LEGAL_REVIEW_CONFIRMED=true is required after qualified counsel reviews the final operator, vendors, data flows, and commercial model.');

const sellerHtml = fs.existsSync(path.resolve('index.html')) ? fs.readFileSync(path.resolve('index.html'), 'utf8') : '';
for (const requiredPage of ['privacy-screen', 'terms-screen', 'cookies-screen', 'refund-screen', 'business-screen']) {
  if (!sellerHtml.includes(`id="${requiredPage}"`)) failures.push(`Seller UI requires ${requiredPage}.`);
}
if (/customer-screen|buyer-screen|role-selection|खरीदार/i.test(sellerHtml)) failures.push('Seller UI must not contain buyer role or buyer screens.');
if (/[\u{1F300}-\u{1FAFF}]/u.test(sellerHtml)) failures.push('Seller UI text must not contain emoji.');

if (failures.length) {
  console.error('Release blocked:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Release configuration is valid.');
