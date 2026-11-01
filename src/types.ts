export interface CaptionItem {
  id: string;
  start: number;
  end: number;
  text: string;
}

export type WordGrouping = 'auto' | '1-2' | '2-3' | '3-4' | '4-5' | '5-6';

export interface CaptionStyle {
  font: string;
  size: 'Small' | 'Medium' | 'Large' | 'Extra large';
  weight: 'Normal' | 'Bold' | 'Extra bold' | 'Black';
  color: string;
  position: 'Bottom center' | 'Top center' | 'Middle center';
  styleType: 'clean' | 'box' | 'outline' | 'shadow';
  animation: 'None' | 'Fade' | 'Pop' | 'Bounce' | 'Slide up' | 'Typewriter' | 'Word highlight';
}

export interface AudioSettings {
  originalAudio: boolean;
  originalVolume: number;
  uploadedAudio: boolean;
  uploadedVolume: number;
  syncOffset: number;
}

export interface ExportSettings {
  resolution: 'Original resolution' | '1080p' | '720p';
  ratio: 'Original' | '9:16 — Shorts / Reels' | '16:9 — YouTube' | '1:1 — Square';
}

export interface UploadedMedia {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  duration: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  url: string;
}

export interface ProjectData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  importMode: 'video' | 'audio' | 'both';
  language: string;
  wordGrouping: WordGrouping;
  videoFile?: UploadedMedia;
  audioFile?: UploadedMedia;
  captions: CaptionItem[];
  style: CaptionStyle;
  audioSettings: AudioSettings;
  exportSettings: ExportSettings;
}

export interface DraftExportItem {
  id: string;
  jobId: string;
  projectId?: string;
  title: string;
  createdAt: string;
  duration: number;
  resolution: string;
  ratio: string;
  filename: string;
  fileSize: number;
  downloadUrl: string;
}

export interface RenderJob {
  id: string;
  projectId?: string;
  title: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep: string;
  outputPath?: string;
  outputFilename?: string;
  fileSize?: number;
  duration?: number;
  downloadUrl?: string;
  error?: string;
}
