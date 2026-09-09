const config = require('./config');

let josePromise;
let firebaseKeySet;
let firebaseAdminAuth;
const defaultFirebaseJwksUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

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

async function verifyFirebaseToken(token) {
  if (!config.firebaseProjectId) throw httpError('Server authentication is not configured', 503, 'AUTH_NOT_CONFIGURED');
  if (config.firebaseCheckRevoked && config.firebaseJwksUrl === defaultFirebaseJwksUrl) {
    try {
      if (!firebaseAdminAuth) {
        const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
        const { getAuth } = require('firebase-admin/auth');
        const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: config.firebaseProjectId });
        firebaseAdminAuth = getAuth(app);
      }
      const payload = await firebaseAdminAuth.verifyIdToken(token, true);
      if (payload.firebase?.sign_in_provider !== 'phone') throw httpError('Phone authentication is required', 403, 'PHONE_AUTH_REQUIRED');
      return {
        uid: payload.uid,
        phoneNumber: typeof payload.phone_number === 'string' ? payload.phone_number : null,
        provider: payload.firebase.sign_in_provider,
        issuedAt: payload.iat,
        authTime: payload.auth_time
      };
    } catch (error) {
      if (error.statusCode) throw error;
      const revoked = error.code === 'auth/id-token-revoked' || error.code === 'auth/user-disabled';
      throw httpError(revoked ? 'Authentication session was revoked' : 'Invalid or expired authentication token', 401, revoked ? 'TOKEN_REVOKED' : 'INVALID_TOKEN');
    }
  }
  const { createRemoteJWKSet, jwtVerify } = await jose();
  firebaseKeySet ||= createRemoteJWKSet(new URL(config.firebaseJwksUrl), {
    cooldownDuration: 30000,
    cacheMaxAge: 60 * 60 * 1000,
    timeoutDuration: 10000
  });
  let result;
  try {
    result = await jwtVerify(token, firebaseKeySet, {
      algorithms: ['RS256'],
      audience: config.firebaseProjectId,
      issuer: `https://securetoken.google.com/${config.firebaseProjectId}`,
      clockTolerance: 5
    });
  } catch (error) {
    console.warn(`[auth] Firebase token rejected: ${error.code || 'verification_error'} ${error.message || ''}`.trim());
    throw httpError('Invalid or expired authentication token', 401, 'INVALID_TOKEN');
  }
  const { payload } = result;
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw httpError('Invalid authentication subject', 401, 'INVALID_TOKEN');
  }
  if (!Number.isFinite(payload.auth_time) || payload.auth_time > Math.floor(Date.now() / 1000) + 5) {
    throw httpError('Invalid authentication time', 401, 'INVALID_TOKEN');
  }
  if (payload.firebase?.sign_in_provider !== 'phone') throw httpError('Phone authentication is required', 403, 'PHONE_AUTH_REQUIRED');
  return {
    uid: payload.sub,
    phoneNumber: typeof payload.phone_number === 'string' ? payload.phone_number : null,
    provider: payload.firebase?.sign_in_provider || 'unknown',
    issuedAt: payload.iat,
    authTime: payload.auth_time
  };
}

async function authenticate(request) {
  if (config.authMode === 'demo') {
    if (config.environment === 'production') throw httpError('Demo authentication is disabled in production', 503, 'AUTH_NOT_CONFIGURED');
    return { uid: 'local-seller', phoneNumber: '+910000000000', provider: 'demo' };
  }
  const token = bearerToken(request);
  if (!token) throw httpError('Authentication required', 401, 'AUTH_REQUIRED');
  return verifyFirebaseToken(token);
}

module.exports = { authenticate, bearerToken, verifyFirebaseToken, httpError };
