/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useTransition } from 'react';
import {
  CaptionItem,
  CaptionStyle,
  AudioSettings,
  ExportSettings,
  UploadedMedia,
  ProjectData,
  DraftExportItem,
  RenderJob,
  WordGrouping,
} from './types.ts';
import { extractAudioBase64 } from './audioUtils.ts';

const DEFAULT_STYLE: CaptionStyle = {
  font: 'Inter',
  size: 'Medium',
  weight: 'Bold',
  color: '#ffffff',
  position: 'Bottom center',
  styleType: 'clean',
  animation: 'Pop',
};

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  originalAudio: true,
  originalVolume: 100,
  uploadedAudio: true,
  uploadedVolume: 80,
  syncOffset: 0,
};

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolution: 'Original resolution',
  ratio: 'Original',
};

export default function App() {
  // Navigation
  const [currentPage, setCurrentPage] = useState<'home' | 'studio' | 'projects' | 'drafts'>('studio');

  // Project state
  const [projectId, setProjectId] = useState<string>(() => `proj_${Date.now()}`);
  const [projectName, setProjectName] = useState<string>('Untitled Caption Project');
  const [importMode, setImportMode] = useState<'video' | 'audio' | 'both'>('video');

  // Media state
  const [videoMedia, setVideoMedia] = useState<UploadedMedia | null>(null);
  const [audioMedia, setAudioMedia] = useState<UploadedMedia | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Captions state
  const [captions, setCaptions] = useState<CaptionItem[]>([
    { id: 'sample_1', start: 0, end: 2.5, text: 'Your captions will appear here' },
  ]);
  const [activeCaptionIndex, setActiveCaptionIndex] = useState<number>(0);
  const [showCaptionsList, setShowCaptionsList] = useState<boolean>(false);

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<Array<{ captions: CaptionItem[]; style: CaptionStyle }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ captions: CaptionItem[]; style: CaptionStyle }>>([]);

  // AI & Formatting settings
  const [language, setLanguage] = useState<string>('en');
  const [detectMode, setDetectMode] = useState<'auto' | 'strict'>('auto');
  const [wordGrouping, setWordGrouping] = useState<WordGrouping>('auto');
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_STYLE);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);

  // Status & processing
  const [statusMessage, setStatusMessage] = useState<string>(
    'Ready to import media or generate captions with Gemini AI.'
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeRenderJob, setActiveRenderJob] = useState<RenderJob | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Saved data
  const [projectsList, setProjectsList] = useState<ProjectData[]>([]);
  const [draftsList, setDraftsList] = useState<DraftExportItem[]>([]);
  const [backendStatus, setBackendStatus] = useState<{
    geminiConfigured: boolean;
    r2Configured: boolean;
  } | null>(null);

  // Video playback
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // File input refs
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Fetch backend status on mount
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => setBackendStatus(data))
      .catch((err) => console.warn('Could not fetch status:', err));
    loadProjects();
    loadDrafts();
  }, []);

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        setProjectsList(data);
      }
    } catch (e) {
      console.warn('Failed to load projects', e);
    }
  };

  const loadDrafts = async () => {
    try {
      const res = await fetch('/api/drafts');
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        setDraftsList(data);
      }
    } catch (e) {
      console.warn('Failed to load drafts', e);
    }
  };

  // Push to undo stack
  const recordHistory = () => {
    setUndoStack((prev) => [...prev.slice(-30), { captions: [...captions], style: { ...style } }]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, prev.length - 1));
    setRedoStack((prev) => [...prev, { captions: [...captions], style: { ...style } }]);
    setCaptions(previous.captions);
    setStyle(previous.style);
    setStatusMessage('Action undone.');
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, prev.length - 1));
    setUndoStack((prev) => [...prev, { captions: [...captions], style: { ...style } }]);
    setCaptions(next.captions);
    setStyle(next.style);
    setStatusMessage('Action redone.');
  };

  // Video Time Update & Audio Sync
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const ct = videoRef.current.currentTime;
    setCurrentTime(ct);

    // Sync external audio if present
    if (audioRef.current && audioSettings.uploadedAudio) {
      const expectedAudioTime = Math.max(0, ct + audioSettings.syncOffset);
      if (Math.abs(audioRef.current.currentTime - expectedAudioTime) > 0.25) {
        audioRef.current.currentTime = expectedAudioTime;
      }
    }

    // Determine active caption index
    const foundIndex = captions.findIndex((c) => ct >= c.start && ct <= c.end);
    if (foundIndex !== -1 && foundIndex !== activeCaptionIndex) {
      setActiveCaptionIndex(foundIndex);
    }
  };

  // Sync audio play/pause with video
  const handlePlay = () => {
    setIsPlaying(true);
    if (audioRef.current && audioSettings.uploadedAudio) {
      audioRef.current.play().catch(() => {});
    }
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  // Adjust volumes in preview
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = audioSettings.originalAudio ? audioSettings.originalVolume / 100 : 0;
    }
    if (audioRef.current) {
      audioRef.current.volume = audioSettings.uploadedAudio ? audioSettings.uploadedVolume / 100 : 0;
    }
  }, [audioSettings]);

  // Upload handler with validation and instant client preview
  const handleFileUpload = async (file: File, type: 'video' | 'audio') => {
    setUploadError(null);

    // Client-side file size check: 500 MB
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 500 MB.`);
      return;
    }

    // 1. Instant local playback: create object URL right away!
    const objectUrl = URL.createObjectURL(file);

    if (type === 'video') {
      setVideoMedia({
        id: `local_${Date.now()}`,
        filename: file.name,
        originalName: file.name,
        size: file.size,
        duration: 0,
        hasVideo: true,
        hasAudio: true,
        url: objectUrl,
        localFile: file,
        serverUploaded: false,
      });
      setProjectName((prev) => (prev === 'Untitled Caption Project' ? file.name.replace(/\.[^/.]+$/, '') : prev));
      setStatusMessage(`Video imported: ${file.name}`);
    } else {
      setAudioMedia({
        id: `local_${Date.now()}`,
        filename: file.name,
        originalName: file.name,
        size: file.size,
        duration: 0,
        hasVideo: false,
        hasAudio: true,
        url: objectUrl,
        localFile: file,
        serverUploaded: false,
      });
      setStatusMessage(`Audio imported: ${file.name}`);
    }

    // 2. Synchronize with backend in the background (if full-stack server is reachable)
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (res.ok) {
          if (type === 'video') {
            setVideoMedia((prev) =>
              prev
                ? {
                    ...prev,
                    filename: data.filename,
                    id: data.id,
                    duration: data.duration || prev.duration,
                    serverUploaded: true,
                  }
                : data
            );
          } else {
            setAudioMedia((prev) =>
              prev
                ? {
                    ...prev,
                    filename: data.filename,
                    id: data.id,
                    duration: data.duration || prev.duration,
                    serverUploaded: true,
                  }
                : data
            );
          }
          setStatusMessage(`Media ready & synced with server: ${file.name}`);
        } else if (data.error) {
          console.warn('Server validation message:', data.error);
        }
      } else {
        // Server returned non-JSON (e.g. 404 from static host)
        console.info('Backend upload bypassed. Running in high-performance browser media mode.');
      }
    } catch (e: any) {
      console.info('Background upload skipped:', e.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Trigger file dialogs
  const handleSelectVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, 'video');
  };

  const handleSelectAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, 'audio');
  };

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    if (file.type.startsWith('video/')) {
      handleFileUpload(file, 'video');
    } else if (file.type.startsWith('audio/')) {
      handleFileUpload(file, 'audio');
    } else {
      setUploadError('Unsupported file type. Please drop an MP4, MOV, WEBM, or audio file.');
    }
  };

  // Preset for Roman Urdu Modi news sample
  const handleLoadModiNewsSample = () => {
    recordHistory();
    setLanguage('roman-ur');
    setWordGrouping('auto');
    setCaptions([
      { id: 'modi_1', start: 0.0, end: 2.8, text: 'Prime Minister Narendra Modi ne' },
      { id: 'modi_2', start: 2.9, end: 6.2, text: 'aaj Delhi mein NAMO KHOJ KHOJ ka udghatan kiya.' },
      { id: 'modi_3', start: 6.3, end: 9.6, text: 'PM ne kaha ki NAMO KHOJ KHOJ se' },
      { id: 'modi_4', start: 9.7, end: 13.8, text: 'logon ko video import karne ki suvidha milegi' },
      { id: 'modi_5', start: 13.9, end: 16.5, text: 'aur caption bhi karein.' },
    ]);
    setActiveCaptionIndex(0);
    setStatusMessage('Loaded NAMO KHOJ KHOJ news captions in Roman Urdu.');
  };

  // Load sample demo video with 1 click
  const handleLoadSampleVideo = async () => {
    setStatusMessage('Loading sample video...');
    try {
      const res = await fetch('/sample.mp4');
      const blob = await res.blob();
      const file = new File([blob], 'namo_khoj_khoj_demo.mp4', { type: 'video/mp4' });
      await handleFileUpload(file, 'video');
      handleLoadModiNewsSample();
      setProjectName('NAMO KHOJ KHOJ News');
      setStatusMessage('Demo video loaded with NAMO KHOJ KHOJ news captions!');
    } catch (err) {
      console.warn('Sample video load error:', err);
      setVideoMedia({
        id: 'sample_video_1',
        filename: 'sample.mp4',
        originalName: 'namo_khoj_khoj_demo.mp4',
        size: 70000,
        duration: 4,
        hasVideo: true,
        hasAudio: true,
        url: '/sample.mp4',
        serverUploaded: false,
      });
      setDuration(4);
      handleLoadModiNewsSample();
    }
  };

  // AI Caption Generation with browser audio extraction fallback
  const handleGenerateCaptions = async () => {
    if (!videoMedia && !audioMedia) {
      setStatusMessage('Please import a video or audio file first.');
      return;
    }

    recordHistory();
    setIsGenerating(true);
    setStatusMessage('Transcribing audio with Gemini AI and aligning timestamps...');

    try {
      let audioBase64: string | null = null;
      const targetMedia = audioMedia || videoMedia;

      // Extract lightweight 16kHz mono audio from browser directly if available
      if (targetMedia?.localFile) {
        setStatusMessage('Extracting audio track for transcription...');
        audioBase64 = await extractAudioBase64(targetMedia.localFile);
      }

      const payload: any = {
        language,
        wordGrouping,
        detectMode,
      };

      if (audioBase64) {
        payload.audioBase64 = audioBase64;
        payload.mimeType = 'audio/wav';
      } else if (targetMedia?.filename) {
        payload.mediaFilename = videoMedia?.filename;
        payload.audioFilename = audioMedia?.filename;
      }

      setStatusMessage('Analyzing speech with Gemini AI...');

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(text.slice(0, 100) || `Server returned ${res.status}`);
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate captions');
      }

      if (data.captions && data.captions.length > 0) {
        setCaptions(data.captions);
        setActiveCaptionIndex(0);
        setStatusMessage(
          `Generated ${data.captions.length} captions in ${data.detectedLanguage || language} with ${wordGrouping} grouping.`
        );
      } else {
        setStatusMessage('No spoken words were detected in the audio.');
      }
    } catch (err: any) {
      console.error('Caption generation error:', err);
      setStatusMessage(`AI Notice: ${err.message}. You can also edit captions directly.`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Word Grouping Change Handler: Regroups existing captions instantly
  const handleWordGroupingChange = async (newGrouping: WordGrouping) => {
    setWordGrouping(newGrouping);
    if (captions.length === 0) return;

    recordHistory();
    try {
      const res = await fetch('/api/regroup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captions,
          grouping: newGrouping,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (res.ok && data.captions) {
          setCaptions(data.captions);
          setActiveCaptionIndex(0);
          setStatusMessage(`Captions regrouped to: ${newGrouping} words.`);
          return;
        }
      }
    } catch (err) {
      console.warn('Server regrouping bypassed', err);
    }
  };

  // Caption Text Editing
  const handleCaptionTextChange = (newText: string) => {
    if (captions.length === 0) return;
    const cleanText = newText.replace(/[\r\n]+/g, ' ');
    setCaptions((prev) => {
      const copy = [...prev];
      copy[activeCaptionIndex] = { ...copy[activeCaptionIndex], text: cleanText };
      return copy;
    });
  };

  // Add caption segment
  const handleAddCaption = () => {
    recordHistory();
    const newStart = Number(currentTime.toFixed(2));
    const newEnd = Number((currentTime + 2.0).toFixed(2));
    const newCap: CaptionItem = {
      id: `cap_manual_${Date.now()}`,
      start: newStart,
      end: newEnd,
      text: 'New caption text',
    };
    const updated = [...captions, newCap].sort((a, b) => a.start - b.start);
    setCaptions(updated);
    const idx = updated.findIndex((c) => c.id === newCap.id);
    setActiveCaptionIndex(idx !== -1 ? idx : 0);
  };

  // Delete caption segment
  const handleDeleteCaption = (id: string) => {
    recordHistory();
    setCaptions((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      return filtered.length > 0 ? filtered : [{ id: 'empty', start: 0, end: 2, text: 'No captions' }];
    });
    setActiveCaptionIndex(0);
  };

  // Save Project
  const handleSaveProject = async () => {
    setStatusMessage('Saving project...');
    const projectData: ProjectData = {
      id: projectId,
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      importMode,
      language,
      wordGrouping,
      videoFile: videoMedia || undefined,
      audioFile: audioMedia || undefined,
      captions,
      style,
      audioSettings,
      exportSettings,
    };

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData),
      });
      if (res.ok) {
        setStatusMessage(`Project "${projectName}" saved successfully.`);
        loadProjects();
      } else {
        throw new Error('Save failed');
      }
    } catch (e: any) {
      setStatusMessage(`Error saving project: ${e.message}`);
    }
  };

  // New Project
  const handleNewProject = () => {
    setProjectId(`proj_${Date.now()}`);
    setProjectName('Untitled Caption Project');
    setVideoMedia(null);
    setAudioMedia(null);
    setCaptions([{ id: 'sample_1', start: 0, end: 2.5, text: 'Your captions will appear here' }]);
    setActiveCaptionIndex(0);
    setStyle(DEFAULT_STYLE);
    setAudioSettings(DEFAULT_AUDIO_SETTINGS);
    setExportSettings(DEFAULT_EXPORT_SETTINGS);
    setActiveRenderJob(null);
    setIsExporting(false);
    setUploadError(null);
    setStatusMessage('New project created. Ready to import media.');
  };

  // Load project into studio
  const handleLoadProject = (proj: ProjectData) => {
    setProjectId(proj.id);
    setProjectName(proj.name);
    setImportMode(proj.importMode || 'video');
    setVideoMedia(proj.videoFile || null);
    setAudioMedia(proj.audioFile || null);
    setCaptions(proj.captions && proj.captions.length > 0 ? proj.captions : [{ id: '1', start: 0, end: 2.5, text: 'Sample' }]);
    setStyle(proj.style || DEFAULT_STYLE);
    setAudioSettings(proj.audioSettings || DEFAULT_AUDIO_SETTINGS);
    setExportSettings(proj.exportSettings || DEFAULT_EXPORT_SETTINGS);
    setLanguage(proj.language || 'en');
    setWordGrouping(proj.wordGrouping || 'auto');
    setCurrentPage('studio');
    setStatusMessage(`Loaded project: "${proj.name}"`);
  };

  // Delete project
  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      loadProjects();
      setStatusMessage('Project deleted.');
    } catch (err) {
      console.warn('Failed to delete project', err);
    }
  };

  // Delete Draft
  const handleDeleteDraft = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/drafts/${id}`, { method: 'DELETE' });
      loadDrafts();
      setStatusMessage('Draft removed from gallery.');
    } catch (err) {
      console.warn('Failed to delete draft', err);
    }
  };

  // Server-Side FFmpeg Video Export
  const handleExportVideo = async () => {
    if (!videoMedia) {
      setStatusMessage('A video file is required for export.');
      return;
    }

    setIsExporting(true);
    setStatusMessage('Initiating full-length server-side video render...');

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaFilename: videoMedia.filename,
          audioFilename: audioMedia?.filename,
          captions,
          style,
          audioSettings,
          exportSettings,
          title: projectName,
          projectId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start export');
      }

      const jobId = data.jobId;
      pollExportJob(jobId);
    } catch (err: any) {
      setIsExporting(false);
      setStatusMessage(`Export error: ${err.message}`);
    }
  };

  // Poll Export Job
  const pollExportJob = (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/export/${jobId}`);
        if (!res.ok) return;
        const job: RenderJob = await res.json();
        setActiveRenderJob(job);

        if (job.status === 'completed') {
          clearInterval(interval);
          setIsExporting(false);
          setStatusMessage('Video export complete! Added to Draft Gallery.');
          loadDrafts();
        } else if (job.status === 'failed') {
          clearInterval(interval);
          setIsExporting(false);
          setStatusMessage(`Export failed: ${job.error || 'Unknown rendering error'}`);
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, 1200);
  };

  // Retry Export Job
  const handleRetryExport = async () => {
    if (!activeRenderJob) return;
    setIsExporting(true);
    setStatusMessage('Retrying export...');
    try {
      const res = await fetch(`/api/export/${activeRenderJob.id}/retry`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.jobId) {
        pollExportJob(data.jobId);
      } else {
        throw new Error(data.error || 'Retry failed');
      }
    } catch (err: any) {
      setIsExporting(false);
      setStatusMessage(`Retry error: ${err.message}`);
    }
  };

  // Active caption text for editing
  const activeCaption = captions[activeCaptionIndex] || captions[0] || { text: '' };

  // Determine current active caption to display on video preview
  const displayCaption = captions.find((c) => currentTime >= c.start && currentTime <= c.end) || null;

  // Format seconds to mm:ss
  const formatTimecode = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <div className="app">
      {/* Hidden audio element for preview track sync */}
      {audioMedia && <audio ref={audioRef} src={audioMedia.url} preload="auto" />}

      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand cursor-pointer" onClick={() => setCurrentPage('home')}>
          <div className="logo">C</div>
          Capora
        </div>
        <nav className="nav">
          <button
            className={currentPage === 'home' ? 'active' : ''}
            onClick={() => setCurrentPage('home')}
          >
            <span className="ico">✦</span>
            <span>Home</span>
          </button>
          <button
            className={currentPage === 'studio' ? 'active' : ''}
            onClick={() => setCurrentPage('studio')}
          >
            <span className="ico">◈</span>
            <span>Caption Studio</span>
          </button>
          <button
            className={currentPage === 'projects' ? 'active' : ''}
            onClick={() => {
              loadProjects();
              setCurrentPage('projects');
            }}
          >
            <span className="ico">▣</span>
            <span>My Projects</span>
          </button>
          <button
            className={currentPage === 'drafts' ? 'active' : ''}
            onClick={() => {
              loadDrafts();
              setCurrentPage('drafts');
            }}
          >
            <span className="ico">▤</span>
            <span>Draft Gallery</span>
          </button>
        </nav>
        <div className="side-note">
          <strong>AI Caption Studio</strong>
          <br />
          Make every word count.
          {backendStatus && !backendStatus.geminiConfigured && (
            <div style={{ marginTop: 8, color: '#fca5a5', fontSize: 11 }}>
              ⚠️ GEMINI_API_KEY is not set in Secrets. AI generation requires this variable.
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main>
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div className="eyebrow">
              {currentPage === 'home'
                ? 'Welcome · Overview'
                : currentPage === 'projects'
                ? 'Library · Saved Work'
                : currentPage === 'drafts'
                ? 'Exports · Ready Videos'
                : 'Create · Edit · Export'}
            </div>
            <h1>
              {currentPage === 'home'
                ? 'Capora Overview'
                : currentPage === 'projects'
                ? 'My Projects'
                : currentPage === 'drafts'
                ? 'Draft Gallery'
                : 'Caption Studio'}
            </h1>
          </div>
          <div className="top-actions">
            {/* Working Undo & Redo arrow buttons without text labels */}
            {currentPage === 'studio' && (
              <>
                <button
                  className="ghost icon-btn"
                  title="Undo"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  aria-label="Undo"
                >
                  ↶
                </button>
                <button
                  className="ghost icon-btn"
                  title="Redo"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  aria-label="Redo"
                >
                  ↷
                </button>
              </>
            )}
            <button className="ghost" id="newProject" onClick={handleNewProject}>
              ＋ New project
            </button>
            <button className="primary" id="saveProject" onClick={handleSaveProject}>
              Save project
            </button>
          </div>
        </div>

        {/* VIEW: HOME PAGE */}
        {currentPage === 'home' && (
          <div>
            <div
              className="card"
              style={{
                padding: '36px 28px',
                marginBottom: 24,
                background: 'linear-gradient(135deg, #13141f, #0d0e14)',
                borderColor: '#37314c',
              }}
            >
              <div style={{ maxWidth: 640 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '4px 10px',
                    borderRadius: 99,
                    background: '#241b3f',
                    color: '#c9b7ff',
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 12,
                  }}
                >
                  ✦ Capora AI Studio
                </span>
                <h2 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 10px', color: '#fff' }}>
                  Effortless AI Captions & Full-Length Video Export
                </h2>
                <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
                  Import up to 30-minute videos, transcribe automatically with Gemini AI across 15+ languages
                  including Urdu script and Roman Urdu, customize styling, animations, and audio mix, and export
                  flawless MP4s with server-side FFmpeg rendering.
                </p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    className="primary"
                    onClick={() => {
                      setImportMode('video');
                      setCurrentPage('studio');
                    }}
                  >
                    Open Caption Studio
                  </button>
                  <button className="ghost" onClick={() => setCurrentPage('projects')}>
                    Browse My Projects ({projectsList.length})
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Start Tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div
                className="card cursor-pointer"
                onClick={() => {
                  setImportMode('video');
                  setCurrentPage('studio');
                }}
                style={{ transition: 'transform 0.15s' }}
              >
                <div style={{ fontSize: 28, marginBottom: 8, color: '#9b7cff' }}>▣</div>
                <h3 style={{ fontSize: 16, margin: '0 0 6px', fontWeight: 700 }}>Video to Captions</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  Import your video file directly. Auto-detect speech and generate perfectly timed single-line captions.
                </p>
              </div>

              <div
                className="card cursor-pointer"
                onClick={() => {
                  setImportMode('audio');
                  setCurrentPage('studio');
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8, color: '#50d6a2' }}>♫</div>
                <h3 style={{ fontSize: 16, margin: '0 0 6px', fontWeight: 700 }}>Audio to Captions</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  Upload voice recordings, interviews, or podcasts to produce transcription subtitles.
                </p>
              </div>

              <div
                className="card cursor-pointer"
                onClick={() => {
                  setImportMode('both');
                  setCurrentPage('studio');
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 8, color: '#c9b7ff' }}>◈</div>
                <h3 style={{ fontSize: 16, margin: '0 0 6px', fontWeight: 700 }}>Video + Audio</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  Combine video footage with separate studio audio track, adjust sync offset, and mix volume.
                </p>
              </div>
            </div>

            {/* Recent Projects preview on Home */}
            {projectsList.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div className="card-head">
                  <h2>Recent Projects</h2>
                  <button className="ghost" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => setCurrentPage('projects')}>
                    View all
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                  {projectsList.slice(0, 3).map((proj) => (
                    <div
                      key={proj.id}
                      className="card cursor-pointer"
                      onClick={() => handleLoadProject(proj)}
                      style={{ background: '#0e1017' }}
                    >
                      <h4 style={{ fontSize: 14, margin: '0 0 6px', fontWeight: 600 }}>{proj.name}</h4>
                      <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 12 }}>
                        <span>{proj.captions?.length || 0} captions</span>
                        <span>{proj.language}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW: MY PROJECTS */}
        {currentPage === 'projects' && (
          <div>
            <div className="card-head">
              <h2>All Saved Projects ({projectsList.length})</h2>
              <button
                className="primary"
                onClick={() => {
                  handleNewProject();
                  setCurrentPage('studio');
                }}
              >
                ＋ Create Project
              </button>
            </div>

            {projectsList.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                <h3 style={{ fontSize: 16, color: '#fff', margin: '0 0 6px' }}>No saved projects yet</h3>
                <p style={{ fontSize: 12, margin: '0 0 16px' }}>
                  Save your caption edits and styling in Caption Studio to access them here anytime.
                </p>
                <button className="primary" onClick={() => setCurrentPage('studio')}>
                  Go to Caption Studio
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 16 }}>
                {projectsList.map((proj) => (
                  <div
                    key={proj.id}
                    className="card"
                    style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <h3 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>{proj.name}</h3>
                        <span
                          style={{
                            fontSize: 10,
                            padding: '3px 7px',
                            borderRadius: 6,
                            background: '#1d1931',
                            color: '#bfa7ff',
                          }}
                        >
                          {proj.importMode}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
                        {proj.videoFile ? proj.videoFile.originalName : 'No video attached'}
                      </p>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#a0a6b8',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 6,
                          background: '#090a0f',
                          padding: '8px 10px',
                          borderRadius: 8,
                          marginBottom: 14,
                        }}
                      >
                        <div>Captions: {proj.captions?.length || 0}</div>
                        <div>Language: {proj.language}</div>
                        <div>Grouping: {proj.wordGrouping || 'auto'}</div>
                        <div>Updated: {new Date(proj.updatedAt).toLocaleDateString()}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="primary"
                        style={{ flex: 1, padding: '8px 10px', fontSize: 12 }}
                        onClick={() => handleLoadProject(proj)}
                      >
                        Open in Studio
                      </button>
                      <button
                        className="ghost"
                        style={{ padding: '8px 12px', color: '#ff6b6b' }}
                        onClick={(e) => handleDeleteProject(proj.id, e)}
                        title="Delete project"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW: DRAFT GALLERY */}
        {currentPage === 'drafts' && (
          <div>
            <div className="card-head">
              <h2>Completed Video Exports ({draftsList.length})</h2>
              <span className="sub">Server-rendered MP4 with burned subtitles</span>
            </div>

            {draftsList.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎬</div>
                <h3 style={{ fontSize: 16, color: '#fff', margin: '0 0 6px' }}>Draft Gallery is empty</h3>
                <p style={{ fontSize: 12, margin: '0 0 16px' }}>
                  Full-length video renders from the Caption Studio will appear here for playback and direct MP4 download.
                </p>
                <button className="primary" onClick={() => setCurrentPage('studio')}>
                  Go to Caption Studio
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18 }}>
                {draftsList.map((draft) => (
                  <div key={draft.id} className="card">
                    <div style={{ aspectRatio: '16/9', background: '#000', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                      <video
                        src={draft.downloadUrl}
                        controls
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    </div>
                    <h3 style={{ fontSize: 15, margin: '0 0 6px', fontWeight: 700 }}>{draft.title}</h3>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        display: 'flex',
                        gap: 12,
                        marginBottom: 14,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>⏱ {formatTimecode(draft.duration)}</span>
                      <span>📺 {draft.resolution}</span>
                      <span>📦 {(draft.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <a
                        href={draft.downloadUrl}
                        download={draft.filename}
                        className="primary"
                        style={{
                          flex: 1,
                          textAlign: 'center',
                          textDecoration: 'none',
                          padding: '9px 12px',
                          fontSize: 12,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        ⇩ Download MP4
                      </a>
                      <button
                        className="ghost"
                        style={{ color: '#ff6b6b', padding: '9px 12px' }}
                        onClick={(e) => handleDeleteDraft(draft.id, e)}
                        title="Delete video export"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW: CAPTION STUDIO */}
        {currentPage === 'studio' && (
          <div className="workspace">
            {/* Left Column: Import, Preview, Timeline, Audio Settings */}
            <section>
              {/* Media Import Card */}
              <div className="card">
                <div className="card-head">
                  <h2>Import your media</h2>
                  <span className="sub">Up to 30 min · 500 MB</span>
                </div>

                {/* Import Modes: Video, Audio, Both */}
                <div className="import-modes">
                  <button
                    className={`mode ${importMode === 'video' ? 'active' : ''}`}
                    onClick={() => setImportMode('video')}
                  >
                    <b>▣</b>Video to captions
                  </button>
                  <button
                    className={`mode ${importMode === 'audio' ? 'active' : ''}`}
                    onClick={() => setImportMode('audio')}
                  >
                    <b>♫</b>Audio to captions
                  </button>
                  <button
                    className={`mode ${importMode === 'both' ? 'active' : ''}`}
                    onClick={() => setImportMode('both')}
                  >
                    <b>◈</b>Video + audio
                  </button>
                </div>

                {/* Upload Box */}
                <div
                  className={`upload ${isDragOver ? 'drag-over' : ''}`}
                  id="uploadBox"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="upload-icon">⇧</div>
                  <h3>
                    {isUploading
                      ? 'Processing media file...'
                      : importMode === 'audio'
                      ? 'Choose an audio file to get started'
                      : importMode === 'both'
                      ? 'Choose a video and separate audio track'
                      : 'Choose a video to get started'}
                  </h3>
                  <p>MP4, MOV, WEBM and common audio formats (Max 500MB, 30 min)</p>

                  <div className="upload-actions">
                    {importMode !== 'audio' && (
                      <button
                        type="button"
                        className="file-label"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (videoInputRef.current) {
                            videoInputRef.current.value = '';
                            videoInputRef.current.click();
                          }
                        }}
                      >
                        ＋ Choose video
                      </button>
                    )}
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept="video/*,video/mp4,video/quicktime,video/webm,video/3gpp,video/x-matroska"
                      style={{ display: 'none' }}
                      onChange={handleSelectVideoFile}
                    />

                    {(importMode === 'audio' || importMode === 'both') && (
                      <button
                        type="button"
                        className="file-label"
                        id="audioLabel"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (audioInputRef.current) {
                            audioInputRef.current.value = '';
                            audioInputRef.current.click();
                          }
                        }}
                      >
                        ♫ Choose audio
                      </button>
                    )}
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept="audio/*,audio/mpeg,audio/wav,audio/m4a,audio/mp3,audio/ogg"
                      style={{ display: 'none' }}
                      onChange={handleSelectAudioFile}
                    />

                    <button
                      type="button"
                      className="file-label"
                      style={{ background: '#241b3f', borderColor: '#6653a5', color: '#e5ddff' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadSampleVideo();
                      }}
                      title="Load sample video with Narendra Modi NAMO KHOJ KHOJ news captions"
                    >
                      ▶ Load Sample Video
                    </button>
                  </div>

                  {uploadError && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: '8px 12px',
                        background: '#35161b',
                        border: '1px solid #73232c',
                        borderRadius: 8,
                        color: '#ff9ba5',
                        fontSize: 12,
                      }}
                    >
                      {uploadError}
                    </div>
                  )}

                  {/* Uploaded media chips */}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                    {videoMedia && (
                      <span
                        style={{
                          background: '#1d2230',
                          border: '1px solid #373e54',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          color: '#cdd3e6',
                        }}
                      >
                        ✓ Video: {videoMedia.originalName} ({formatTimecode(videoMedia.duration)})
                      </span>
                    )}
                    {audioMedia && (
                      <span
                        style={{
                          background: '#1a2723',
                          border: '1px solid #2f5348',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          color: '#9fe5ce',
                        }}
                      >
                        ✓ Audio: {audioMedia.originalName} ({formatTimecode(audioMedia.duration)})
                      </span>
                    )}
                  </div>
                </div>

                {/* Video Preview with Real-Time Subtitle Overlay */}
                <div className="preview" id="preview">
                  {videoMedia ? (
                    <>
                      <video
                        ref={videoRef}
                        src={videoMedia.url}
                        controls
                        playsInline
                        onTimeUpdate={handleTimeUpdate}
                        onPlay={handlePlay}
                        onPause={handlePause}
                        onLoadedMetadata={() => {
                          if (videoRef.current) setDuration(videoRef.current.duration);
                        }}
                      />

                      {/* Subtitle Overlay */}
                      {displayCaption && (
                        <div
                          className={`preview-caption-wrapper ${
                            style.position === 'Top center'
                              ? 'pos-top'
                              : style.position === 'Middle center'
                              ? 'pos-middle'
                              : 'pos-bottom'
                          }`}
                        >
                          <span
                            className={`preview-caption caption-style-${style.styleType} ${
                              style.animation === 'Fade'
                                ? 'anim-fade'
                                : style.animation === 'Pop'
                                ? 'anim-pop'
                                : style.animation === 'Bounce'
                                ? 'anim-bounce'
                                : style.animation === 'Slide up'
                                ? 'anim-slide-up'
                                : style.animation === 'Word highlight'
                                ? 'anim-highlight'
                                : ''
                            }`}
                            style={{
                              fontFamily: style.font === 'System default' ? 'inherit' : style.font,
                              fontSize:
                                style.size === 'Small'
                                  ? 14
                                  : style.size === 'Large'
                                  ? 22
                                  : style.size === 'Extra large'
                                  ? 28
                                  : 18,
                              fontWeight:
                                style.weight === 'Normal'
                                  ? 400
                                  : style.weight === 'Extra bold'
                                  ? 800
                                  : style.weight === 'Black'
                                  ? 900
                                  : 700,
                              color: style.color,
                            }}
                          >
                            {displayCaption.text}
                          </span>
                        </div>
                      )}
                    </>
                  ) : audioMedia && !videoMedia ? (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                      <div style={{ fontSize: 36, marginBottom: 8 }}>♫</div>
                      <strong style={{ display: 'block', fontSize: 15, marginBottom: 6 }}>
                        Audio Track Loaded: {audioMedia.originalName}
                      </strong>
                      <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
                        {formatTimecode(currentTime)} / {formatTimecode(duration || audioMedia.duration)}
                      </p>
                      <button
                        className="ghost"
                        style={{ marginTop: 12, padding: '6px 14px' }}
                        onClick={() => {
                          if (audioRef.current) {
                            if (audioRef.current.paused) audioRef.current.play();
                            else audioRef.current.pause();
                          }
                        }}
                      >
                        Play / Pause Audio
                      </button>
                    </div>
                  ) : (
                    <div className="preview-placeholder">
                      <strong>Your video preview</strong>
                      Import media to see it here
                    </div>
                  )}
                </div>

                {/* Caption Timeline */}
                <div className="timeline">
                  <div className="card-head">
                    <h2>Caption timeline</h2>
                    <span className="sub">
                      {captions.length} clip{captions.length !== 1 ? 's' : ''} · Click to jump
                    </span>
                  </div>

                  <div className="track-container">
                    <div className="track">
                      {captions.map((cap, idx) => (
                        <div
                          key={cap.id}
                          className={`clip ${activeCaptionIndex === idx ? 'active' : ''}`}
                          onClick={() => {
                            setActiveCaptionIndex(idx);
                            if (videoRef.current) {
                              videoRef.current.currentTime = cap.start;
                            }
                            if (audioRef.current) {
                              audioRef.current.currentTime = Math.max(0, cap.start + audioSettings.syncOffset);
                            }
                          }}
                          title={`[${formatTimecode(cap.start)} - ${formatTimecode(cap.end)}] ${cap.text}`}
                        >
                          {cap.text.slice(0, 18) || `Caption ${idx + 1}`}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="timeline-tools">
                    <span>{formatTimecode(currentTime)}</span>
                    <button
                      className="ghost"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={handleAddCaption}
                      title="Add caption at current playback time"
                    >
                      ＋ Add caption at playhead
                    </button>
                    <span>{formatTimecode(duration)}</span>
                  </div>
                </div>
              </div>

              {/* Audio Settings Card */}
              <div className="card section-gap">
                <div className="card-head">
                  <h2>Audio settings</h2>
                  <span className="sub">Control each track</span>
                </div>

                {/* Original Video Audio */}
                <div className="toggle-row">
                  <span>Original video audio</span>
                  <button
                    className={`switch ${audioSettings.originalAudio ? 'on' : ''}`}
                    onClick={() => {
                      recordHistory();
                      setAudioSettings((prev) => ({
                        ...prev,
                        originalAudio: !prev.originalAudio,
                      }));
                    }}
                    aria-label="Toggle original video audio"
                  />
                </div>
                <div className="range-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={audioSettings.originalVolume}
                    disabled={!audioSettings.originalAudio}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        originalVolume: Number(e.target.value),
                      }))
                    }
                  />
                  <output>{audioSettings.originalVolume}%</output>
                </div>

                {/* Uploaded Audio Track */}
                <div className="toggle-row">
                  <span>Uploaded audio track</span>
                  <button
                    className={`switch ${audioSettings.uploadedAudio ? 'on' : ''}`}
                    onClick={() => {
                      recordHistory();
                      setAudioSettings((prev) => ({
                        ...prev,
                        uploadedAudio: !prev.uploadedAudio,
                      }));
                    }}
                    aria-label="Toggle uploaded audio"
                  />
                </div>
                <div className="range-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={audioSettings.uploadedVolume}
                    disabled={!audioSettings.uploadedAudio}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        uploadedVolume: Number(e.target.value),
                      }))
                    }
                  />
                  <output>{audioSettings.uploadedVolume}%</output>
                </div>

                {/* Audio Sync Offset */}
                <div className="field section-gap">
                  <label htmlFor="sync">Audio sync offset (seconds)</label>
                  <input
                    id="sync"
                    type="number"
                    step="0.1"
                    value={audioSettings.syncOffset}
                    onChange={(e) =>
                      setAudioSettings((prev) => ({
                        ...prev,
                        syncOffset: parseFloat(e.target.value) || 0,
                      }))
                    }
                  />
                  <span className="hint">
                    Use a positive or negative value to align the uploaded audio with the video.
                  </span>
                </div>
              </div>
            </section>

            {/* Right Column: AI Caption Settings, Styling, Export */}
            <section>
              {/* AI Caption Settings Card */}
              <div className="card">
                <div className="card-head">
                  <h2>AI caption settings</h2>
                  <span className="sub">Set your language</span>
                </div>

                <div className="controls">
                  {/* Language Selector */}
                  <div className="field">
                    <label htmlFor="language">Caption language</label>
                    <select
                      id="language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      <option value="auto">Auto detect language</option>
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="pt">Portuguese</option>
                      <option value="ar">Arabic</option>
                      <option value="hi">Hindi</option>
                      <option value="ur">Urdu — اردو</option>
                      <option value="roman-ur">Roman Urdu — Aap kaise hain?</option>
                      <option value="zh">Chinese</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                      <option value="tr">Turkish</option>
                      <option value="it">Italian</option>
                      <option value="ru">Russian</option>
                      <option value="bn">Bengali</option>
                    </select>
                    <span className="hint">
                      Urdu and Roman Urdu are separate output choices. Roman Urdu uses Urdu words written in
                      Latin letters.
                    </span>
                  </div>

                  {/* Word Grouping Options */}
                  <div className="field">
                    <label htmlFor="mode">Word grouping</label>
                    <select
                      id="mode"
                      value={wordGrouping}
                      onChange={(e) => handleWordGroupingChange(e.target.value as WordGrouping)}
                    >
                      <option value="auto">Auto — Natural spoken phrases</option>
                      <option value="1-2">1–2 words</option>
                      <option value="2-3">2–3 words</option>
                      <option value="3-4">3–4 words</option>
                      <option value="4-5">4–5 words</option>
                      <option value="5-6">5–6 words</option>
                    </select>
                    <span className="hint">
                      Applied across the video. Captions are strictly rendered on one line.
                    </span>
                  </div>

                  {/* Language Detection Mode */}
                  <div className="field">
                    <label htmlFor="detect">Language detection</label>
                    <select
                      id="detect"
                      value={detectMode}
                      onChange={(e) => setDetectMode(e.target.value as any)}
                    >
                      <option value="auto">Auto detect spoken language</option>
                      <option value="strict">Use selected language only</option>
                    </select>
                  </div>

                  {/* Font & Size */}
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="font">Caption font</label>
                      <select
                        id="font"
                        value={style.font}
                        onChange={(e) => {
                          recordHistory();
                          setStyle((prev) => ({ ...prev, font: e.target.value }));
                        }}
                      >
                        <option value="Inter">Inter</option>
                        <option value="Arial">Arial</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Montserrat">Montserrat</option>
                        <option value="Roboto">Roboto</option>
                        <option value="System default">System default</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="size">Text size</label>
                      <select
                        id="size"
                        value={style.size}
                        onChange={(e) => {
                          recordHistory();
                          setStyle((prev) => ({ ...prev, size: e.target.value as any }));
                        }}
                      >
                        <option value="Small">Small</option>
                        <option value="Medium">Medium</option>
                        <option value="Large">Large</option>
                        <option value="Extra large">Extra large</option>
                      </select>
                    </div>
                  </div>

                  {/* Weight & Style Type */}
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="weight">Font weight</label>
                      <select
                        id="weight"
                        value={style.weight}
                        onChange={(e) => {
                          recordHistory();
                          setStyle((prev) => ({ ...prev, weight: e.target.value as any }));
                        }}
                      >
                        <option value="Normal">Normal</option>
                        <option value="Bold">Bold</option>
                        <option value="Extra bold">Extra bold</option>
                        <option value="Black">Black</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="styleType">Caption style</label>
                      <select
                        id="styleType"
                        value={style.styleType}
                        onChange={(e) => {
                          recordHistory();
                          setStyle((prev) => ({ ...prev, styleType: e.target.value as any }));
                        }}
                      >
                        <option value="clean">Clean (Subtle shadow)</option>
                        <option value="box">Box (Dark pill background)</option>
                        <option value="outline">Outline (Stroke border)</option>
                        <option value="shadow">Drop shadow</option>
                      </select>
                    </div>
                  </div>

                  {/* Color & Animation */}
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="color">Text color</label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          id="color"
                          type="color"
                          value={style.color}
                          onChange={(e) => {
                            recordHistory();
                            setStyle((prev) => ({ ...prev, color: e.target.value }));
                          }}
                          style={{
                            width: '100%',
                            height: 42,
                            background: '#0c0e14',
                            border: '1px solid var(--line)',
                            borderRadius: 9,
                            padding: 4,
                            cursor: 'pointer',
                          }}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="animation">Caption animation</label>
                      <select
                        id="animation"
                        value={style.animation}
                        onChange={(e) => {
                          recordHistory();
                          setStyle((prev) => ({ ...prev, animation: e.target.value as any }));
                        }}
                      >
                        <option value="None">None</option>
                        <option value="Fade">Fade</option>
                        <option value="Pop">Pop</option>
                        <option value="Bounce">Bounce</option>
                        <option value="Slide up">Slide up</option>
                        <option value="Word highlight">Word highlight</option>
                      </select>
                    </div>
                  </div>

                  {/* Live Caption Text Editing */}
                  <div className="field">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label htmlFor="captionText">
                        Edit caption [{formatTimecode(activeCaption.start)} - {formatTimecode(activeCaption.end)}]
                      </label>
                      <button
                        className="ghost"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => setShowCaptionsList(!showCaptionsList)}
                      >
                        {showCaptionsList ? 'Hide all' : `Show all (${captions.length})`}
                      </button>
                    </div>
                    <input
                      id="captionText"
                      type="text"
                      value={activeCaption.text}
                      onChange={(e) => handleCaptionTextChange(e.target.value)}
                      placeholder="Type caption text..."
                    />
                  </div>

                  {/* Expandable Caption Segments List */}
                  {showCaptionsList && (
                    <div className="captions-manager">
                      {captions.map((cap, idx) => (
                        <div
                          key={cap.id}
                          className={`caption-row ${activeCaptionIndex === idx ? 'active' : ''}`}
                          onClick={() => {
                            setActiveCaptionIndex(idx);
                            if (videoRef.current) videoRef.current.currentTime = cap.start;
                          }}
                        >
                          <span className="caption-time">
                            {formatTimecode(cap.start)}-{formatTimecode(cap.end)}
                          </span>
                          <input
                            className="caption-input-edit"
                            value={cap.text}
                            onChange={(e) => {
                              const updated = [...captions];
                              updated[idx].text = e.target.value.replace(/[\r\n]+/g, ' ');
                              setCaptions(updated);
                            }}
                          />
                          <button
                            className="btn-del-cap"
                            title="Delete caption"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCaption(cap.id);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Position */}
                  <div className="field">
                    <label htmlFor="position">Caption position</label>
                    <select
                      id="position"
                      value={style.position}
                      onChange={(e) => {
                        recordHistory();
                        setStyle((prev) => ({ ...prev, position: e.target.value as any }));
                      }}
                    >
                      <option value="Bottom center">Bottom center</option>
                      <option value="Top center">Top center</option>
                      <option value="Middle center">Middle center</option>
                    </select>
                  </div>

                  <div className="language-note">
                    Designed with English-speaking audiences in mind, while supporting multiple caption
                    languages and separate Urdu / Roman Urdu output.
                  </div>

                  {/* Generate Button */}
                  <button
                    className="primary generate"
                    id="generate"
                    disabled={isGenerating || (!videoMedia && !audioMedia)}
                    onClick={handleGenerateCaptions}
                  >
                    {isGenerating ? '✦ Transcribing with Gemini AI...' : '✦ Generate captions'}
                  </button>

                  <button
                    type="button"
                    className="ghost"
                    style={{ width: '100%', marginTop: 6, fontSize: 11, padding: '7px 10px' }}
                    onClick={handleLoadModiNewsSample}
                    title="Load sample news captions for Narendra Modi NAMO KHOJ KHOJ in Roman Urdu"
                  >
                    ⚡ Load NAMO KHOJ KHOJ sample (Roman Urdu)
                  </button>

                  <p className="hint" id="status" aria-live="polite">
                    {statusMessage}
                  </p>
                </div>
              </div>

              {/* Export Video Card */}
              <div className="card section-gap">
                <div className="card-head">
                  <h2>Export video</h2>
                  <span className="sub">Full video render</span>
                </div>

                <div className="field">
                  <label htmlFor="resolution">Export resolution</label>
                  <select
                    id="resolution"
                    value={exportSettings.resolution}
                    onChange={(e) =>
                      setExportSettings((prev) => ({ ...prev, resolution: e.target.value as any }))
                    }
                  >
                    <option value="Original resolution">Original resolution</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                  </select>
                </div>

                <div className="field section-gap">
                  <label htmlFor="ratio">Aspect ratio</label>
                  <select
                    id="ratio"
                    value={exportSettings.ratio}
                    onChange={(e) =>
                      setExportSettings((prev) => ({ ...prev, ratio: e.target.value as any }))
                    }
                  >
                    <option value="Original">Original</option>
                    <option value="9:16 — Shorts / Reels">9:16 — Shorts / Reels</option>
                    <option value="16:9 — YouTube">16:9 — YouTube</option>
                    <option value="1:1 — Square">1:1 — Square</option>
                  </select>
                </div>

                <button
                  className="primary generate"
                  id="export"
                  disabled={isExporting || !videoMedia}
                  onClick={handleExportVideo}
                >
                  {isExporting ? 'Exporting video in background...' : 'Export video'}
                </button>

                {/* Progress / Status Block */}
                {activeRenderJob && (
                  <div className="progress-box">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{activeRenderJob.currentStep}</span>
                      <span>{activeRenderJob.progress}%</span>
                    </div>

                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${activeRenderJob.progress}%` }}
                      />
                    </div>

                    {activeRenderJob.status === 'completed' && activeRenderJob.downloadUrl && (
                      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                        <a
                          href={activeRenderJob.downloadUrl}
                          download={activeRenderJob.outputFilename}
                          className="primary"
                          style={{
                            padding: '8px 14px',
                            fontSize: 12,
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          ⇩ Download Rendered MP4
                        </a>
                        <button
                          className="ghost"
                          style={{ fontSize: 12, padding: '8px 12px' }}
                          onClick={() => setCurrentPage('drafts')}
                        >
                          View in Draft Gallery
                        </button>
                      </div>
                    )}

                    {activeRenderJob.status === 'failed' && (
                      <div style={{ marginTop: 10 }}>
                        <p style={{ color: '#ff6b6b', fontSize: 12, margin: '0 0 8px' }}>
                          {activeRenderJob.error || 'Export failed.'}
                        </p>
                        <button
                          className="ghost"
                          style={{ fontSize: 12, padding: '6px 12px' }}
                          onClick={handleRetryExport}
                        >
                          ↻ Retry Export
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <p className="hint">
                  Reliable full-length video rendering runs on dedicated server-side FFmpeg, burning styled captions
                  and mixing audio without browser canvas limits.
                </p>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
