import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { AppLauncher } from '@capacitor/app-launcher';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

const isNative = Capacitor.isNativePlatform();
let verificationId = '';
let webAuth;
let webAuthModule;
let webConfirmation;
let recaptchaVerifier;
let verifiedWebUser;
let verifiedWebIdToken = '';

const firebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

async function getWebAuth() {
  if (isNative) return null;
  if (Object.values(firebaseWebConfig).some(value => !value)) throw new Error('Firebase web OTP is not configured. Add the Firebase web app settings before testing login.');
  if (!webAuth) {
    const appModule = await import('firebase/app');
    webAuthModule = await import('firebase/auth');
    const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseWebConfig);
    webAuth = webAuthModule.getAuth(app);
    // This Vite development-only flag enables Firebase's official mock
    // reCAPTCHA flow for phone numbers explicitly allowlisted in Firebase.
    // Production builds do not receive this local environment value.
    if (import.meta.env.VITE_FIREBASE_TEST_MODE === 'true') {
      webAuth.settings.appVerificationDisabledForTesting = true;
    }
    await webAuth.authStateReady();
  }
  return webAuth;
}

function clearWebRecaptcha() {
  recaptchaVerifier?.clear();
  recaptchaVerifier = null;
}

window.SHILP_CONFIG = { apiOrigin: __SHILP_API_ORIGIN__, authMode: __SHILP_AUTH_MODE__, release: __SHILP_RELEASE__, native: isNative };

if (isNative) {
  FirebaseAuthentication.addListener('phoneCodeSent', event => {
    verificationId = event.verificationId;
    window.dispatchEvent(new CustomEvent('nativephonecodesent'));
  });
  FirebaseAuthentication.addListener('phoneVerificationFailed', event => {
    window.dispatchEvent(new CustomEvent('nativeautherror', { detail: event.message || 'Phone verification failed' }));
  });
  FirebaseAuthentication.addListener('phoneVerificationCompleted', () => {
    window.dispatchEvent(new CustomEvent('nativephoneverified'));
  });
  Network.addListener('networkStatusChange', status => {
    window.dispatchEvent(new Event(status.connected ? 'online' : 'offline'));
  });
}

window.NativeBridge = {
  isNative,
  release: __SHILP_RELEASE__,
  apiOrigin: __SHILP_API_ORIGIN__,
  authMode: __SHILP_AUTH_MODE__,

  async capturePhoto(source = 'camera') {
    if (!isNative) return null;
    const result = await Camera.getPhoto({
      source: source === 'gallery' ? CameraSource.Photos : CameraSource.Camera,
      resultType: CameraResultType.DataUrl,
      quality: 88,
      width: 1600,
      height: 1600,
      correctOrientation: true,
      allowEditing: false,
      saveToGallery: false,
      promptLabelHeader: 'Product photo'
    });
    return result.dataUrl || null;
  },

  async savePreference(key, value) {
    if (isNative) await Preferences.set({ key, value: String(value) });
  },

  async sendPhoneOtp(phoneNumber, resendCode = false) {
    if (__SHILP_AUTH_MODE__ !== 'firebase') throw new Error('Real OTP is not configured. Enable Firebase authentication; demo codes are disabled.');
    verificationId = '';
    const languageCode = localStorage.getItem('shilpsarathi-seller-language') || 'hi';
    if (isNative) {
      await FirebaseAuthentication.setLanguageCode({ languageCode });
      await FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber, timeout: 60, resendCode });
    } else {
      const auth = await getWebAuth();
      auth.languageCode = languageCode;
      clearWebRecaptcha();
      recaptchaVerifier = new webAuthModule.RecaptchaVerifier(auth, 'firebase-recaptcha', { size: 'invisible' });
      webConfirmation = await webAuthModule.signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
      window.dispatchEvent(new CustomEvent('nativephonecodesent'));
    }
    return { demo: false };
  },

  async confirmPhoneOtp(code) {
    if (__SHILP_AUTH_MODE__ !== 'firebase') throw new Error('Real OTP is not configured. Demo codes are disabled.');
    if (isNative) {
      if (!verificationId) throw new Error('Verification session expired. Request a new OTP.');
      return FirebaseAuthentication.confirmVerificationCode({ verificationId, verificationCode: code });
    }
    if (!webConfirmation) throw new Error('Verification session expired. Request a new OTP.');
    const result = await webConfirmation.confirm(code);
    // Keep the just-verified user and token available immediately. Firebase can
    // update auth.currentUser asynchronously in some mobile browsers, while the
    // next screen may submit the seller profile straight away.
    verifiedWebUser = result.user;
    verifiedWebIdToken = await result.user.getIdToken(true);
    webConfirmation = null;
    clearWebRecaptcha();
    return result;
  },

  async getIdToken() {
    if (__SHILP_AUTH_MODE__ !== 'firebase') return '';
    if (isNative) {
      const result = await FirebaseAuthentication.getIdToken();
      return result.token || '';
    }
    const auth = await getWebAuth();
    const user = auth.currentUser || verifiedWebUser;
    if (!user) return verifiedWebIdToken;
    verifiedWebIdToken = await user.getIdToken();
    return verifiedWebIdToken;
  },

  async isAuthenticated() {
    if (__SHILP_AUTH_MODE__ !== 'firebase') return false;
    if (isNative) {
      const result = await FirebaseAuthentication.getCurrentUser();
      return Boolean(result.user?.uid);
    }
    return Boolean((await getWebAuth()).currentUser?.uid || verifiedWebUser?.uid);
  },

  async signOut() {
    verificationId = '';
    webConfirmation = null;
    verifiedWebUser = null;
    verifiedWebIdToken = '';
    clearWebRecaptcha();
    if (__SHILP_AUTH_MODE__ !== 'firebase') return;
    if (isNative) await FirebaseAuthentication.signOut();
    else {
      const auth = await getWebAuth();
      await webAuthModule.signOut(auth);
    }
  },

  async openWhatsApp(text) {
    const nativeUrl = `whatsapp://send?text=${encodeURIComponent(text)}`;
    if (isNative) {
      const available = await AppLauncher.canOpenUrl({ url: 'whatsapp://send' });
      if (available.value) return AppLauncher.openUrl({ url: nativeUrl });
    }
    window.location.assign(`https://wa.me/?text=${encodeURIComponent(text)}`);
  },

  async openMapsSearch(query, coordinates = null) {
    const locationQuery = coordinates
      ? `${query} near ${coordinates.latitude},${coordinates.longitude}`
      : `${query} near me`;
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery)}`;
    if (isNative && coordinates) {
      const geoUrl = `geo:${coordinates.latitude},${coordinates.longitude}?q=${encodeURIComponent(locationQuery)}`;
      const available = await AppLauncher.canOpenUrl({ url: 'geo:0,0' });
      if (available.value) return AppLauncher.openUrl({ url: geoUrl });
    }
    window.location.assign(webUrl);
  }
};

window.dispatchEvent(new CustomEvent('nativebridgeready'));
