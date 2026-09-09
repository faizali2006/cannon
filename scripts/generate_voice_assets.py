"""Generate compact, offline voice-guidance assets for the prototype.

This is a development-only script. The deployed app plays the generated MP3
files and never contacts a speech service at runtime.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


VOICES = {
    "hi": "hi-IN-SwaraNeural",
    "en": "en-IN-NeerjaNeural",
    "mr": "mr-IN-AarohiNeural",
    "ta": "ta-IN-PallaviNeural",
    "te": "te-IN-ShrutiNeural",
    "kn": "kn-IN-SapnaNeural",
    "bn": "bn-IN-TanishaaNeural",
    "gu": "gu-IN-DhwaniNeural",
    "ml": "ml-IN-SobhanaNeural",
}


GUIDES = {
    "hi": {
        "home_intro": "नया उत्पाद बनाने के लिए नारंगी बटन दबाएँ।",
        "home_tip": "उत्पाद को साफ़ जगह पर रखें, तस्वीर और अच्छी आएगी।",
        "camera_help": "उत्पाद को बीच में रखें और तस्वीर लेने के लिए गोल बटन दबाएँ।",
        "voice_help": "माइक दबाएँ, अपने उत्पाद के बारे में बोलें, फिर दोबारा दबाकर रोकें।",
        "ready_help": "आपका उत्पाद तैयार है। कीमत देखें और व्हाट्सऐप पर साझा करें।",
        "inventory_help": "यहाँ आपके सभी उत्पाद हैं। नया उत्पाद बनाने के लिए नारंगी बटन दबाएँ।",
        "login_phone": "अपना दस अंकों का मोबाइल नंबर लिखें। नियम और गोपनीयता नीति पढ़कर सहमति चुनें। फिर ओ टी पी भेजें बटन दबाएँ।",
        "login_otp": "संदेश में मिला छह अंकों का ओ टी पी लिखें। फिर सत्यापित करें बटन दबाएँ।",
        "login_name": "अपना पूरा नाम लिखें। फिर सेलर ऐप खोलें बटन दबाएँ।",
        "language_selected": "नमस्ते। आपने हिन्दी चुनी है।",
    },
    "en": {
        "home_intro": "Press the orange button to create a new product.",
        "home_tip": "Place the product in a clean area for a better photo.",
        "camera_help": "Keep the product in the centre and press the round button to take a photo.",
        "voice_help": "Press the microphone, describe your product, then press it again to stop.",
        "ready_help": "Your product is ready. Check the price and share it on WhatsApp.",
        "inventory_help": "All your products are here. Press the orange button to create a new one.",
        "login_phone": "Enter your ten digit mobile number. Read and accept the terms and privacy policy. Then press Send OTP.",
        "login_otp": "Enter the six digit OTP received by message. Then press Verify OTP.",
        "login_name": "Enter your full name. Then press Open seller app.",
        "language_selected": "Hello. You selected English.",
    },
    "mr": {
        "home_intro": "नवीन उत्पादन तयार करण्यासाठी नारिंगी बटण दाबा.",
        "home_tip": "उत्पादन स्वच्छ जागी ठेवा, फोटो अधिक चांगला येईल.",
        "camera_help": "उत्पादन मध्यभागी ठेवा आणि फोटो काढण्यासाठी गोल बटण दाबा.",
        "voice_help": "माइक दाबा, उत्पादनाबद्दल बोला आणि थांबण्यासाठी पुन्हा दाबा.",
        "ready_help": "तुमचे उत्पादन तयार आहे. किंमत पहा आणि व्हॉट्सअॅपवर शेअर करा.",
        "inventory_help": "तुमची सर्व उत्पादने येथे आहेत. नवीन उत्पादनासाठी नारिंगी बटण दाबा.",
        "login_phone": "तुमचा दहा अंकी मोबाइल नंबर लिहा. नियम आणि गोपनीयता धोरण वाचून संमती द्या. नंतर ओ टी पी पाठवा बटण दाबा.",
        "login_otp": "संदेशातील सहा अंकी ओ टी पी लिहा. नंतर पडताळा बटण दाबा.",
        "login_name": "तुमचे पूर्ण नाव लिहा. नंतर सेलर अॅप उघडा बटण दाबा.",
        "language_selected": "नमस्कार. तुम्ही मराठी निवडली आहे.",
    },
    "ta": {
        "home_intro": "புதிய பொருளை உருவாக்க ஆரஞ்சு பொத்தானை அழுத்துங்கள்.",
        "home_tip": "பொருளை சுத்தமான இடத்தில் வைத்தால் படம் சிறப்பாக வரும்.",
        "camera_help": "பொருளை நடுவில் வைத்து படம் எடுக்க வட்ட பொத்தானை அழுத்துங்கள்.",
        "voice_help": "மைக்ரோஃபோனை அழுத்தி பொருளைப் பற்றி பேசுங்கள். நிறுத்த மீண்டும் அழுத்துங்கள்.",
        "ready_help": "உங்கள் பொருள் தயார். விலையைப் பார்த்து வாட்ஸ்அப்பில் பகிருங்கள்.",
        "inventory_help": "உங்கள் பொருட்கள் அனைத்தும் இங்கே உள்ளன. புதிய பொருளுக்கு ஆரஞ்சு பொத்தானை அழுத்துங்கள்.",
        "login_phone": "உங்கள் பத்து இலக்க கைபேசி எண்ணை உள்ளிடுங்கள். விதிமுறைகளையும் தனியுரிமைக் கொள்கையையும் படித்து ஒப்புதல் அளிக்கவும். பின்னர் ஓ டி பி அனுப்பு பொத்தானை அழுத்தவும்.",
        "login_otp": "செய்தியில் வந்த ஆறு இலக்க ஓ டி பி எண்ணை உள்ளிடுங்கள். பின்னர் சரிபார் பொத்தானை அழுத்தவும்.",
        "login_name": "உங்கள் முழுப் பெயரை உள்ளிடுங்கள். பின்னர் விற்பனையாளர் செயலியைத் திற பொத்தானை அழுத்தவும்.",
        "language_selected": "வணக்கம். நீங்கள் தமிழைத் தேர்ந்தெடுத்துள்ளீர்கள்.",
    },
    "te": {
        "home_intro": "కొత్త ఉత్పత్తిని తయారు చేయడానికి నారింజ రంగు బటన్‌ను నొక్కండి.",
        "home_tip": "ఉత్పత్తిని శుభ్రమైన చోట ఉంచితే ఫోటో బాగా వస్తుంది.",
        "camera_help": "ఉత్పత్తిని మధ్యలో ఉంచి ఫోటో తీయడానికి గుండ్రని బటన్‌ను నొక్కండి.",
        "voice_help": "మైక్‌ను నొక్కి ఉత్పత్తి గురించి మాట్లాడండి. ఆపడానికి మళ్లీ నొక్కండి.",
        "ready_help": "మీ ఉత్పత్తి సిద్ధంగా ఉంది. ధర చూసి వాట్సాప్‌లో షేర్ చేయండి.",
        "inventory_help": "మీ ఉత్పత్తులన్నీ ఇక్కడ ఉన్నాయి. కొత్తదాని కోసం నారింజ బటన్‌ను నొక్కండి.",
        "login_phone": "మీ పది అంకెల మొబైల్ నంబర్ నమోదు చేయండి. నిబంధనలు మరియు గోప్యతా విధానాన్ని చదివి అంగీకరించండి. తరువాత ఓ టీ పీ పంపండి బటన్ నొక్కండి.",
        "login_otp": "సందేశంలో వచ్చిన ఆరు అంకెల ఓ టీ పీ నమోదు చేయండి. తరువాత ధృవీకరించండి బటన్ నొక్కండి.",
        "login_name": "మీ పూర్తి పేరు నమోదు చేయండి. తరువాత సెల్లర్ యాప్ తెరవండి బటన్ నొక్కండి.",
        "language_selected": "నమస్తే. మీరు తెలుగును ఎంచుకున్నారు.",
    },
    "kn": {
        "home_intro": "ಹೊಸ ಉತ್ಪನ್ನ ರಚಿಸಲು ಕಿತ್ತಳೆ ಬಟನ್ ಒತ್ತಿ.",
        "home_tip": "ಉತ್ಪನ್ನವನ್ನು ಸ್ವಚ್ಛ ಜಾಗದಲ್ಲಿಟ್ಟರೆ ಚಿತ್ರ ಚೆನ್ನಾಗಿ ಬರುತ್ತದೆ.",
        "camera_help": "ಉತ್ಪನ್ನವನ್ನು ಮಧ್ಯದಲ್ಲಿಟ್ಟು ಚಿತ್ರ ತೆಗೆಯಲು ವೃತ್ತಾಕಾರದ ಬಟನ್ ಒತ್ತಿ.",
        "voice_help": "ಮೈಕ್ ಒತ್ತಿ ಉತ್ಪನ್ನದ ಬಗ್ಗೆ ಮಾತನಾಡಿ. ನಿಲ್ಲಿಸಲು ಮತ್ತೆ ಒತ್ತಿ.",
        "ready_help": "ನಿಮ್ಮ ಉತ್ಪನ್ನ ಸಿದ್ಧವಾಗಿದೆ. ಬೆಲೆ ನೋಡಿ ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಹಂಚಿಕೊಳ್ಳಿ.",
        "inventory_help": "ನಿಮ್ಮ ಎಲ್ಲಾ ಉತ್ಪನ್ನಗಳು ಇಲ್ಲಿವೆ. ಹೊಸದಕ್ಕಾಗಿ ಕಿತ್ತಳೆ ಬಟನ್ ಒತ್ತಿ.",
        "login_phone": "ನಿಮ್ಮ ಹತ್ತು ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ. ನಿಯಮಗಳು ಮತ್ತು ಗೌಪ್ಯತಾ ನೀತಿಯನ್ನು ಓದಿ ಒಪ್ಪಿಗೆ ನೀಡಿ. ನಂತರ ಓ ಟಿ ಪಿ ಕಳುಹಿಸಿ ಬಟನ್ ಒತ್ತಿ.",
        "login_otp": "ಸಂದೇಶದಲ್ಲಿ ಬಂದ ಆರು ಅಂಕಿಯ ಓ ಟಿ ಪಿ ನಮೂದಿಸಿ. ನಂತರ ಪರಿಶೀಲಿಸಿ ಬಟನ್ ಒತ್ತಿ.",
        "login_name": "ನಿಮ್ಮ ಪೂರ್ಣ ಹೆಸರನ್ನು ನಮೂದಿಸಿ. ನಂತರ ಸೆಲ್ಲರ್ ಆಪ್ ತೆರೆಯಿರಿ ಬಟನ್ ಒತ್ತಿ.",
        "language_selected": "ನಮಸ್ಕಾರ. ನೀವು ಕನ್ನಡವನ್ನು ಆಯ್ಕೆ ಮಾಡಿದ್ದೀರಿ.",
    },
    "bn": {
        "home_intro": "নতুন পণ্য তৈরি করতে কমলা বোতামটি চাপুন।",
        "home_tip": "পণ্যটি পরিষ্কার জায়গায় রাখলে ছবি ভালো আসবে।",
        "camera_help": "পণ্যটি মাঝখানে রেখে ছবি তুলতে গোল বোতামটি চাপুন।",
        "voice_help": "মাইক চাপুন, পণ্য সম্পর্কে বলুন, তারপর থামাতে আবার চাপুন।",
        "ready_help": "আপনার পণ্য প্রস্তুত। দাম দেখে হোয়াটসঅ্যাপে শেয়ার করুন।",
        "inventory_help": "আপনার সব পণ্য এখানে আছে। নতুনটির জন্য কমলা বোতাম চাপুন।",
        "login_phone": "আপনার দশ সংখ্যার মোবাইল নম্বর লিখুন। শর্ত এবং গোপনীয়তা নীতি পড়ে সম্মতি দিন। তারপর ও টি পি পাঠান বোতাম চাপুন।",
        "login_otp": "বার্তায় পাওয়া ছয় সংখ্যার ও টি পি লিখুন। তারপর যাচাই করুন বোতাম চাপুন।",
        "login_name": "আপনার পুরো নাম লিখুন। তারপর সেলার অ্যাপ খুলুন বোতাম চাপুন।",
        "language_selected": "নমস্কার। আপনি বাংলা নির্বাচন করেছেন।",
    },
    "gu": {
        "home_intro": "નવું ઉત્પાદન બનાવવા નારંગી બટન દબાવો.",
        "home_tip": "ઉત્પાદન સ્વચ્છ જગ્યાએ રાખો, ફોટો વધુ સારો આવશે.",
        "camera_help": "ઉત્પાદનને વચ્ચે રાખી ફોટો લેવા ગોળ બટન દબાવો.",
        "voice_help": "માઇક દબાવી ઉત્પાદન વિશે બોલો. રોકવા ફરી દબાવો.",
        "ready_help": "તમારું ઉત્પાદન તૈયાર છે. કિંમત જુઓ અને વોટ્સએપ પર શેર કરો.",
        "inventory_help": "તમારા બધા ઉત્પાદનો અહીં છે. નવું બનાવવા નારંગી બટન દબાવો.",
        "login_phone": "તમારો દસ અંકનો મોબાઇલ નંબર લખો. નિયમો અને ગોપનીયતા નીતિ વાંચીને સંમતિ આપો. પછી ઓ ટી પી મોકલો બટન દબાવો.",
        "login_otp": "સંદેશમાં આવેલ છ અંકનો ઓ ટી પી લખો. પછી ચકાસો બટન દબાવો.",
        "login_name": "તમારું પૂરું નામ લખો. પછી સેલર એપ ખોલો બટન દબાવો.",
        "language_selected": "નમસ્તે. તમે ગુજરાતી પસંદ કરી છે.",
    },
    "pa": {
        "home_intro": "ਨਵਾਂ ਉਤਪਾਦ ਬਣਾਉਣ ਲਈ ਸੰਤਰੀ ਬਟਨ ਦਬਾਓ।",
        "home_tip": "ਉਤਪਾਦ ਨੂੰ ਸਾਫ਼ ਥਾਂ ਰੱਖੋ, ਫੋਟੋ ਵਧੀਆ ਆਵੇਗੀ।",
        "camera_help": "ਉਤਪਾਦ ਨੂੰ ਵਿਚਕਾਰ ਰੱਖੋ ਅਤੇ ਫੋਟੋ ਲਈ ਗੋਲ ਬਟਨ ਦਬਾਓ।",
        "voice_help": "ਮਾਈਕ ਦਬਾਓ, ਉਤਪਾਦ ਬਾਰੇ ਬੋਲੋ, ਫਿਰ ਰੋਕਣ ਲਈ ਦੁਬਾਰਾ ਦਬਾਓ।",
        "ready_help": "ਤੁਹਾਡਾ ਉਤਪਾਦ ਤਿਆਰ ਹੈ। ਕੀਮਤ ਦੇਖੋ ਅਤੇ ਵਟਸਐਪ ਤੇ ਸਾਂਝਾ ਕਰੋ।",
        "inventory_help": "ਤੁਹਾਡੇ ਸਾਰੇ ਉਤਪਾਦ ਇੱਥੇ ਹਨ। ਨਵੇਂ ਲਈ ਸੰਤਰੀ ਬਟਨ ਦਬਾਓ।",
        "login_phone": "ਆਪਣਾ ਦਸ ਅੰਕਾਂ ਦਾ ਮੋਬਾਈਲ ਨੰਬਰ ਲਿਖੋ। ਨਿਯਮ ਅਤੇ ਪਰਦੇਦਾਰੀ ਨੀਤੀ ਪੜ੍ਹ ਕੇ ਸਹਿਮਤੀ ਦਿਓ। ਫਿਰ ਓ ਟੀ ਪੀ ਭੇਜੋ ਬਟਨ ਦਬਾਓ।",
        "login_otp": "ਸੁਨੇਹੇ ਵਿੱਚ ਮਿਲਿਆ ਛੇ ਅੰਕਾਂ ਦਾ ਓ ਟੀ ਪੀ ਲਿਖੋ। ਫਿਰ ਤਸਦੀਕ ਕਰੋ ਬਟਨ ਦਬਾਓ।",
        "login_name": "ਆਪਣਾ ਪੂਰਾ ਨਾਮ ਲਿਖੋ। ਫਿਰ ਸੈਲਰ ਐਪ ਖੋਲ੍ਹੋ ਬਟਨ ਦਬਾਓ।",
        "language_selected": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ। ਤੁਸੀਂ ਪੰਜਾਬੀ ਚੁਣੀ ਹੈ।",
    },
    "ml": {
        "home_intro": "പുതിയ ഉൽപ്പന്നം തയ്യാറാക്കാൻ ഓറഞ്ച് ബട്ടൺ അമർത്തൂ.",
        "home_tip": "ഉൽപ്പന്നം വൃത്തിയുള്ള സ്ഥലത്ത് വെച്ചാൽ ചിത്രം നന്നാകും.",
        "camera_help": "ഉൽപ്പന്നം നടുവിൽ വെച്ച് ചിത്രമെടുക്കാൻ വട്ടത്തിലുള്ള ബട്ടൺ അമർത്തൂ.",
        "voice_help": "മൈക്ക് അമർത്തി ഉൽപ്പന്നത്തെക്കുറിച്ച് പറയൂ. നിർത്താൻ വീണ്ടും അമർത്തൂ.",
        "ready_help": "നിങ്ങളുടെ ഉൽപ്പന്നം തയ്യാർ. വില നോക്കി വാട്സ്ആപ്പിൽ പങ്കിടൂ.",
        "inventory_help": "നിങ്ങളുടെ എല്ലാ ഉൽപ്പന്നങ്ങളും ഇവിടെയുണ്ട്. പുതിയത് ഉണ്ടാക്കാൻ ഓറഞ്ച് ബട്ടൺ അമർത്തൂ.",
        "login_phone": "നിങ്ങളുടെ പത്ത് അക്ക മൊബൈൽ നമ്പർ നൽകുക. നിബന്ധനകളും സ്വകാര്യതാ നയവും വായിച്ച് സമ്മതിക്കുക. തുടർന്ന് ഒ ടി പി അയയ്ക്കുക ബട്ടൺ അമർത്തുക.",
        "login_otp": "സന്ദേശത്തിൽ ലഭിച്ച ആറ് അക്ക ഒ ടി പി നൽകുക. തുടർന്ന് പരിശോധിക്കുക ബട്ടൺ അമർത്തുക.",
        "login_name": "നിങ്ങളുടെ പൂർണ്ണ പേര് നൽകുക. തുടർന്ന് സെല്ലർ ആപ്പ് തുറക്കുക ബട്ടൺ അമർത്തുക.",
        "language_selected": "നമസ്കാരം. നിങ്ങൾ മലയാളം തിരഞ്ഞെടുത്തു.",
    },
}


async def generate_edge_assets(output: Path, edge_tts: object) -> None:
    semaphore = asyncio.Semaphore(4)

    async def generate(locale: str, guide: str, text: str) -> None:
        destination = output / locale / f"{guide}.mp3"
        destination.parent.mkdir(parents=True, exist_ok=True)
        async with semaphore:
            communicate = edge_tts.Communicate(text, VOICES[locale], rate="-10%")
            await communicate.save(str(destination))
            print(f"generated {destination}")

    tasks = [
        generate(locale, guide, text)
        for locale, guides in GUIDES.items()
        if locale in VOICES
        for guide, text in guides.items()
    ]
    await asyncio.gather(*tasks)


def generate_punjabi_assets(output: Path, gtts_class: object) -> None:
    for guide, text in GUIDES["pa"].items():
        destination = output / "pa" / f"{guide}.mp3"
        destination.parent.mkdir(parents=True, exist_ok=True)
        gtts_class(text=text, lang="pa", slow=False).save(str(destination))
        print(f"generated {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--edge-path", type=Path, required=True)
    parser.add_argument("--gtts-path", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("assets/audio"))
    args = parser.parse_args()

    sys.path.insert(0, str(args.edge_path.resolve()))
    import edge_tts  # type: ignore

    asyncio.run(generate_edge_assets(args.output, edge_tts))

    sys.path.insert(0, str(args.gtts_path.resolve()))
    from gtts import gTTS  # type: ignore

    generate_punjabi_assets(args.output, gTTS)


if __name__ == "__main__":
    main()
