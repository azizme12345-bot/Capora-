import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { CaptionItem, CaptionStyle, AudioSettings, ExportSettings } from './db.js';
import { EXPORTS_DIR, uploadToR2IfConfigured } from './storage.js';

const execAsync = promisify(exec);

export interface MediaProbeResult {
  duration: number; // in seconds
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  format: string;
}

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const cmd = `ffprobe -v error -show_entries format=duration,format_name:stream=codec_type,width,height -of json "${filePath}"`;
  const { stdout } = await execAsync(cmd);
  const info = JSON.parse(stdout);

  const duration = parseFloat(info.format?.duration || '0');
  const streams = info.streams || [];
  const videoStream = streams.find((s: any) => s.codec_type === 'video');
  const audioStream = streams.find((s: any) => s.codec_type === 'audio');

  return {
    duration,
    width: videoStream?.width,
    height: videoStream?.height,
    hasVideo: !!videoStream,
    hasAudio: !!audioStream,
    format: info.format?.format_name || 'unknown',
  };
}

/**
 * Converts CSS hex color (#ffffff or #ffffffff) to ASS color format (&HAABBGGRR)
 */
function hexToAssColor(hex: string, alpha = '00'): string {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  let r = cleanHex.substring(0, 2) || 'FF';
  let g = cleanHex.substring(2, 4) || 'FF';
  let b = cleanHex.substring(4, 6) || 'FF';
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/**
 * Converts seconds to ASS timestamp format: H:MM:SS.cs
 */
function formatAssTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');

  return `${hrs}:${mm}:${ss}.${cc}`;
}

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file content
 */
export function generateAssSubtitles(
  captions: CaptionItem[],
  style: CaptionStyle,
  videoWidth = 1920,
  videoHeight = 1080
): string {
  // Alignment: 2 = bottom-center, 8 = top-center, 5 = middle-center
  let alignment = 2;
  let marginV = 45;
  if (style.position === 'Top center') {
    alignment = 8;
    marginV = 45;
  } else if (style.position === 'Middle center') {
    alignment = 5;
    marginV = 0;
  }

  // Base font size scaled to resolution
  let fontSize = 38;
  if (style.size === 'Small') fontSize = 28;
  else if (style.size === 'Medium') fontSize = 38;
  else if (style.size === 'Large') fontSize = 50;
  else if (style.size === 'Extra large') fontSize = 64;

  // Scale based on video height relative to 1080p
  const scaleFactor = videoHeight / 1080;
  const computedFontSize = Math.round(fontSize * scaleFactor);
  const computedMarginV = Math.round(marginV * scaleFactor);

  const isBold = style.weight !== 'Normal' ? -1 : 0;
  const primaryColor = hexToAssColor(style.color || '#FFFFFF', '00');
  const outlineColor = hexToAssColor('#000000', '00');
  const backColor = hexToAssColor('#000000', '60'); // Semi-transparent black

  let borderStyle = 1; // 1 = outline + shadow, 3 = opaque box
  let outline = 2.5;
  let shadow = 1.5;

  if (style.styleType === 'box') {
    borderStyle = 3;
    outline = 4;
    shadow = 0;
  } else if (style.styleType === 'outline') {
    borderStyle = 1;
    outline = 4.5;
    shadow = 0;
  } else if (style.styleType === 'shadow') {
    borderStyle = 1;
    outline = 1;
    shadow = 3.5;
  } else if (style.styleType === 'clean') {
    borderStyle = 1;
    outline = 1.5;
    shadow = 0.5;
  }

  const fontName = style.font === 'System default' ? 'DejaVu Sans' : style.font || 'DejaVu Sans';

  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${computedFontSize},${primaryColor},&H000000FF,${outlineColor},${backColor},${isBold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},20,20,${computedMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const cap of captions) {
    if (!cap.text || cap.text.trim() === '') continue;
    const startStr = formatAssTime(cap.start);
    const endStr = formatAssTime(cap.end);
    const cleanText = cap.text.replace(/[\r\n]+/g, ' ').trim();

    let effectTags = '';
    if (style.animation === 'Fade') {
      effectTags = '{\\fad(120,120)}';
    } else if (style.animation === 'Pop' || style.animation === 'Bounce') {
      effectTags = '{\\t(0,100,\\fscx112\\fscy112)\\t(100,200,\\fscx100\\fscy100)}';
    } else if (style.animation === 'Slide up') {
      effectTags = '{\\fad(80,80)}';
    } else if (style.animation === 'Word highlight') {
      effectTags = '{\\t(0,150,\\c&H004DFBFF&)}'; // Punchy golden/cyan pop
    }

    ass += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${effectTags}${cleanText}\n`;
  }

  return ass;
}

export interface RenderJob {
  id: string;
  projectId?: string;
  title: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number; // 0 to 100
  currentStep: string;
  outputPath?: string;
  outputFilename?: string;
  fileSize?: number;
  duration?: number;
  downloadUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  retryPayload?: any;
}

const activeJobs = new Map<string, RenderJob>();

export function getRenderJob(jobId: string): RenderJob | undefined {
  return activeJobs.get(jobId);
}

export function getAllRenderJobs(): RenderJob[] {
  return Array.from(activeJobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Executes a full-length server-side FFmpeg rendering job
 */
export async function startRenderJob(params: {
  jobId: string;
  videoPath: string;
  audioPath?: string;
  captions: CaptionItem[];
  style: CaptionStyle;
  audioSettings: AudioSettings;
  exportSettings: ExportSettings;
  title: string;
  projectId?: string;
  onComplete?: (job: RenderJob) => void;
}): Promise<RenderJob> {
  const {
    jobId,
    videoPath,
    audioPath,
    captions,
    style,
    audioSettings,
    exportSettings,
    title,
    projectId,
    onComplete,
  } = params;

  const job: RenderJob = {
    id: jobId,
    projectId,
    title,
    status: 'processing',
    progress: 5,
    currentStep: 'Analyzing media and generating subtitles...',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retryPayload: params,
  };
  activeJobs.set(jobId, job);

  // Run rendering asynchronously in background
  (async () => {
    const tempDir = path.resolve(process.cwd(), 'data', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const assFilePath = path.join(tempDir, `sub_${jobId}.ass`);
    const outputFilename = `export_${jobId}.mp4`;
    const outputPath = path.join(EXPORTS_DIR, outputFilename);

    try {
      // 1. Probe video
      const probe = await probeMedia(videoPath);
      const videoDuration = probe.duration || 10;
      job.duration = videoDuration;
      const srcWidth = probe.width || 1920;
      const srcHeight = probe.height || 1080;

      // 2. Generate ASS subtitles
      const assContent = generateAssSubtitles(captions, style, srcWidth, srcHeight);
      fs.writeFileSync(assFilePath, assContent, 'utf-8');

      job.progress = 15;
      job.currentStep = 'Building video and audio render pipeline...';
      job.updatedAt = new Date().toISOString();

      // 3. Formulate FFmpeg filter graph
      const inputArgs: string[] = ['-y', '-i', videoPath];
      const hasUploadedAudio = !!(audioPath && fs.existsSync(audioPath) && audioSettings.uploadedAudio);
      if (hasUploadedAudio) {
        inputArgs.push('-i', audioPath!);
      }

      // Aspect ratio & Resolution filtering
      const filterComplex: string[] = [];
      let currentVideoRef = '0:v';

      // Aspect ratio
      if (exportSettings.ratio === '9:16 — Shorts / Reels') {
        // Crop or pad to 9:16
        filterComplex.push(`[${currentVideoRef}]crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920[v_ratio]`);
        currentVideoRef = 'v_ratio';
      } else if (exportSettings.ratio === '16:9 — YouTube') {
        filterComplex.push(`[${currentVideoRef}]crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale=1920:1080[v_ratio]`);
        currentVideoRef = 'v_ratio';
      } else if (exportSettings.ratio === '1:1 — Square') {
        filterComplex.push(`[${currentVideoRef}]crop='min(iw,ih)':'min(iw,ih)',scale=1080:1080[v_ratio]`);
        currentVideoRef = 'v_ratio';
      }

      // Resolution scaling if not already forced by aspect ratio
      if (exportSettings.ratio === 'Original') {
        if (exportSettings.resolution === '1080p') {
          filterComplex.push(`[${currentVideoRef}]scale='min(1920,iw)':-2[v_scaled]`);
          currentVideoRef = 'v_scaled';
        } else if (exportSettings.resolution === '720p') {
          filterComplex.push(`[${currentVideoRef}]scale='min(1280,iw)':-2[v_scaled]`);
          currentVideoRef = 'v_scaled';
        }
      }

      // Burn ASS subtitles (escape path for ffmpeg filter)
      const escapedAssPath = assFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');
      filterComplex.push(`[${currentVideoRef}]ass='${escapedAssPath}'[vout]`);

      // Audio filtering
      const origVol = audioSettings.originalAudio ? Math.max(0, audioSettings.originalVolume / 100) : 0;
      const upVol = audioSettings.uploadedAudio ? Math.max(0, audioSettings.uploadedVolume / 100) : 0;

      if (hasUploadedAudio && probe.hasAudio && origVol > 0 && upVol > 0) {
        // Mix original video audio and uploaded audio with sync offset
        const offsetSec = audioSettings.syncOffset || 0;
        let audioFilter2 = `[1:a]volume=${upVol}`;
        if (offsetSec > 0) {
          const delayMs = Math.round(offsetSec * 1000);
          audioFilter2 += `,adelay=${delayMs}|${delayMs}`;
        } else if (offsetSec < 0) {
          audioFilter2 += `,atrim=start=${Math.abs(offsetSec)},asetpts=PTS-STARTPTS`;
        }
        audioFilter2 += '[a2_proc]';

        filterComplex.push(`[0:a]volume=${origVol}[a1_proc]`);
        filterComplex.push(audioFilter2);
        filterComplex.push(`[a1_proc][a2_proc]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
      } else if (hasUploadedAudio && upVol > 0) {
        // Uploaded audio replaces video audio
        const offsetSec = audioSettings.syncOffset || 0;
        let audioFilter = `[1:a]volume=${upVol}`;
        if (offsetSec > 0) {
          const delayMs = Math.round(offsetSec * 1000);
          audioFilter += `,adelay=${delayMs}|${delayMs}`;
        } else if (offsetSec < 0) {
          audioFilter += `,atrim=start=${Math.abs(offsetSec)},asetpts=PTS-STARTPTS`;
        }
        audioFilter += '[aout]';
        filterComplex.push(audioFilter);
      } else if (probe.hasAudio && origVol > 0) {
        // Only original audio
        filterComplex.push(`[0:a]volume=${origVol}[aout]`);
      } else {
        // Silent audio
        filterComplex.push(`aevalsrc=0:d=${videoDuration}[aout]`);
      }

      const ffmpegArgs = [
        ...inputArgs,
        '-filter_complex',
        filterComplex.join(';'),
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '22',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        outputPath,
      ];

      job.currentStep = 'Rendering video with burned captions and mixed audio...';
      job.updatedAt = new Date().toISOString();

      // 4. Spawn FFmpeg process
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        // Parse time=00:00:12.34
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const hours = parseFloat(timeMatch[1]);
          const minutes = parseFloat(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const pct = Math.min(95, Math.max(15, Math.round(15 + (currentTime / videoDuration) * 80)));
          job.progress = pct;
          job.updatedAt = new Date().toISOString();
        }
      });

      ffmpegProcess.on('close', async (code) => {
        // Clean up ass file
        if (fs.existsSync(assFilePath)) {
          try {
            fs.unlinkSync(assFilePath);
          } catch (e) {
            // ignore
          }
        }

        if (code === 0 && fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          job.status = 'completed';
          job.progress = 100;
          job.currentStep = 'Video render complete! Ready for download.';
          job.outputPath = outputPath;
          job.outputFilename = outputFilename;
          job.fileSize = stats.size;
          job.downloadUrl = `/api/download/${outputFilename}`;
          job.updatedAt = new Date().toISOString();

          // Upload to Cloudflare R2 if configured
          const r2Url = await uploadToR2IfConfigured(outputPath, `exports/${outputFilename}`, 'video/mp4');
          if (r2Url) {
            job.downloadUrl = r2Url;
          }

          if (onComplete) {
            onComplete(job);
          }
        } else {
          job.status = 'failed';
          job.progress = 0;
          job.currentStep = 'Export failed during FFmpeg rendering.';
          job.error = `FFmpeg process exited with code ${code}. Please verify media format.`;
          job.updatedAt = new Date().toISOString();
        }
      });

      ffmpegProcess.on('error', (err) => {
        job.status = 'failed';
        job.currentStep = 'Export failed to launch.';
        job.error = err.message;
        job.updatedAt = new Date().toISOString();
      });
    } catch (err: any) {
      job.status = 'failed';
      job.currentStep = 'Export initialization error.';
      job.error = err.message || 'Unknown render error';
      job.updatedAt = new Date().toISOString();
    }
  })();

  return job;
}
