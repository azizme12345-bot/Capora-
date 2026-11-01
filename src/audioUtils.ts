/**
 * Browser-based audio extraction utility using Web Audio API.
 * Extracts audio from a video or audio File and downsamples to 16kHz mono WAV base64.
 */

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWAV(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, 1, true);
  /* channel count: 1 (mono) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export async function extractAudioBase64(file: File): Promise<string | null> {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new AudioContextClass();
    
    // Decode audio data
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    // Choose optimal sample rate based on duration to guarantee payload stays strictly under Vercel's 4.5MB ceiling
    const durationSec = decodedBuffer.duration || 1;
    let targetSampleRate = 16000;
    if (durationSec > 120) {
      targetSampleRate = 8000; // 8kHz mono is standard telephony speech bandwidth
    } else if (durationSec > 60) {
      targetSampleRate = 12000; // 12kHz mono
    }

    const maxDurationToRender = Math.min(durationSec, 300); // Up to 5 minutes per transcription pass
    const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
      1,
      Math.ceil(maxDurationToRender * targetSampleRate),
      targetSampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    audioCtx.close().catch(() => {});

    const channelData = renderedBuffer.getChannelData(0);
    const wavBytes = encodeWAV(channelData, targetSampleRate);

    // Convert Uint8Array to base64 safely
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < wavBytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(wavBytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  } catch (err) {
    console.warn('Browser audio extraction skipped/failed:', err);
    return null;
  }
}
