const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');

function loadLocalEnv() {
  const rootEnvPath = path.join(backendRoot, '..', '.env');
  const backendEnvPath = path.join(backendRoot, '.env');
  
  [rootEnvPath, backendEnvPath].forEach(envPath => {
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  });
}

loadLocalEnv();

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

const requestedMode = (process.env.AI_MODE || 'demo').toLowerCase();
const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
const requestedProvider = (process.env.AI_PROVIDER || (hasGeminiKey ? 'gemini' : 'openai')).toLowerCase();
const aiProvider = requestedProvider === 'gemini' && hasGeminiKey ? 'gemini'
  : requestedProvider === 'openai' && hasOpenAIKey ? 'openai'
    : hasGeminiKey ? 'gemini' : hasOpenAIKey ? 'openai' : 'demo';

module.exports = {
  backendRoot,
  projectRoot: path.resolve(backendRoot, '..'),
  dataDir: path.join(backendRoot, 'data'),
  uploadDir: path.join(backendRoot, 'uploads'),
  port: boundedNumber(process.env.PORT, 8787, 1, 65535),
  environment: (process.env.NODE_ENV || 'development').toLowerCase(),
  authMode: (process.env.AUTH_MODE || 'demo').toLowerCase() === 'twilio' ? 'twilio' : 'demo',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
  jwtSecret: process.env.JWT_SECRET || '',
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:8787,http://localhost:5173,https://localhost').split(',').map(value => value.trim()).filter(Boolean),
  mediaSigningKey: process.env.MEDIA_SIGNING_KEY || '',
  mediaUrlTtlSeconds: boundedNumber(process.env.MEDIA_URL_TTL_SECONDS, 900, 60, 86400),
  aiMode: requestedMode === 'live' && aiProvider !== 'demo' ? 'live' : 'demo',
  allowDemoAi: (process.env.ALLOW_DEMO_AI || 'false').toLowerCase() === 'true',
  localImageEnhancement: (process.env.LOCAL_IMAGE_ENHANCEMENT || 'false').toLowerCase() === 'true',
  aiProvider,
  requestedMode,
  requestedProvider,
  hasOpenAIKey,
  hasGeminiKey,
  openAIKey: process.env.OPENAI_API_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite',
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
  geminiGrounding: (process.env.GEMINI_GROUNDING || 'true').toLowerCase() !== 'false',
  textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe',
  imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  maxJsonBytes: 30 * 1024 * 1024,
  maxImageBytes: 12 * 1024 * 1024,
  maxImageDimension: boundedNumber(process.env.MAX_IMAGE_DIMENSION, 6000, 512, 12000),
  maxImagePixels: boundedNumber(process.env.MAX_IMAGE_PIXELS, 24000000, 1000000, 100000000),
  maxAudioBytes: 20 * 1024 * 1024
};
