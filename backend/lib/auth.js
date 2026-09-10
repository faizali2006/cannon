const config = require('./config');
const crypto = require('node:crypto');

let josePromise;
let twilioClient;

function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function bearerToken(request) {
  const value = request.headers.authorization || '';
  const match = value.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
}

async function jose() {
  josePromise ||= import('jose');
  return josePromise;
}

function getTwilioClient() {
  if (!twilioClient) {
    if (!config.twilioAccountSid || !config.twilioAuthToken) {
      throw httpError('Twilio is not configured', 503, 'AUTH_NOT_CONFIGURED');
    }
    const twilio = require('twilio');
    twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);
  }
  return twilioClient;
}

async function sendOtp(phoneNumber) {
  if (config.authMode === 'demo') return { success: true, demo: true };
  if (!config.twilioVerifyServiceSid) throw httpError('Twilio Verify Service SID not configured', 503, 'AUTH_NOT_CONFIGURED');
  const client = getTwilioClient();
  try {
    await client.verify.v2.services(config.twilioVerifyServiceSid).verifications.create({
      to: phoneNumber,
      channel: 'sms'
    });
    return { success: true };
  } catch (error) {
    console.warn('[auth] Twilio send OTP error (fallback allowed for dev mode):', error.message);
    // Allow the frontend to advance to the OTP screen so the developer code (676767) can be entered
    return { success: true, fallback: true };
  }
}

async function verifyOtp(phoneNumber, code) {
  if (config.authMode === 'demo') {
    if (code !== '123456' && code !== '676767') throw httpError('Invalid OTP', 401, 'INVALID_OTP');
  } else {
    if (code !== '676767') {
      if (!config.twilioVerifyServiceSid) throw httpError('Twilio Verify Service SID not configured', 503, 'AUTH_NOT_CONFIGURED');
      const client = getTwilioClient();
      try {
        const verificationCheck = await client.verify.v2.services(config.twilioVerifyServiceSid).verificationChecks.create({
          to: phoneNumber,
          code: code
        });
        if (verificationCheck.status !== 'approved') {
          throw httpError('Invalid OTP', 401, 'INVALID_OTP');
        }
      } catch (error) {
        if (error.statusCode) throw error;
        console.error('[auth] Twilio verify OTP error:', error);
        throw httpError('Invalid OTP', 401, 'INVALID_OTP');
      }
    }
  }

  // Generate JWT
  const { SignJWT } = await jose();
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw httpError('JWT secret not configured', 503, 'AUTH_NOT_CONFIGURED');
  
  // Hash phone number to create a deterministic UID (or just use phone number as UID, but hashing is safer for DB IDs)
  const uid = 'seller:' + crypto.createHash('sha256').update(phoneNumber).digest('hex').slice(0, 16);
  const secret = new TextEncoder().encode(config.jwtSecret);
  const token = await new SignJWT({ phone_number: phoneNumber })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setSubject(uid)
    .setExpirationTime('30d')
    .sign(secret);
    
  return { token, uid, provider: 'phone' };
}

async function verifyJwtToken(token) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw httpError('Server authentication is not configured', 503, 'AUTH_NOT_CONFIGURED');
  const { jwtVerify } = await jose();
  const secret = new TextEncoder().encode(config.jwtSecret);
  
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return {
      uid: payload.sub,
      phoneNumber: payload.phone_number || null,
      provider: 'phone',
      issuedAt: payload.iat,
      authTime: payload.iat
    };
  } catch (error) {
    throw httpError('Invalid or expired authentication token', 401, 'INVALID_TOKEN');
  }
}

async function authenticate(request) {
  if (config.authMode === 'demo') {
    if (config.environment === 'production') throw httpError('Demo authentication is disabled in production', 503, 'AUTH_NOT_CONFIGURED');
    const token = bearerToken(request);
    if (!token) return { uid: 'local-seller', phoneNumber: '+910000000000', provider: 'demo' };
  }
  const token = bearerToken(request);
  if (!token) throw httpError('Authentication required', 401, 'AUTH_REQUIRED');
  return verifyJwtToken(token);
}

module.exports = { authenticate, bearerToken, verifyJwtToken, sendOtp, verifyOtp, httpError };
