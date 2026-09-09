/*
 * Reliable multilingual voice guidance.
 *
 * Primary path: compact MP3 clips bundled with the app and loaded only after
 * a tap. This is deterministic, works offline, and does not depend on voices
 * installed on the evaluator's phone.
 *
 * Fallback path: the Android/browser speech engine, used only if a bundled
 * asset is unexpectedly missing or cannot be played.
 */
(function () {
  const guideSourceKeys = {
    home_intro: 'नया उत्पाद बनाने के लिए नारंगी बटन दबाएँ।',
    home_tip: 'उत्पाद को साफ़ जगह पर रखें, तस्वीर और अच्छी आएगी।',
    camera_help: 'उत्पाद को बीच में रखें और तस्वीर लेने के लिए गोल बटन दबाएँ।',
    voice_help: 'माइक दबाएँ, अपने उत्पाद के बारे में बोलें, फिर दोबारा दबाकर रोकें।',
    ready_help: 'आपका उत्पाद तैयार है। कीमत देखें और व्हाट्सऐप पर साझा करें।',
    inventory_help: 'यहाँ आपके सभी उत्पाद हैं। नया उत्पाद बनाने के लिए नारंगी बटन दबाएँ।',
    login_phone: 'अपना दस अंकों का मोबाइल नंबर लिखें। नियम और गोपनीयता नीति पढ़कर सहमति चुनें। फिर ओ टी पी भेजें बटन दबाएँ।',
    login_otp: 'संदेश में मिला छह अंकों का ओ टी पी लिखें। फिर सत्यापित करें बटन दबाएँ।',
    login_name: 'अपना पूरा नाम लिखें। फिर सेलर ऐप खोलें बटन दबाएँ।',
    language_selected: 'नमस्ते। आपने हिन्दी चुनी है।'
  };

  const localeTags = {
    hi: 'hi-IN',
    en: 'en-IN',
    mr: 'mr-IN',
    ta: 'ta-IN',
    te: 'te-IN',
    kn: 'kn-IN',
    bn: 'bn-IN',
    gu: 'gu-IN',
    pa: 'pa-IN',
    ml: 'ml-IN'
  };

  const speech = window.speechSynthesis;
  const audio = new Audio();
  const status = document.getElementById('voice-status');
  audio.preload = 'none';

  let activeGuide = null;
  let activeLocale = null;
  let activeTrigger = null;
  let activeUtterance = null;
  let requestId = 0;

  function announce(messageKey, state) {
    const message = I18N.t(messageKey);
    if (status) status.textContent = message;
    window.dispatchEvent(new CustomEvent('voiceguidancestatus', {
      detail: { messageKey, message, state }
    }));
  }

  function updateButtons(trigger) {
    document.querySelectorAll('.voice-control, .voice-trigger, .language-preview, .onboarding-language-choice').forEach(button => {
      const speaking = button === trigger;
      button.classList.toggle('speaking', speaking);
      button.setAttribute('aria-pressed', String(speaking));
    });
  }

  function clearAudioHandlers() {
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
  }

  function clearActive() {
    updateButtons(null);
    activeGuide = null;
    activeLocale = null;
    activeTrigger = null;
    activeUtterance = null;
  }

  function stop() {
    requestId += 1;
    clearAudioHandlers();
    audio.pause();
    try { audio.currentTime = 0; } catch (_) {}
    if (speech && (speech.speaking || speech.pending)) speech.cancel();
    clearActive();
    if (status) status.textContent = '';
  }

  function chooseNativeVoice(locale) {
    if (!speech) return null;
    const requestedTag = localeTags[locale] || localeTags.hi;
    const requestedLanguage = requestedTag.split('-')[0].toLowerCase();
    const candidates = speech.getVoices().filter(voice => {
      const voiceTag = voice.lang.toLowerCase().replace('_', '-');
      return voiceTag === requestedTag.toLowerCase() || voiceTag.split('-')[0] === requestedLanguage;
    });

    candidates.sort((a, b) => Number(Boolean(b.localService)) - Number(Boolean(a.localService)));
    return candidates[0] || null;
  }

  function playNativeFallback(guide, locale, trigger, currentRequest, directText = '') {
    const sourceKey = guideSourceKeys[guide];
    if (currentRequest !== requestId || (!sourceKey && !directText)) return;

    if (!speech || typeof window.SpeechSynthesisUtterance !== 'function') {
      clearActive();
      announce('वॉइस सुविधा इस फ़ोन में उपलब्ध नहीं है।', 'unsupported');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(directText || I18N.t(sourceKey, locale));
    utterance.lang = localeTags[locale] || localeTags.hi;
    utterance.rate = 0.84;
    utterance.pitch = 1;
    utterance.volume = 1;

    const nativeVoice = chooseNativeVoice(locale);
    if (nativeVoice) utterance.voice = nativeVoice;
    activeUtterance = utterance;
    updateButtons(trigger);

    utterance.onstart = function () {
      if (currentRequest !== requestId) return;
      announce('निर्देश सुनाए जा रहे हैं', 'speaking');
    };
    utterance.onend = function () {
      if (activeUtterance === utterance) clearActive();
    };
    utterance.onerror = function (event) {
      if (activeUtterance !== utterance) return;
      clearActive();
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        announce('इस भाषा की आवाज़ उपलब्ध नहीं है।', 'error');
      }
    };

    speech.speak(utterance);
  }

  function playBundled(guide, locale, trigger, currentRequest) {
    let fallbackStarted = false;
    const useFallback = function () {
      if (fallbackStarted || currentRequest !== requestId) return;
      fallbackStarted = true;
      clearAudioHandlers();
      playNativeFallback(guide, locale, trigger, currentRequest);
    };

    audio.src = `assets/audio/${locale}/${guide}.mp3`;
    audio.onplaying = function () {
      if (currentRequest !== requestId) return;
      announce('निर्देश सुनाए जा रहे हैं', 'speaking');
      if (navigator.vibrate) navigator.vibrate(18);
    };
    audio.onended = function () {
      if (currentRequest !== requestId) return;
      clearAudioHandlers();
      clearActive();
      if (navigator.vibrate) navigator.vibrate([12, 35, 12]);
    };
    audio.onerror = useFallback;

    const playRequest = audio.play();
    if (playRequest && typeof playRequest.catch === 'function') playRequest.catch(useFallback);
  }

  function speak(guide, locale = I18N.locale, trigger = null) {
    if (!guideSourceKeys[guide] || !localeTags[locale]) return false;

    if (activeGuide === guide && activeLocale === locale) {
      stop();
      return false;
    }

    stop();
    activeGuide = guide;
    activeLocale = locale;
    activeTrigger = trigger;
    updateButtons(trigger);

    const currentRequest = requestId;
    playBundled(guide, locale, trigger, currentRequest);
    return true;
  }

  function speakText(text, locale = I18N.locale, trigger = null) {
    if (!String(text).trim() || !localeTags[locale]) return false;
    stop();
    activeGuide = 'direct_text';
    activeLocale = locale;
    activeTrigger = trigger;
    updateButtons(trigger);
    playNativeFallback('', locale, trigger, requestId, String(text).trim());
    return true;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
  });

  window.VoiceGuide = {
    speak,
    speakText,
    stop,
    toggle: speak,
    previewLanguage(locale, trigger = null) {
      return speak('language_selected', locale, trigger);
    }
  };
})();
