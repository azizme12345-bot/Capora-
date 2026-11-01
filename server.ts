import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import dotenv from 'dotenv';
import { db, ProjectData } from './server/db.js';
import { UPLOADS_DIR, EXPORTS_DIR, isR2Configured } from './server/storage.js';
import { probeMedia, startRenderJob, getRenderJob, getAllRenderJobs } from './server/ffmpeg.js';
import { transcribeMedia, transcribeAudioBase64, regroupCaptions, getGeminiClient } from './server/gemini.js';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer setup for media upload (max 500MB)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${cleanBase}_${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB maximum
  },
});

// API Status & Configuration Check
app.get('/api/status', (_req, res) => {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasR2 = isR2Configured();
  res.json({
    geminiConfigured: hasGemini,
    r2Configured: hasR2,
    ffmpegAvailable: true,
    maxDurationMinutes: 30,
    maxUploadSizeMB: 500,
  });
});

// Media Upload endpoint with validation
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No media file provided.' });
  }

  const filePath = req.file.path;
  try {
    // Validate duration with ffprobe
    const probe = await probeMedia(filePath);
    const maxDurationSeconds = 30 * 60; // 30 minutes

    if (probe.duration > maxDurationSeconds) {
      // Exceeded limit: remove file
      fs.unlinkSync(filePath);
      return res.status(400).json({
        error: `File duration (${Math.round(probe.duration / 60)} min) exceeds the maximum allowed duration of 30 minutes.`,
      });
    }

    res.json({
      id: req.file.filename,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
      url: `/api/media/${req.file.filename}`,
    });
  } catch (err: any) {
    console.error('Probe error on upload:', err);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }
    res.status(400).json({
      error: 'Invalid media file or unreadable media format: ' + (err.message || ''),
    });
  }
});

// Stream media with HTTP 206 Partial Content (Range request) for smooth video scrubbing
app.get('/api/media/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  let contentType = 'video/mp4';
  const ext = path.extname(filename).toLowerCase();
  if (['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(ext)) {
    contentType = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'audio/mp4';
  } else if (ext === '.webm') {
    contentType = 'video/webm';
  } else if (ext === '.mov') {
    contentType = 'video/quicktime';
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// AI Caption Generation
app.post('/api/transcribe', async (req, res) => {
  try {
    const { mediaFilename, audioFilename, audioBase64, fileBase64, mimeType, language, wordGrouping, detectMode } = req.body;

    const options = {
      language: language || 'en',
      wordGrouping: wordGrouping || 'auto',
      detectMode: detectMode || 'auto',
    };

    const directMedia = fileBase64 || audioBase64;
    // If client provided media/audio base64 directly
    if (directMedia) {
      const targetMime = mimeType || (fileBase64 ? 'video/mp4' : 'audio/wav');
      const result = await transcribeAudioBase64(directMedia, targetMime, options);
      return res.json(result);
    }

    const targetFile = audioFilename || mediaFilename;
    if (!targetFile) {
      return res.status(400).json({ error: 'No media file specified for transcription.' });
    }

    const filePath = path.join(UPLOADS_DIR, path.basename(targetFile));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Target media file does not exist on server.' });
    }

    const result = await transcribeMedia(filePath, options);
    res.json(result);
  } catch (err: any) {
    console.error('Transcription error:', err);
    res.status(500).json({
      error: err.message || 'Failed to generate captions. Please check your Gemini API settings.',
    });
  }
});

// Regroup existing captions
app.post('/api/regroup', (req, res) => {
  const { captions, grouping } = req.body;
  if (!captions || !Array.isArray(captions)) {
    return res.status(400).json({ error: 'Captions array is required.' });
  }
  const regrouped = regroupCaptions(captions, grouping || 'auto');
  res.json({ captions: regrouped });
});

// Full-length FFmpeg video export
app.post('/api/export', async (req, res) => {
  try {
    const {
      mediaFilename,
      audioFilename,
      captions,
      style,
      audioSettings,
      exportSettings,
      title,
      projectId,
    } = req.body;

    if (!mediaFilename) {
      return res.status(400).json({ error: 'Video media file is required for export.' });
    }

    const videoPath = path.join(UPLOADS_DIR, path.basename(mediaFilename));
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Source video file not found.' });
    }

    let audioPath: string | undefined;
    if (audioFilename) {
      const aPath = path.join(UPLOADS_DIR, path.basename(audioFilename));
      if (fs.existsSync(aPath)) {
        audioPath = aPath;
      }
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const jobTitle = title || 'Capora Video Export';

    const job = await startRenderJob({
      jobId,
      projectId,
      videoPath,
      audioPath,
      captions: captions || [],
      style: style || {
        font: 'Inter',
        size: 'Medium',
        weight: 'Bold',
        color: '#ffffff',
        position: 'Bottom center',
        styleType: 'clean',
        animation: 'None',
      },
      audioSettings: audioSettings || {
        originalAudio: true,
        originalVolume: 100,
        uploadedAudio: false,
        uploadedVolume: 80,
        syncOffset: 0,
      },
      exportSettings: exportSettings || {
        resolution: 'Original resolution',
        ratio: 'Original',
      },
      title: jobTitle,
      onComplete: (completedJob) => {
        // Automatically save to Draft Gallery
        db.addDraft({
          id: `draft_${Date.now()}`,
          jobId: completedJob.id,
          projectId: completedJob.projectId,
          title: completedJob.title,
          createdAt: completedJob.createdAt,
          duration: completedJob.duration || 0,
          resolution: exportSettings?.resolution || 'Original resolution',
          ratio: exportSettings?.ratio || 'Original',
          filename: completedJob.outputFilename || '',
          fileSize: completedJob.fileSize || 0,
          downloadUrl: completedJob.downloadUrl || '',
        });
      },
    });

    res.json({ jobId: job.id, status: job.status });
  } catch (err: any) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message || 'Failed to start video export.' });
  }
});

// Check export job status
app.get('/api/export/:jobId', (req, res) => {
  const job = getRenderJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Render job not found.' });
  }
  res.json(job);
});

// Retry export job
app.post('/api/export/:jobId/retry', async (req, res) => {
  const oldJob = getRenderJob(req.params.jobId);
  if (!oldJob || !oldJob.retryPayload) {
    return res.status(404).json({ error: 'Cannot retry job: parameters not available.' });
  }
  const newJobId = `job_${Date.now()}_retry`;
  const payload = {
    ...oldJob.retryPayload,
    jobId: newJobId,
  };
  const restarted = await startRenderJob(payload);
  res.json({ jobId: restarted.id, status: restarted.status });
});

// Download rendered MP4 file
app.get('/api/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(EXPORTS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Exported file not found.' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

// Projects API
app.get('/api/projects', (_req, res) => {
  res.json(db.getProjects());
});

app.get('/api/projects/:id', (req, res) => {
  const proj = db.getProjectById(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(proj);
});

app.post('/api/projects', (req, res) => {
  const projectData: ProjectData = req.body;
  if (!projectData.id) {
    projectData.id = `proj_${Date.now()}`;
    projectData.createdAt = new Date().toISOString();
  }
  const saved = db.saveProject(projectData);
  res.json(saved);
});

app.delete('/api/projects/:id', (req, res) => {
  const success = db.deleteProject(req.params.id);
  res.json({ success });
});

// Draft Gallery API
app.get('/api/drafts', (_req, res) => {
  res.json(db.getDrafts());
});

app.delete('/api/drafts/:id', (req, res) => {
  const success = db.deleteDraft(req.params.id);
  res.json({ success });
});

// Initialize Vite in Dev mode or Static Serving in Prod
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Capora AI Caption Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
});
