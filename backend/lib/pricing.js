const categoryAnchors = {
  textile: 1299,
  saree: 2499,
  pottery: 699,
  bamboo: 849,
  jewelry: 1599,
  painting: 1899,
  wood: 1399,
  other: 999
};

function roundTo50(value) {
  return Math.max(50, Math.round(value / 50) * 50);
}

function inferCategory(text = '') {
  const value = text.toLowerCase();
  if (/saree|sari|साड़ी|சேலை|చీర|ಸೀರೆ|শাড়ি|સાડી|ਸਾੜੀ|സാരി/.test(value)) return 'saree';
  if (/dupatta|textile|cotton|fabric|दुपट्ट|कपड़ा|வஸ்திர|వస్త్ర|ಬಟ್ಟೆ|কাপড়|કાપડ|ਕੱਪੜ|തുണി/.test(value)) return 'textile';
  if (/pottery|clay|terracotta|मिट्टी|களிமண்|మట్టి|ಮಣ್ಣ|মাটি|માટી|ਮਿੱਟੀ|കളിമൺ/.test(value)) return 'pottery';
  if (/bamboo|बाँस|बांस|மூங்கில்|వెదురు|ಬಿದಿರು|বাঁশ|વાંસ|ਬਾਂਸ|മുള/.test(value)) return 'bamboo';
  if (/jewel|necklace|जेवर|நகை|నగ|ಆಭರಣ|গয়না|ઘરેણ|ਗਹਿਣ|ആഭരണ/.test(value)) return 'jewelry';
  if (/paint|चित्र|पेंटिंग|ஓவியம்|చిత్ర|ಚಿತ್ರ|ছবি|ચિત્ર|ਚਿੱਤਰ|ചിത്ര/.test(value)) return 'painting';
  if (/wood|लकड़ी|மரம்|చెక్క|ಮರ|কাঠ|લાકડ|ਲੱਕੜ|മരം/.test(value)) return 'wood';
  return 'other';
}

function calculatePrice({ title = '', description = '', materials = [], materialCost = 0, laborHours = 0, hourlyRate = 80 } = {}) {
  const category = inferCategory(`${title} ${description} ${materials.join(' ')}`);
  const marketAnchor = categoryAnchors[category];
  const knownCost = Math.max(0, Number(materialCost) || 0) + Math.max(0, Number(laborHours) || 0) * Math.max(0, Number(hourlyRate) || 0);
  const costBased = knownCost > 0 ? knownCost * 1.18 * 1.35 : marketAnchor * 0.82;
  const suggested = roundTo50(costBased * 0.55 + marketAnchor * 0.45);
  const minimum = roundTo50(Math.max(costBased * 0.92, suggested * 0.82));
  const maximum = roundTo50(Math.max(suggested * 1.22, marketAnchor * 1.12));
  return {
    category,
    currency: 'INR',
    minimum,
    suggested,
    maximum,
    confidence: knownCost > 0 ? 'medium' : 'low',
    explanationHi: knownCost > 0
      ? 'यह सुझाव सामग्री, मेहनत, सामान्य खर्च और समान हस्तनिर्मित उत्पादों की कीमत पर आधारित है।'
      : 'यह शुरुआती सुझाव समान हस्तनिर्मित उत्पादों की सामान्य कीमत पर आधारित है। सामग्री और मेहनत जोड़ने पर अनुमान बेहतर होगा।',
    explanationEn: knownCost > 0
      ? 'This estimate combines material, labour, overhead, margin, and a benchmark for similar handmade products.'
      : 'This starting estimate uses a benchmark for similar handmade products. Add material and labour costs for a better estimate.'
  };
}

module.exports = { calculatePrice, inferCategory, roundTo50 };
