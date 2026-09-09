import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { AppLauncher } from '@capacitor/app-launcher';

const isNative = Capacitor.isNativePlatform();
let currentPhoneNumber = '';
let currentAuthToken = '';

// Attempt to load existing token from local storage
if (!isNative) {
  currentAuthToken = localStorage.getItem('shilpsarathi-auth-token') || '';
} else {
  Preferences.get({ key: 'shilpsarathi-auth-token' }).then(result => {
    currentAuthToken = result.value || '';
  });
}

window.SHILP_CONFIG = { apiOrigin: __SHILP_API_ORIGIN__, authMode: __SHILP_AUTH_MODE__, release: __SHILP_RELEASE__, native: isNative };

if (isNative) {
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
    if (__SHILP_AUTH_MODE__ !== 'twilio' && __SHILP_AUTH_MODE__ !== 'demo') {
      throw new Error('Real OTP is not configured.');
    }
    currentPhoneNumber = phoneNumber;
    
    // Call our backend API to send OTP via Twilio
    const apiBase = __SHILP_API_ORIGIN__ ? __SHILP_API_ORIGIN__.replace(/\/$/, '') : (location.protocol === 'file:' ? 'http://localhost:8787' : '');
    const response = await fetch(`${apiBase}/api/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber })
    });
    
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to send OTP');
    }
    
    if (isNative) {
      window.dispatchEvent(new CustomEvent('nativephonecodesent'));
    }
    return { demo: __SHILP_AUTH_MODE__ === 'demo' };
  },

  async confirmPhoneOtp(code) {
    if (__SHILP_AUTH_MODE__ !== 'twilio' && __SHILP_AUTH_MODE__ !== 'demo') {
      throw new Error('Real OTP is not configured.');
    }
    if (!currentPhoneNumber) {
      throw new Error('No phone number is currently active for verification.');
    }
    
    // Call our backend API to verify OTP via Twilio and get a custom JWT
    const apiBase = __SHILP_API_ORIGIN__ ? __SHILP_API_ORIGIN__.replace(/\/$/, '') : (location.protocol === 'file:' ? 'http://localhost:8787' : '');
    const response = await fetch(`${apiBase}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: currentPhoneNumber, code })
    });
    
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Invalid OTP');
    }
    
    if (data.token) {
      currentAuthToken = data.token;
      if (isNative) {
        await Preferences.set({ key: 'shilpsarathi-auth-token', value: data.token });
      } else {
        localStorage.setItem('shilpsarathi-auth-token', data.token);
      }
    }
    
    return data;
  },

  async getIdToken() {
    return currentAuthToken;
  },

  async isAuthenticated() {
    return Boolean(currentAuthToken);
  },

  async signOut() {
    currentPhoneNumber = '';
    currentAuthToken = '';
    if (isNative) {
      await Preferences.remove({ key: 'shilpsarathi-auth-token' });
    } else {
      localStorage.removeItem('shilpsarathi-auth-token');
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
