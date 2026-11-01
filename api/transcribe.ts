import { GoogleGenAI, Type } from '@google/genai';

function regroupCaptions(captions: any[], grouping: string): any[] {
  if (!captions || captions.length === 0) return [];
  if (grouping === 'auto') {
    return captions.map((c) => ({
      ...c,
      text: String(c.text || '').replace(/[\r\n]+/g, ' ').trim(),
    }));
  }

  interface WordTime {
    word: string;
    start: number;
    end: number;
  }
  const allWords: WordTime[] = [];

  for (const cap of captions) {
    const words = String(cap.text || '').split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const duration = Math.max(0.1, (Number(cap.end) || 0) - (Number(cap.start) || 0));
    const wordDuration = duration / words.length;

    words.forEach((w, i) => {
      allWords.push({
        word: w,
        start: Number((cap.start + i * wordDuration).toFixed(2)),
        end: Number((cap.start + (i + 1) * wordDuration).toFixed(2)),
      });
    });
  }

  if (allWords.length === 0) return captions;

  let maxWords = 3;
  if (grouping === '1-2') maxWords = 2;
  else if (grouping === '2-3') maxWords = 3;
  else if (grouping === '3-4') maxWords = 4;
  else if (grouping === '4-5') maxWords = 5;
  else if (grouping === '5-6') maxWords = 6;

  const result: any[] = [];
  let currentGroup: WordTime[] = [];

  for (let i = 0; i < allWords.length; i++) {
    currentGroup.push(allWords[i]);
    const isPunctuationBreak = /[.!?]$/.test(allWords[i].word);
    const reachedLimit = currentGroup.length >= maxWords;
    const isLastWord = i === allWords.length - 1;

    if (reachedLimit || isPunctuationBreak || isLastWord) {
      const first = currentGroup[0];
      const last = currentGroup[currentGroup.length - 1];
      result.push({
        id: `cap_grp_${result.length}_${Date.now()}`,
        start: first.start,
        end: Math.max(first.start + 0.3, last.end),
        text: currentGroup.map((w) => w.word).join(' '),
      });
      currentGroup = [];
    }
  }

  return result;
}

export default async function handler(req: any, res: any) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: 'GEMINI_API_KEY is not set in Vercel environment variables. Please add GEMINI_API_KEY in Vercel Settings > Environment Variables and redeploy.',
    });
  }

  try {
    const { audioBase64, mimeType, language = 'en', wordGrouping = 'auto' } = req.body || {};

    if (!audioBase64) {
      return res.status(400).json({
        error: 'No audio data received. Please select an audio or video file in Capora.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    let languageInstruction = '';
    if (language === 'roman-ur') {
      languageInstruction = `
CRITICAL LANGUAGE REQUIREMENT: Transcribe spoken Urdu strictly into ROMAN URDU (Urdu words written using the Latin/English alphabet, e.g., 'Aap kaise hain', 'Yeh bohot acha hai', 'Hum kal milenge', 'Prime Minister Narendra Modi ne aaj Delhi mein...').
DO NOT output Arabic/Persian/Urdu script under any circumstance. Only Latin letters.`;
    } else if (language === 'ur') {
      languageInstruction = `
CRITICAL LANGUAGE REQUIREMENT: Transcribe strictly into standard URDU SCRIPT (اردو رسم الخط).
Do NOT use Latin letters. Use authentic Urdu characters, spelling, and grammar.`;
    } else if (language === 'hi') {
      languageInstruction = `
Transcribe the speech in authentic Hindi (Devanagari script or standard Hindi). Ensure correct vocabulary and grammar.`;
    } else if (language === 'auto') {
      languageInstruction = `
Automatically detect the primary spoken language of the audio and transcribe accurately with standard grammar, spelling, and punctuation.`;
    } else {
      languageInstruction = `
Transcribe the speech in target language: ${language}. Ensure precise spelling, capitalization, and punctuation in that language.`;
    }

    let groupingInstruction = '';
    switch (wordGrouping) {
      case '1-2':
        groupingInstruction = 'Word grouping requirement: Strictly 1 to 2 words per caption line.';
        break;
      case '2-3':
        groupingInstruction = 'Word grouping requirement: Strictly 2 to 3 words per caption line.';
        break;
      case '3-4':
        groupingInstruction = 'Word grouping requirement: Strictly 3 to 4 words per caption line.';
        break;
      case '4-5':
        groupingInstruction = 'Word grouping requirement: Strictly 4 to 5 words per caption line.';
        break;
      case '5-6':
        groupingInstruction = 'Word grouping requirement: Strictly 5 to 6 words per caption line.';
        break;
      case 'auto':
      default:
        groupingInstruction = 'Word grouping requirement: Auto-chunk into clean, punchy spoken phrases (typically 2 to 5 words).';
        break;
    }

    const promptText = `
You are Capora AI's speech-to-text caption engine.
Your task is to transcribe this audio into highly accurate, timestamped captions for video subtitles.

Rules:
1. Every caption must be on a SINGLE LINE (no newlines '\\n' within any caption text).
2. Start and end timestamps must be in seconds as floating point numbers (e.g., 0.5, 1.45, 3.2).
3. Timestamps must accurately reflect when the words are spoken in the audio without large gaps or overlaps.
4. ${languageInstruction}
5. ${groupingInstruction}
6. Correct all spelling, vocal stutters, and punctuation appropriately for clean video captions.

Return the response in JSON matching the schema provided.
`;

    const audioPart = {
      inlineData: {
        mimeType: mimeType || 'audio/wav',
        data: audioBase64,
      },
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [audioPart, { text: promptText }],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: {
              type: Type.STRING,
              description: 'The language detected or used for transcription',
            },
            captions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: {
                    type: Type.NUMBER,
                    description: 'Start time in seconds',
                  },
                  end: {
                    type: Type.NUMBER,
                    description: 'End time in seconds',
                  },
                  text: {
                    type: Type.STRING,
                    description: 'The single-line caption text',
                  },
                },
                required: ['start', 'end', 'text'],
              },
            },
          },
          required: ['captions'],
        },
      },
    });

    const rawJson = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawJson);

    const captions = (parsed.captions || []).map((c: any, index: number) => ({
      id: `cap_${Date.now()}_${index}`,
      start: Math.max(0, Number(c.start) || 0),
      end: Math.max(Number(c.start) + 0.3, Number(c.end) || Number(c.start) + 1),
      text: String(c.text || '').replace(/[\r\n]+/g, ' ').trim(),
    }));

    const finalCaptions = regroupCaptions(captions, wordGrouping);

    return res.status(200).json({
      captions: finalCaptions,
      detectedLanguage: parsed.detectedLanguage || language,
    });
  } catch (err: any) {
    console.error('Vercel serverless transcribe error:', err);
    return res.status(500).json({
      error: err.message || 'Failed to generate captions. Please check your GEMINI_API_KEY.',
    });
  }
}
