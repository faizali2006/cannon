const screens = [...document.querySelectorAll('.screen')];
const keys = {
  language: 'shilpsarathi-seller-language', authenticated: 'shilpsarathi-seller-authenticated',
  phone: 'shilpsarathi-seller-phone', name: 'shilpsarathi-seller-name',
  legalConsent: 'shilpsarathi-seller-legal-consent-v1', cookies: 'shilpsarathi-optional-cookies'
};
const read = (key, fallback = '') => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (e) { console.warn('Storage write error:', e); /* Audit optimization: Explicit error logging */ } window.NativeBridge?.savePreference?.(key, String(value)).catch(e => console.warn('NativeBridge save error:', e) /* Audit optimization: Explicit error logging */); };
const remove = key => { try { localStorage.removeItem(key); } catch (e) { console.warn('Storage remove error:', e); /* Audit optimization: Explicit error logging */ } };
let currentScreen = 'language-screen';
let legalReturnScreen = 'home-screen';
let locale = read(keys.language, 'hi');
let capturedImage = '';
let currentProduct = null;
let mediaRecorder = null;
let mediaStream = null;
let recordedAudio = '';
let recordingStartedAt = 0;
let recordingTimer = null;
const numberLocales = { hi: 'hi-IN', en: 'en-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN', ml: 'ml-IN' };
const formatCurrency = value => new Intl.NumberFormat(numberLocales[locale] || 'en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));

function showScreen(id) {
  window.VoiceGuide?.stop();
  currentScreen = id;
  screens.forEach(screen => screen.classList.toggle('active', screen.id === id));
  const screen = document.getElementById(id);
  screen?.setAttribute('tabindex', '-1');
  screen?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.go === 'camera-screen' && ['home-screen', 'inventory-screen'].includes(currentScreen)) resetCapturedPhoto();
  showScreen(button.dataset.go);
}));

const toast = document.getElementById('toast');
let toastTimer;
function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = I18N.t(message, locale);
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function applyLanguage(nextLocale) {
  locale = nextLocale;
  write(keys.language, locale);
  I18N.apply(locale);
  document.querySelectorAll('[data-language]').forEach(button => {
    const selected = button.dataset.language === locale;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.getElementById('language-continue').disabled = false;
  document.querySelectorAll('.brand-header small, .app-header small').forEach(node => { node.textContent = I18N.t('विक्रेता', locale); });
  document.querySelector('#login-screen header strong').textContent = I18N.t('विक्रेता', locale);
  document.querySelector('#profile-screen header strong').textContent = I18N.t('मेरी प्रोफ़ाइल', locale);
  renderProfile();
}

document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  applyLanguage(button.dataset.language);
  VoiceGuide.previewLanguage(locale, button);
}));
document.getElementById('language-continue').addEventListener('click', () => showScreen(read(keys.authenticated) === 'true' ? 'home-screen' : 'login-screen'));
document.getElementById('language-button').addEventListener('click', () => showScreen('language-screen'));

const phoneStep = document.getElementById('phone-step');
const otpStep = document.getElementById('otp-step');
const nameStep = document.getElementById('name-step');
const phoneInput = document.getElementById('phone-input');
const otpInput = document.getElementById('otp-input');
const nameInput = document.getElementById('name-input');
const loginError = document.getElementById('login-error');
const legalConsent = document.getElementById('legal-consent');
const resendOtpButton = document.getElementById('resend-otp');
let loginStage = 'phone';
let resendTimer;

function startResendCooldown(seconds = 30) {
  clearInterval(resendTimer);
  const availableAt = Date.now() + seconds * 1000;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((availableAt - Date.now()) / 1000));
    resendOtpButton.disabled = remaining > 0;
    resendOtpButton.textContent = remaining > 0 ? `${I18N.t('OTP दोबारा भेजें', locale)} (${remaining})` : I18N.t('OTP दोबारा भेजें', locale);
    if (!remaining) clearInterval(resendTimer);
  };
  update();
  resendTimer = setInterval(update, 1000);
}

function speakLoginGuide() {
  VoiceGuide.speak(`login_${loginStage}`, locale, document.getElementById('login-voice'));
}
document.getElementById('login-voice').addEventListener('click', speakLoginGuide);

function setLoginStage(stage) {
  loginStage = stage;
  if (stage === 'phone') {
    clearInterval(resendTimer);
    resendOtpButton.disabled = false;
    resendOtpButton.textContent = I18N.t('OTP दोबारा भेजें', locale);
  }
  phoneStep.hidden = stage !== 'phone'; otpStep.hidden = stage !== 'otp'; nameStep.hidden = stage !== 'name';
  loginError.textContent = '';
  const instructions = { phone: 'हम आपके नंबर पर एक सुरक्षित OTP भेजेंगे।', otp: '6 अंकों का OTP', name: 'हमें बताएं कि आपको किस नाम से बुलाएं।' };
  document.getElementById('login-instruction').textContent = I18N.t(instructions[stage], locale);
  setTimeout(() => ({ phone: phoneInput, otp: otpInput, name: nameInput }[stage]).focus(), 50);
}
phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 10); loginError.textContent = ''; });
otpInput.addEventListener('input', () => { otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6); loginError.textContent = ''; });

document.getElementById('send-otp').addEventListener('click', async () => {
  if (!/^[6-9]\d{9}$/.test(phoneInput.value)) return void (loginError.textContent = I18N.t('कृपया 10 अंकों का सही मोबाइल नंबर डालें।', locale));
  if (!legalConsent.checked) return void (loginError.textContent = I18N.t('जारी रखने के लिए सहमति चुनें।', locale));
  try { await NativeBridge.sendPhoneOtp(`+91${phoneInput.value}`); setLoginStage('otp'); startResendCooldown(); notify('OTP भेजा गया'); }
  catch (error) { loginError.textContent = error.message || I18N.t('OTP नहीं भेजा गया।', locale); }
});
document.getElementById('edit-phone').addEventListener('click', () => setLoginStage('phone'));
resendOtpButton.addEventListener('click', async () => { try { await NativeBridge.sendPhoneOtp(`+91${phoneInput.value}`, true); startResendCooldown(); notify('OTP दोबारा भेजा गया।'); } catch (error) { resendOtpButton.disabled = false; loginError.textContent = error.message || I18N.t('OTP नहीं भेजा गया।', locale); } });
document.getElementById('verify-otp').addEventListener('click', async () => {
  if (!/^\d{6}$/.test(otpInput.value)) return void (loginError.textContent = I18N.t('कृपया 6 अंकों का OTP डालें।', locale));
  try { await NativeBridge.confirmPhoneOtp(otpInput.value); setLoginStage('name'); }
  catch (error) { loginError.textContent = error.message || I18N.t('OTP सत्यापित नहीं हुआ।', locale); }
});
window.addEventListener('nativeautherror', event => {
  clearInterval(resendTimer);
  resendOtpButton.disabled = false;
  resendOtpButton.textContent = I18N.t('OTP दोबारा भेजें', locale);
  loginError.textContent = event.detail || I18N.t('फोन सत्यापन विफल हुआ।', locale);
});
window.addEventListener('nativephoneverified', () => setLoginStage('name'));
document.getElementById('complete-login').addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (name.length < 2) return void (loginError.textContent = I18N.t('कृपया अपना नाम लिखें।', locale));
  const consent = { version: '2026-09-07', acceptedAt: new Date().toISOString() };
  try {
    await ShilpAPI.updateProfile({ displayName: name, preferredLanguage: locale, consentVersion: consent.version, consentAcceptedAt: consent.acceptedAt });
    write(keys.phone, phoneInput.value); write(keys.name, name); write(keys.authenticated, 'true');
    write(keys.legalConsent, JSON.stringify(consent));
    renderProfile(); showScreen('home-screen');
  } catch (error) {
    loginError.textContent = error.message || I18N.t('फोन सत्यापन विफल हुआ।', locale);
  }
});

document.getElementById('profile-button').addEventListener('click', () => { renderProfile(); showScreen('profile-screen'); });
function renderProfile() {
  const name = read(keys.name, I18N.t('कारीगर', locale));
  document.getElementById('seller-greeting').textContent = `${I18N.t('नमस्ते', locale)}, ${name}`;
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-phone').textContent = read(keys.phone) ? `+91 ${read(keys.phone)}` : I18N.t('अभी उपलब्ध नहीं', locale);
  document.querySelector('#profile-screen .profile-list > div:last-child dd').textContent = I18N.t('विक्रेता', locale);
}
document.getElementById('logout-button').addEventListener('click', async () => {
  await NativeBridge.signOut().catch(e => console.warn('SignOut error:', e) /* Audit optimization: Explicit error logging */);
  [keys.authenticated, keys.phone, keys.name, keys.legalConsent].forEach(remove);
  phoneInput.value = ''; otpInput.value = ''; nameInput.value = ''; legalConsent.checked = false;
  setLoginStage('phone'); showScreen('language-screen');
});

document.querySelectorAll('[data-guide]').forEach(button => button.addEventListener('click', () => VoiceGuide.toggle(button.dataset.guide, locale, button)));

const exhibitionsStatus = document.getElementById('exhibitions-status');
document.getElementById('find-exhibitions').addEventListener('click', () => {
  const openNearbySearch = async position => {
    if (position) exhibitionsStatus.textContent = I18N.t('स्थान मिल गया। आस-पास के कार्यक्रम खोले जा रहे हैं।', locale);
    await NativeBridge.openMapsSearch('handicraft exhibitions and craft fairs', position?.coords || null);
  };
  if (!navigator.geolocation) return openNearbySearch(null);
  navigator.geolocation.getCurrentPosition(openNearbySearch, () => {
    exhibitionsStatus.textContent = I18N.t('स्थान नहीं मिला। फ़ोन की स्थान अनुमति जाँचें।', locale);
    openNearbySearch(null);
  }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
});

const cameraPreview = document.getElementById('camera-preview');
const cameraPlaceholder = document.getElementById('camera-placeholder');
const originalImage = document.getElementById('listing-original-image');
const enhancedImage = document.getElementById('listing-enhanced-image');
const fileInput = document.getElementById('product-photo-input');
const cameraInput = document.getElementById('camera-photo-input');
function displayPhoto(dataUrl) { capturedImage = dataUrl; cameraPreview.src = dataUrl; cameraPreview.hidden = false; cameraPlaceholder.hidden = true; originalImage.src = dataUrl; }
function resetCapturedPhoto() {
  capturedImage = '';
  cameraPreview.removeAttribute('src');
  cameraPreview.hidden = true;
  cameraPlaceholder.hidden = false;
  fileInput.value = '';
  cameraInput.value = '';
  currentProduct = null;
  textInput.value = '';
  speechTranscript = '';
  document.getElementById('text-description-count').textContent = '0';
}
async function readSelectedPhoto(input) {
  const file = input.files?.[0];
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) return notify('कृपया 12 MB से छोटी JPG, PNG या WebP तस्वीर चुनें');
  displayPhoto(await ShilpAPI.blobToDataUrl(file));
  input.value = '';
}
document.getElementById('select-product-photo').addEventListener('click', async () => {
  if (NativeBridge.isNative) { try { const photo = await NativeBridge.capturePhoto('gallery'); if (photo) displayPhoto(photo); } catch (e) { console.warn('Gallery capture error:', e); /* Audit optimization: Explicit error logging */ } }
  else fileInput.click();
});
fileInput.addEventListener('change', () => readSelectedPhoto(fileInput));
cameraInput.addEventListener('change', () => readSelectedPhoto(cameraInput));
document.getElementById('take-photo').addEventListener('click', async () => {
  if (!NativeBridge.isNative) return cameraInput.click();
  try { const photo = await NativeBridge.capturePhoto('camera'); if (photo) displayPhoto(photo); } catch { notify('कैमरा नहीं खुला।'); }
});
document.getElementById('photo-continue').addEventListener('click', async () => {
  if (!capturedImage) return notify('पहले उत्पाद की असली तस्वीर चुनें।');
  showScreen('voice-screen');
});

const recordButton = document.getElementById('voice-button');
const recordLabel = document.getElementById('voice-label');
const recordTime = document.getElementById('recording-time');
const recordingActions = document.getElementById('recording-actions');
const recordingStatus = document.getElementById('recording-status');
const textPanel = document.getElementById('text-description-panel');
const textInput = document.getElementById('text-description-input');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognition = null;
let speechTranscript = '';
let recording = false;
function updateRecordTime() { const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000); recordTime.textContent = `${String(Math.floor(elapsed / 60)).padStart(2,'0')}:${String(elapsed % 60).padStart(2,'0')}`; }
function finishSpeechRecognition() {
  clearInterval(recordingTimer);
  recording = false;
  recordButton.classList.remove('recording');
  recordLabel.textContent = I18N.t('रिकॉर्डिंग पूरी हुई', locale);
  const recognizedText = textInput.value.trim() || speechTranscript.trim();
  if (recognizedText) {
    speechTranscript = recognizedText;
    textInput.value = recognizedText;
    document.getElementById('text-description-count').textContent = textInput.value.length;
    textPanel.hidden = false;
    recordingActions.hidden = false;
    recordingStatus.textContent = I18N.t('रिकॉर्डिंग सुरक्षित है।', locale);
  } else {
    recordLabel.textContent = I18N.t('रिकॉर्डिंग शुरू करें', locale);
    recordingStatus.textContent = I18N.t('आवाज़ साफ नहीं मिली। फिर से बोलें या विवरण लिखें।', locale);
  }
}
function startRecording() {
  VoiceGuide.stop();
  if (!SpeechRecognition) return notify('इस ब्राउज़र में आवाज़ से लिखना उपलब्ध नहीं है। Chrome इस्तेमाल करें।');
  speechTranscript = '';
  textInput.value = '';
  recordedAudio = '';
  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'hi-IN';
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.onresult = event => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const words = event.results[index][0].transcript;
      if (event.results[index].isFinal) speechTranscript += `${words} `;
      else interim += words;
    }
    textInput.value = `${speechTranscript}${interim}`.trim();
    document.getElementById('text-description-count').textContent = textInput.value.length;
  };
  speechRecognition.onerror = event => {
    recordingStatus.textContent = event.error === 'not-allowed'
      ? I18N.t('माइक्रोफोन की अनुमति दें और फिर कोशिश करें।', locale)
      : I18N.t('आवाज़ साफ नहीं मिली। फिर से बोलें या विवरण लिखें।', locale);
  };
  speechRecognition.onend = finishSpeechRecognition;
  try {
    speechRecognition.start();
    recording = true;
    recordingStartedAt = Date.now();
    recordButton.classList.add('recording');
    recordLabel.textContent = I18N.t('रिकॉर्डिंग रोकें', locale);
    recordingStatus.textContent = I18N.t('रिकॉर्डिंग चल रही है।', locale);
    recordingActions.hidden = true;
    updateRecordTime();
    recordingTimer = setInterval(updateRecordTime, 1000);
  } catch { notify('माइक्रोफोन उपलब्ध नहीं है। विवरण लिखें।'); }
}
function stopRecording() {
  if (!recording) return;
  const activeRecognition = speechRecognition;
  speechRecognition = null;
  if (activeRecognition) {
    activeRecognition.onend = null;
    try { activeRecognition.stop(); } catch (e) { console.warn('Speech stop error:', e); /* Audit optimization: Explicit error logging */ }
    setTimeout(() => { try { activeRecognition.abort(); } catch (e) { console.warn('Speech abort error:', e); /* Audit optimization: Explicit error logging */ } }, 400);
  }
  finishSpeechRecognition();
}
recordButton.addEventListener('click', () => recording ? stopRecording() : startRecording());
document.getElementById('redo-recording').addEventListener('click', startRecording);
document.getElementById('open-text-description').addEventListener('click', () => { if (recording) stopRecording(); textPanel.hidden = false; textInput.focus(); });
document.getElementById('cancel-text-description').addEventListener('click', () => { textPanel.hidden = true; });
textInput.addEventListener('input', () => { document.getElementById('text-description-count').textContent = textInput.value.length; });
document.getElementById('continue-recording').addEventListener('click', () => { const text = textInput.value.trim(); if (text.length < 5) return notify('कृपया उत्पाद के बारे में थोड़ा और लिखें'); createListing(text); });
document.getElementById('continue-text-description').addEventListener('click', () => { const text = textInput.value.trim(); if (text.length < 5) return notify('कृपया उत्पाद के बारे में थोड़ा और लिखें'); createListing(text); });

function mediaUrl(url) { return url?.startsWith('/') ? `${ShilpAPI.serviceOrigin}${url}` : url; }
async function createListing(transcript) {
  if (recording) stopRecording();
  showScreen('ai-processing-screen');
  try {
    const result = await ShilpAPI.generateListing({ imageDataUrl: capturedImage, audioDataUrl: transcript ? null : recordedAudio || null, transcript: transcript || undefined, language: locale, status: 'draft' });
    currentProduct = result.product; renderProduct(); showScreen('ready-screen');
    
    // Auto-trigger dynamic AI pricing
    const spinner = document.getElementById('dynamic-price-spinner');
    document.getElementById('calculating-price-text').textContent = 'Calculating price...';
    spinner.style.display = 'flex';
    const pricingDl = document.querySelector('.listing-copy dl');
    const priceReason = document.getElementById('generated-price-reason');
    if (pricingDl) pricingDl.hidden = true;
    if (priceReason) priceReason.hidden = true;
    try {
      const desc = currentProduct.descriptionEn || currentProduct.descriptionHi || '';
      const aiPrice = await ShilpAPI.suggestPriceFree(capturedImage, desc);
      currentProduct = (await ShilpAPI.updateProduct(currentProduct.id, {
        priceMin: aiPrice.price_range.min,
        priceSuggested: aiPrice.suggested_price,
        priceMax: aiPrice.price_range.max,
        pricingExplanation: aiPrice.breakdown_reasoning
      })).product;
      currentProduct.itemClassification = aiPrice.item_classification;
      renderProduct();
    } catch (err) {
      console.error("Gemini API Error Detail:", err);
      notify(I18N.t('AI pricing estimation failed. Please check your connection or try again.', locale));
    } finally {
      spinner.style.display = 'none';
      if (pricingDl) pricingDl.hidden = false;
      if (priceReason) priceReason.hidden = false;
    }
    
  } catch (error) {
    showScreen('voice-screen');
    const message = error.code === 'AI_IMAGE_QUOTA_UNAVAILABLE'
      ? I18N.t('AI तस्वीर सेवा अभी उपलब्ध नहीं है। कुछ देर बाद फिर कोशिश करें।', locale)
      : error.code === 'AI_IMAGE_ENHANCEMENT_FAILED'
        ? I18N.t('तस्वीर साफ नहीं हुई। कृपया फिर कोशिश करें।', locale)
        : error.queuedOffline ? 'इंटरनेट आने पर लिस्टिंग अपने आप तैयार होगी' : (error.message || 'लिस्टिंग तैयार नहीं हुई—फिर से कोशिश करें');
    notify(I18N.t(message, locale));
  }
}
function renderProduct() {
  if (!currentProduct) return;
  const english = locale === 'en';
  let title = (english ? currentProduct.titleEn : currentProduct.titleHi) || currentProduct.titleEn || currentProduct.titleHi || 'उत्पाद';
  if (currentProduct.itemClassification === 'Mass-Produced') {
    title = title.replace('Handmade Product — ', 'Product — ').replace('हस्तनिर्मित उत्पाद — ', 'उत्पाद — ');
    document.getElementById('mass-produced-warning').hidden = false;
  } else {
    document.getElementById('mass-produced-warning').hidden = true;
  }
  const description = (english ? currentProduct.descriptionEn : currentProduct.descriptionHi) || currentProduct.descriptionEn || currentProduct.descriptionHi || '';
  const titleText = english ? title : I18N.t(title, locale);
  const titleEl = document.getElementById('generated-title');
  if (titleEl.textContent !== titleText) titleEl.textContent = titleText; /* Audit optimization: Avoid redundant DOM text mutation */

  const descriptionText = english ? description : I18N.t(description, locale);
  const descEl = document.getElementById('generated-description');
  if (descEl.textContent !== descriptionText) descEl.textContent = descriptionText; /* Audit optimization: Avoid redundant DOM text mutation */

  const materials = document.getElementById('generated-materials'); 
  const newMaterials = (currentProduct.materials || []).slice(0,3).map(value => I18N.t(value, locale));
  const currentMaterials = Array.from(materials.children).map(el => el.textContent);
  if (JSON.stringify(newMaterials) !== JSON.stringify(currentMaterials)) {
    /* Audit optimization: Use DocumentFragment */
    const frag = document.createDocumentFragment();
    newMaterials.forEach(value => { const span = document.createElement('span'); span.textContent = value; frag.append(span); });
    materials.replaceChildren(frag);
  }

  const priceEl = document.getElementById('generated-price');
  const newPrice = formatCurrency(currentProduct.priceSuggested);
  if (priceEl.textContent !== newPrice) priceEl.textContent = newPrice;

  const rangeEl = document.getElementById('generated-price-range');
  const newRange = `${formatCurrency(currentProduct.priceMin || currentProduct.priceSuggested)} - ${formatCurrency(currentProduct.priceMax || currentProduct.priceSuggested)}`;
  if (rangeEl.textContent !== newRange) rangeEl.textContent = newRange;

  const reasonEl = document.getElementById('generated-price-reason');
  const newReason = I18N.t(currentProduct.pricingExplanation || '', locale);
  if (reasonEl.textContent !== newReason) reasonEl.textContent = newReason;

  const newOriginalSrc = mediaUrl(currentProduct.originalImageUrl) || capturedImage;
  if (originalImage.getAttribute('src') !== newOriginalSrc) originalImage.src = newOriginalSrc;

  const newEnhancedSrc = mediaUrl(currentProduct.enhancedImageUrl) || capturedImage;
  if (enhancedImage.getAttribute('src') !== newEnhancedSrc) enhancedImage.src = newEnhancedSrc;

  const afterLabelEl = document.getElementById('after-image-label');
  const newAfterLabel = I18N.t(currentProduct.enhancedImageUrl && currentProduct.enhancedImageUrl !== currentProduct.originalImageUrl ? 'साफ तस्वीर' : 'मूल तस्वीर', locale);
  if (afterLabelEl.textContent !== newAfterLabel) afterLabelEl.textContent = newAfterLabel;
}

const priceDialog = document.getElementById('price-dialog');
document.getElementById('edit-generated-price').addEventListener('click', () => { if (!currentProduct) return; document.getElementById('price-min-input').value = currentProduct.priceMin || ''; document.getElementById('price-best-input').value = currentProduct.priceSuggested || ''; document.getElementById('price-max-input').value = currentProduct.priceMax || ''; priceDialog.showModal(); });
document.getElementById('save-price-range').addEventListener('click', async () => {
  const minimum = Number(document.getElementById('price-min-input').value), best = Number(document.getElementById('price-best-input').value), maximum = Number(document.getElementById('price-max-input').value);
  if (![minimum,best,maximum].every(Number.isFinite) || minimum < 1 || minimum > best || best > maximum) return notify('कीमत क्रम सही रखें: न्यूनतम ≤ अच्छी ≤ अधिकतम');
  try { currentProduct = (await ShilpAPI.updateProduct(currentProduct.id, { priceMin: minimum, priceSuggested: best, priceMax: maximum })).product; renderProduct(); priceDialog.close(); } catch { notify('कीमत नहीं बदली—सर्वर जाँचें'); }
});

document.getElementById('share-button').addEventListener('click', async () => { if (!currentProduct) return; try { const share = await ShilpAPI.shareProduct(currentProduct.id); await NativeBridge.openWhatsApp(share.text); } catch { notify(I18N.t('WhatsApp नहीं खुला—फिर से कोशिश करें', locale)); } });
document.getElementById('save-listing').addEventListener('click', async () => { if (!currentProduct) return; try { currentProduct = (await ShilpAPI.updateProduct(currentProduct.id, { status: 'ready' })).product; await loadInventory(); showScreen('inventory-screen'); } catch { notify(I18N.t('उत्पाद नहीं सहेजा—सर्वर जाँचें', locale)); } });
async function loadInventory() {
  const list = document.getElementById('inventory-list');
  try {
    const { products } = await ShilpAPI.listProducts();
    if (!products.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = I18N.t('अभी कोई उत्पाद नहीं है।', locale); return void list.replaceChildren(empty); }
    /* Audit optimization: Use DocumentFragment for list injection */
    const frag = document.createDocumentFragment();
    products.forEach(product => { const item = document.createElement('article'); item.className = 'inventory-product'; const image = document.createElement('img'); image.src = mediaUrl(product.enhancedImageUrl || product.originalImageUrl) || 'assets/indigo-dupatta-720.jpg'; image.alt = product.titleEn || product.titleHi || I18N.t('उत्पाद तस्वीर', locale); const copy = document.createElement('div'); const title = document.createElement('strong'); const titleText = (locale === 'en' ? product.titleEn : product.titleHi) || product.titleEn || product.titleHi || I18N.t('उत्पाद', locale); title.textContent = locale === 'en' ? titleText : I18N.t(titleText, locale); const price = document.createElement('small'); price.textContent = product.priceSuggested ? formatCurrency(product.priceSuggested) : I18N.t('कीमत उपलब्ध नहीं', locale); copy.append(title, price); item.append(image, copy); frag.append(item); });
    list.replaceChildren(frag);
  } catch { const failed = document.createElement('p'); failed.className = 'empty-state'; failed.textContent = I18N.t('उत्पाद लोड नहीं हुए।', locale); list.replaceChildren(failed); }
}
document.querySelectorAll('[data-go="inventory-screen"]').forEach(button => button.addEventListener('click', loadInventory));

document.querySelectorAll('[data-legal]').forEach(button => button.addEventListener('click', () => { legalReturnScreen = currentScreen; showScreen(`${button.dataset.legal}-screen`); }));
document.querySelectorAll('[data-legal-close]').forEach(button => button.addEventListener('click', () => showScreen(legalReturnScreen)));
const business = window.SHILP_BUSINESS || {};
let businessComplete = true;
document.querySelectorAll('[data-business]').forEach(node => { const value = business[node.dataset.business]; node.textContent = value || 'Required before release'; if (!value) businessComplete = false; });
if (businessComplete) document.getElementById('business-warning').hidden = true;
const cookieBanner = document.getElementById('cookie-banner');
if (business.optionalCookiesEnabled && !read(keys.cookies)) {
  cookieBanner.hidden = false;
  setTimeout(() => document.getElementById('reject-cookies').focus(), 0);
}
document.getElementById('reject-cookies').addEventListener('click', () => { write(keys.cookies, 'rejected'); cookieBanner.hidden = true; });
document.getElementById('accept-cookies').addEventListener('click', () => { write(keys.cookies, 'accepted'); cookieBanner.hidden = true; });

applyLanguage(locale);
phoneInput.value = read(keys.phone); nameInput.value = read(keys.name);
renderProfile();

window.addEventListener('authenticationrequired', async () => {
  await NativeBridge.signOut().catch(e => console.warn('SignOut error on auth requirement:', e) /* Audit optimization: Explicit error logging */);
  [keys.authenticated, keys.phone, keys.name].forEach(remove);
  setLoginStage('phone');
  showScreen('login-screen');
});

async function restoreSession() {
  if (read(keys.authenticated) !== 'true') return showScreen('language-screen');
  try {
    if (!(await NativeBridge.isAuthenticated())) throw new Error('Authentication expired');
    const { profile } = await ShilpAPI.getProfile();
    if (profile?.displayName) write(keys.name, profile.displayName);
    if (profile?.phoneNumber) write(keys.phone, profile.phoneNumber.replace(/^\+91/, ''));
    renderProfile();
    showScreen('home-screen');
  } catch {
    [keys.authenticated, keys.phone, keys.name].forEach(remove);
    setLoginStage('phone');
    showScreen('language-screen');
  }
}

restoreSession();
