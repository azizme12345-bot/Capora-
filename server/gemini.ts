import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type } from '@google/genai';
import { CaptionItem } from './db.js';

const execAsync = promisify(exec);

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GEMINI_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Extract an optimized mono MP3 audio track from a video or audio file
 */
export async function extractAudioTrack(inputPath: string, outputPath: string): Promise<void> {
  const cmd = `ffmpeg -y -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}"`;
  await execAsync(cmd);
}

export interface TranscribeOptions {
  language: string; // 'auto', 'en', 'es', 'ur', 'roman-ur', etc.
  wordGrouping: 'auto' | '1-2' | '2-3' | '3-4' | '4-5' | '5-6';
  detectMode: 'auto' | 'strict';
}

export async function transcribeAudioBase64(
  base64Audio: string,
  mimeType: string,
  options: TranscribeOptions
): Promise<{ captions: CaptionItem[]; detectedLanguage: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Please add it to your environment secrets.');
  }

  // Build detailed instruction for Gemini
  let languageInstruction = '';
  if (options.language === 'roman-ur') {
    languageInstruction = `
CRITICAL LANGUAGE REQUIREMENT: Transcribe spoken Urdu strictly into ROMAN URDU (Urdu words written using the Latin/English alphabet, e.g., 'Aap kaise hain', 'Yeh bohot acha hai', 'Hum kal milenge', 'Prime Minister Narendra Modi ne aaj Delhi mein...').
DO NOT output Arabic/Persian/Urdu script under any circumstance. Only Latin letters.`;
  } else if (options.language === 'ur') {
    languageInstruction = `
CRITICAL LANGUAGE REQUIREMENT: Transcribe strictly into standard URDU SCRIPT (اردو رسم الخط).
Do NOT use Latin letters. Use authentic Urdu characters, spelling, and grammar.`;
  } else if (options.language === 'hi') {
    languageInstruction = `
Transcribe the speech in authentic Hindi (Devanagari script or standard Hindi). Ensure correct vocabulary and grammar.`;
  } else if (options.language === 'auto') {
    languageInstruction = `
Automatically detect the primary spoken language of the audio and transcribe accurately with standard grammar, spelling, and punctuation.`;
  } else {
    languageInstruction = `
Transcribe the speech in target language: ${options.language}. Ensure precise spelling, capitalization, and punctuation in that language.`;
  }

  let groupingInstruction = '';
  switch (options.wordGrouping) {
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
      mimeType,
      data: base64Audio,
    },
  };

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
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

  const captions: CaptionItem[] = (parsed.captions || []).map((c: any, index: number) => ({
    id: `cap_${Date.now()}_${index}`,
    start: Math.max(0, Number(c.start) || 0),
    end: Math.max(Number(c.start) + 0.3, Number(c.end) || Number(c.start) + 1),
    text: String(c.text || '').replace(/[\r\n]+/g, ' ').trim(),
  }));

  const finalCaptions = regroupCaptions(captions, options.wordGrouping);

  return {
    captions: finalCaptions,
    detectedLanguage: parsed.detectedLanguage || options.language,
  };
}

export async function transcribeMedia(
  mediaFilePath: string,
  options: TranscribeOptions
): Promise<{ captions: CaptionItem[]; detectedLanguage: string }> {
  const tempAudioDir = path.resolve(process.cwd(), 'data', 'temp');
  if (!fs.existsSync(tempAudioDir)) {
    fs.mkdirSync(tempAudioDir, { recursive: true });
  }
  const tempAudioPath = path.join(tempAudioDir, `transcribe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`);

  try {
    await extractAudioTrack(mediaFilePath, tempAudioPath);
    const audioBuffer = fs.readFileSync(tempAudioPath);
    const base64Audio = audioBuffer.toString('base64');
    return await transcribeAudioBase64(base64Audio, 'audio/mp3', options);
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      try {
        fs.unlinkSync(tempAudioPath);
      } catch (e) {}
    }
  }
}

/**
 * Regroups a list of captions to match target word grouping (Auto, 1-2, 2-3, 3-4, 4-5, 5-6)
 * while preserving overall timestamps and single-line format.
 */
export function regroupCaptions(
  captions: CaptionItem[],
  grouping: 'auto' | '1-2' | '2-3' | '3-4' | '4-5' | '5-6'
): CaptionItem[] {
  if (!captions || captions.length === 0) return [];
  if (grouping === 'auto') {
    // Ensure all captions are clean single line
    return captions.map((c) => ({
      ...c,
      text: c.text.replace(/[\r\n]+/g, ' ').trim(),
    }));
  }

  // Parse words with estimated timing from existing captions
  interface WordTime {
    word: string;
    start: number;
    end: number;
  }
  const allWords: WordTime[] = [];

  for (const cap of captions) {
    const words = cap.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const duration = Math.max(0.1, cap.end - cap.start);
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

  const result: CaptionItem[] = [];
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
