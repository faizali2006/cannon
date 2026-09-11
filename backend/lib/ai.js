const config = require('./config');
const { calculatePrice } = require('./pricing');
const { parseDataUrl, saveBuffer, extensionFor } = require('./media');
const { enhanceProductLocally } = require('./local-studio');

function apiError(message, statusCode = 502, details, code) {
  return Object.assign(new Error(message), { statusCode, details, code });
}

async function openAIRequest(path, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.openai.com/v1${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${config.openAIKey}`, ...(options.headers || {}) },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(payload.error?.message || `AI request failed (${response.status})`, 502, payload.error);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw apiError('AI processing timed out. Please try again.', 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractResponseText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  throw apiError('AI returned no structured text');
}

async function geminiRequest(model, body, timeoutMs = 120000, apiVersion = 'v1beta') {
  const keys = config.geminiKeys || [];
  if (keys.length === 0) throw apiError('No Gemini API keys configured', 500);

  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[i] },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        const status = response.status;
        const msg = payload.error?.message || `Gemini request failed (${status})`;
        const err = apiError(msg, status === 429 ? 429 : 502, payload.error);
        if (status === 429) {
          console.warn(`[AI] Rate limit hit on key index ${i}. Trying next key if available...`);
          throw err;
        }
        throw err;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') {
        lastError = apiError('AI processing timed out. Please try again.', 504);
        break;
      }
      if (error.statusCode !== 429) {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  
  if (lastError && lastError.statusCode === 429) {
    throw apiError('Too many AI requests. Try again later.', 429);
  }
  throw lastError || apiError('Gemini request failed.', 502);
}

function geminiText(payload) {
  const text = (payload.candidates || []).flatMap(candidate => candidate.content?.parts || []).map(part => part.text || '').join('').trim();
  if (!text) throw apiError('Gemini returned no text');
  return text;
}

function dataUrlPart(dataUrl, kind = 'image') {
  const { buffer, mimeType } = parseDataUrl(dataUrl, kind);
  return { inlineData: { mimeType, data: buffer.toString('base64') } };
}

async function structuredResponse({ instructions, prompt, schema, imageDataUrl, useGrounding = false }) {
  if (config.aiProvider === 'gemini') {
    const parts = [{ text: `${instructions}\n\n${prompt}` }];
    if (imageDataUrl) parts.push(dataUrlPart(imageDataUrl, 'image'));
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: schema.value
      }
    };
    if (useGrounding && config.geminiGrounding) body.tools = [{ googleSearch: {} }];
    const payload = await geminiRequest(config.geminiTextModel, body);
    return JSON.parse(geminiText(payload));
  }
  const content = [{ type: 'input_text', text: prompt }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl });
  const payload = await openAIRequest('/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.textModel,
      instructions,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: schema.name, strict: true, schema: schema.value } }
    })
  });
  return JSON.parse(extractResponseText(payload));
}

async function transcribeAudio(audioDataUrl, language) {
  if (config.aiMode !== 'live') return null;
  if (config.aiProvider === 'gemini') {
    const payload = await geminiRequest(config.geminiTextModel, {
      contents: [{ role: 'user', parts: [
        { text: `Transcribe this Indian artisan's product description accurately. Language code: ${language || 'auto'}. Return only the spoken words.` },
        dataUrlPart(audioDataUrl, 'audio')
      ] }],
      generationConfig: { temperature: 0 }
    });
    return geminiText(payload);
  }
  const { buffer, mimeType } = parseDataUrl(audioDataUrl, 'audio');
  const form = new FormData();
  form.append('model', config.transcribeModel);
  form.append('file', new Blob([buffer], { type: mimeType }), `voice.${extensionFor(mimeType)}`);
  if (language) form.append('prompt', `The speaker is an Indian artisan describing a handmade product. Language code: ${language}. Preserve material, craft, place, measurements, and cultural terms.`);
  const payload = await openAIRequest('/audio/transcriptions', { method: 'POST', body: form });
  return payload.text || '';
}

function demoCatalog(text = '') {
  const value = text.toLowerCase();
  if (/मिट्टी|pottery|clay|terracotta|களிமண்|మట్టి|ಮಣ್ಣ|মাটি|માટી|ਮਿੱਟੀ|കളിമൺ/.test(value)) {
    return {
      titleHi: 'हस्तनिर्मित टेराकोटा फूलदान', titleEn: 'Handcrafted Terracotta Flower Vase',
      descriptionHi: 'प्राकृतिक मिट्टी से हाथ से बनाया गया पारंपरिक टेराकोटा फूलदान। इसकी गर्म मिट्टी की रंगत घर की सजावट को सुंदर और सहज रूप देती है।',
      descriptionEn: 'A traditional terracotta flower vase shaped by hand from natural clay. Its warm earthy finish adds a simple handcrafted touch to any home.',
      materials: ['टेराकोटा मिट्टी', 'प्राकृतिक रंग'], features: ['हस्तनिर्मित', 'पर्यावरण अनुकूल'], culturalContext: 'भारतीय कुम्हारी परंपरा से प्रेरित।'
    };
  }
  if (/बाँस|बांस|bamboo|மூங்கில்|వెదురు|ಬಿದಿರು|বাঁশ|વાંસ|ਬਾਂਸ|മുള/.test(value)) {
    return {
      titleHi: 'हाथ से बुनी बाँस की टोकरी', titleEn: 'Handwoven Natural Bamboo Basket',
      descriptionHi: 'मजबूत प्राकृतिक बाँस से हाथ से बुनी बहुउपयोगी टोकरी। घर की सजावट, भंडारण और उपहार के लिए उपयोगी।',
      descriptionEn: 'A versatile basket handwoven from sturdy natural bamboo, suitable for home storage, décor, and thoughtful gifting.',
      materials: ['प्राकृतिक बाँस'], features: ['हल्की', 'मजबूत', 'हस्तनिर्मित'], culturalContext: 'स्थानीय बाँस बुनाई कौशल को आगे बढ़ाती है।'
    };
  }
  if (/साड़ी|sar+e+e|sari|சேலை|చీర|ಸೀರೆ|শাড়ি|સાડી|ਸਾੜੀ|സാരി/.test(value)) {
    return {
      titleHi: 'प्राकृतिक रंग की हथकरघा साड़ी', titleEn: 'Natural-Dyed Handloom Saree',
      descriptionHi: 'पारंपरिक हथकरघे पर सावधानी से बुनी मुलायम साड़ी। प्राकृतिक रंग और हस्तनिर्मित किनारा हर टुकड़े को खास बनाते हैं।',
      descriptionEn: 'A soft saree carefully woven on a traditional handloom. Natural colour and a handcrafted border make every piece unique.',
      materials: ['कॉटन'], features: ['हथकरघा', 'प्राकृतिक रंग'], culturalContext: 'भारतीय हथकरघा बुनाई की जीवित परंपरा।'
    };
  }
  if (/flower|bouquet|फूल|பூ|పువ్వ|ಹೂ|ফুল|ફૂલ|ਫੁੱਲ|പൂ/.test(value)) {
    return {
      titleHi: 'रंग-बिरंगा फूलों का गुलदस्ता', titleEn: 'Colourful Fresh Flower Bouquet',
      descriptionHi: 'विक्रेता के विवरण के अनुसार रंग-बिरंगे फूलों का सजावटी गुलदस्ता। सही फूलों की किस्म, आकार और ताज़गी की जानकारी विक्रेता से पुष्टि करें।',
      descriptionEn: 'A colourful decorative flower bouquet based on the seller’s description. Confirm the flower varieties, size, and freshness with the seller.',
      materials: ['फूल', 'पत्तियाँ'], features: ['रंग-बिरंगा'], culturalContext: ''
    };
  }
  if (value.trim()) {
    const cleaned = text.trim().replace(/\s+/g, ' ').slice(0, 90);
    return {
      titleHi: `हस्तनिर्मित उत्पाद — ${cleaned}`, titleEn: `Handmade Product — ${cleaned}`,
      descriptionHi: `विक्रेता ने इसे “${cleaned}” बताया है। तस्वीर की AI जाँच के बाद सामग्री और विशेषताएँ जोड़ी जाएँगी।`,
      descriptionEn: `The seller described this as “${cleaned}”. Materials and features will be added after AI image analysis.`,
      materials: [], features: [], culturalContext: ''
    };
  }
  return {
    titleHi: 'हस्तनिर्मित उत्पाद', titleEn: 'Handmade Product',
    descriptionHi: 'तस्वीर की AI जाँच उपलब्ध नहीं है। सही विवरण के लिए उत्पाद के बारे में बोलें या लिखें।',
    descriptionEn: 'AI image analysis is not configured. Speak or type about the product for an accurate listing.',
    materials: [], features: [], culturalContext: ''
  };
}

const catalogSchema = {
  name: 'artisan_catalog',
  value: {
    type: 'object', additionalProperties: false,
    properties: {
      titleHi: { type: 'string' }, titleEn: { type: 'string' },
      descriptionHi: { type: 'string' }, descriptionEn: { type: 'string' },
      materials: { type: 'array', items: { type: 'string' } },
      features: { type: 'array', items: { type: 'string' } },
      culturalContext: { type: 'string' }
    },
    required: ['titleHi', 'titleEn', 'descriptionHi', 'descriptionEn', 'materials', 'features', 'culturalContext']
  }
};

async function generateCatalog({ audioDataUrl, transcript, language = 'hi', imageDataUrl }) {
  const detectedTranscript = transcript || (audioDataUrl ? await transcribeAudio(audioDataUrl, language) : '');
  if (config.aiMode !== 'live') {
    if (!config.allowDemoAi) throw apiError('Live AI is not configured. Add a server-side AI provider key before generating listings.', 503, undefined, 'AI_NOT_CONFIGURED');
    return { transcript: detectedTranscript || 'यह हाथ से बुना कॉटन का उत्पाद है और प्राकृतिक रंगों से बनाया गया है।', ...demoCatalog(detectedTranscript), provider: 'demo' };
  }
  try {
    const catalog = await structuredResponse({
      instructions: 'You create accurate, respectful e-commerce listings for Indian handmade products. Examine the attached product image first, then reconcile it with the seller description. Never call it a textile when the image is flowers, pottery, jewellery, wood, or another object. Never invent a certification, community, origin, material, or technique. List only visually supported or seller-stated materials. If the image and seller text conflict, describe the visible product and mention uncertainty cautiously. Return concise Hindi and English suitable for online marketplaces.',
      prompt: `Seller language: ${language}\nSeller transcript: ${detectedTranscript || '(No transcript; infer only visible facts from the image.)'}\nCreate accurate SEO-friendly titles, descriptions, materials, features, and cultural context for the visible product.`,
      schema: catalogSchema,
      imageDataUrl
    });
    return { transcript: detectedTranscript, ...catalog, provider: config.aiProvider };
  } catch (error) {
    console.warn('Image catalog AI failed:', error.message);
    throw apiError('The product image could not be analysed. Please try again.', 502);
  }
}

async function enhanceImage(imageDataUrl) {
  const { buffer, mimeType } = parseDataUrl(imageDataUrl, 'image');
  if (config.localImageEnhancement) {
    try {
      const output = await enhanceProductLocally(buffer, mimeType);
      const url = saveBuffer(output, 'image/jpeg', 'enhanced-local');
      return { dataUrl: `data:image/jpeg;base64,${output.toString('base64')}`, url, provider: 'local-ai', enhanced: true };
    } catch (error) {
      console.warn('Local studio enhancement failed:', error.message);
      throw apiError('The product photo could not be cleaned. Please try another photo.', 502, undefined, 'AI_IMAGE_ENHANCEMENT_FAILED');
    }
  }
  if (config.aiMode !== 'live') {
    if (!config.allowDemoAi) throw apiError('Live AI enhancement is not configured. Add a server-side AI provider key before generating listings.', 503, undefined, 'AI_NOT_CONFIGURED');
    return { dataUrl: imageDataUrl, provider: 'demo', enhanced: false, note: 'Demo mode keeps the original image. Enable live mode for background removal and studio enhancement.' };
  }
  if (config.aiProvider === 'gemini') {
    try {
      const payload = await geminiRequest(config.geminiImageModel, {
        contents: [{ role: 'user', parts: [
          { text: `Perform a restrained product-photo cleanup, not a redesign.

FOREGROUND PRODUCT — LOCKED:
- Preserve the exact physical product from the input: identity, colour, material, weave, print, stitching, texture, shape, proportions, quantity, orientation, and visible imperfections.
- Keep the whole product in frame with clean, natural edges, including fine tassels, handles, jewellery links, or transparent details.
- Do not invent, remove, duplicate, reshape, repair, recolour, relabel, or decorate any part of the product.

BACKGROUND — REPLACE COMPLETELY:
- Remove the entire original background, especially blur, bokeh, clutter, furniture, people, hands, shadows from unrelated objects, and colour casts.
- Place the isolated product on a seamless plain warm off-white studio background (#F7F5F0). No horizon line, pattern, scenery, props, text, border, watermark, or logo.

LIGHTING — CORRECT ONLY:
- Apply soft diffused professional studio lighting: a broad key light from the upper left, gentle frontal fill, neutral white balance, controlled highlights, and visible detail in dark areas.
- Add only a subtle realistic contact shadow directly beneath the product so it does not appear to float.
- Reduce noise and improve clarity gently. Do not over-sharpen, make surfaces glossy, or erase authentic handmade texture.

OUTPUT:
- Produce one square, marketplace-ready photograph of the same product, centred and filling most of the frame.` },
          dataUrlPart(imageDataUrl, 'image')
        ] }],
        generationConfig: { responseModalities: ['IMAGE'] }
      }, 180000, 'v1');
      const imagePart = (payload.candidates || []).flatMap(candidate => candidate.content?.parts || []).find(part => part.inlineData?.data);
      if (!imagePart) throw apiError('Gemini image editor returned no image');
      const outputMime = imagePart.inlineData.mimeType || 'image/png';
      const output = Buffer.from(imagePart.inlineData.data, 'base64');
      const url = saveBuffer(output, outputMime, 'enhanced');
      return { dataUrl: `data:${outputMime};base64,${imagePart.inlineData.data}`, url, provider: 'gemini', enhanced: true };
    } catch (error) {
      console.warn('Gemini studio enhancement failed:', error.message);
      if (/quota|billing|rate limit/i.test(error.message)) {
        throw apiError('AI photo enhancement is temporarily unavailable. Please try again later.', 503, undefined, 'AI_IMAGE_QUOTA_UNAVAILABLE');
      }
      throw apiError('The product photo could not be enhanced. Please try again.', 502, undefined, 'AI_IMAGE_ENHANCEMENT_FAILED');
    }
  }
  try {
    const form = new FormData();
    form.append('model', config.imageModel);
    form.append('image[]', new Blob([buffer], { type: mimeType }), `product.${extensionFor(mimeType)}`);
    form.append('prompt', 'Create a square professional e-commerce product photo. Preserve the exact product, shape, weave, embroidery, texture, pattern, colour identity, and proportions. Remove all background clutter and hands. Place only the product, centered, on a clean warm-white neutral studio background with a subtle natural grounding shadow. Correct exposure and white balance, improve detail gently, and do not add text, logos, props, decorations, or new product features.');
    form.append('input_fidelity', 'high');
    form.append('size', '1024x1024');
    form.append('quality', 'medium');
    form.append('background', 'opaque');
    form.append('output_format', 'jpeg');
    const payload = await openAIRequest('/images/edits', { method: 'POST', body: form }, 180000);
    const base64 = payload.data?.[0]?.b64_json;
    if (!base64) throw apiError('Image editor returned no image');
    const output = Buffer.from(base64, 'base64');
    const url = saveBuffer(output, 'image/jpeg', 'enhanced');
    return { dataUrl: `data:image/jpeg;base64,${base64}`, url, provider: 'openai', enhanced: true };
  } catch (error) {
    console.warn('Studio enhancement unavailable; preserving original:', error.message);
    return { dataUrl: imageDataUrl, provider: 'openai-fallback', enhanced: false, note: 'Studio enhancement was unavailable; the original image was preserved.' };
  }
}

const priceSchema = {
  name: 'artisan_price',
  value: {
    type: 'object', additionalProperties: false,
    properties: {
      category: { type: 'string' }, currency: { type: 'string', enum: ['INR'] },
      minimum: { type: 'integer' }, suggested: { type: 'integer' }, maximum: { type: 'integer' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      explanationHi: { type: 'string' }, explanationEn: { type: 'string' }
    },
    required: ['category', 'currency', 'minimum', 'suggested', 'maximum', 'confidence', 'explanationHi', 'explanationEn']
  }
};

async function suggestPrice(input) {
  const fallback = calculatePrice(input);
  if (config.aiMode !== 'live') {
    if (!config.allowDemoAi) throw apiError('Live AI pricing is not configured. Add a server-side AI provider key before generating listings.', 503, undefined, 'AI_NOT_CONFIGURED');
    return { ...fallback, provider: 'demo' };
  }
  try {
    const result = await structuredResponse({
      instructions: 'You are a cautious pricing assistant for rural Indian artisans. Examine the image and listing. Suggest an attractive but sustainable competitive retail range in INR. Consider visible quality, finish, complexity, likely material, artisan labour, packaging, marketplace fees, and comparable Indian online products. Never promise a sale. Keep minimum <= suggested <= maximum and explain the reasoning in plain language.',
      prompt: `Product: ${input.title || ''}\nDescription: ${input.description || ''}\nMaterials: ${(input.materials || []).join(', ')}\nMaterial cost INR: ${Number(input.materialCost) || 0}\nLabour hours: ${Number(input.laborHours) || 0}\nHourly rate INR: ${Number(input.hourlyRate) || 80}\nOptional market signals: ${JSON.stringify(input.marketSignals || [])}\nBenchmark floor: ${JSON.stringify(fallback)}\nReturn a competitive range, a best attractive price within it, and a short reason.`,
      schema: priceSchema,
      imageDataUrl: input.imageDataUrl,
      useGrounding: true
    });
    const minimum = Math.max(50, Math.round(Number(result.minimum) || fallback.minimum));
    const maximum = Math.max(minimum, Math.round(Number(result.maximum) || fallback.maximum));
    const suggested = Math.min(maximum, Math.max(minimum, Math.round(Number(result.suggested) || fallback.suggested)));
    return { ...result, minimum, suggested, maximum, provider: config.aiProvider };
  } catch (error) {
    console.warn('AI pricing failed; using sustainable benchmark:', error.message);
    return { ...fallback, provider: 'benchmark', warning: 'Live market analysis was unavailable; a cost-aware benchmark was used.' };
  }
}

const freePriceSchema = {
  type: 'object',
  properties: {
    item_classification: { type: 'string' },
    product_name: { type: 'string' },
    category: { type: 'string' },
    suggested_price: { type: 'integer' },
    price_range: {
      type: 'object',
      properties: {
        min: { type: 'integer' },
        max: { type: 'integer' }
      },
      required: ['min', 'max']
    },
    breakdown_reasoning: { type: 'string' }
  },
  required: ['item_classification', 'product_name', 'category', 'suggested_price', 'price_range', 'breakdown_reasoning']
};

async function suggestPriceFree(imageDataUrl, description = '') {
  try {
    const parts = [
      { text: `You are an expert appraiser. Identify the product in the image. Estimate a realistic retail price in Indian Rupees (INR) based on its apparent material, quality, and manufacturing type. If it is a cheap, mass-produced item like a plastic pen, estimate appropriately (e.g., ₹5 to ₹50). If it is a high-value or handmade item, estimate accordingly.
Return a JSON object conforming strictly to the requested schema. Use "Handmade" or "Mass-Produced" for the item_classification.

Seller description (if any): ${description}
` }
    ];
    if (imageDataUrl) {
      let base64Data = imageDataUrl;
      let mimeType = 'image/jpeg';
      if (imageDataUrl.startsWith('data:')) {
        const partsUrl = imageDataUrl.split(',');
        base64Data = partsUrl[1];
        mimeType = partsUrl[0].split(':')[1].split(';')[0];
      }
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      });
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: freePriceSchema
      }
    };

    const payload = await geminiRequest(config.geminiTextModel, body);
    const rawResponseText = geminiText(payload);
    const cleanJsonString = rawResponseText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanJsonString);
  } catch (error) {
    console.warn('Free AI pricing failed:', error.message);
    throw apiError('Could not generate dynamic pricing. ' + error.message, 502);
  }
}

module.exports = { enhanceImage, generateCatalog, suggestPrice, suggestPriceFree, transcribeAudio };
