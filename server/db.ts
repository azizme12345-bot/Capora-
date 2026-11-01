import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const DRAFTS_FILE = path.join(DATA_DIR, 'drafts.json');

export interface CaptionItem {
  id: string;
  start: number;
  end: number;
  text: string;
}

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

export interface ProjectData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  importMode: 'video' | 'audio' | 'both';
  language: string;
  wordGrouping: 'auto' | '1-2' | '2-3' | '3-4' | '4-5' | '5-6';
  videoFile?: {
    id: string;
    filename: string;
    originalName: string;
    size: number;
    duration: number;
    width?: number;
    height?: number;
  };
  audioFile?: {
    id: string;
    filename: string;
    originalName: string;
    size: number;
    duration: number;
  };
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

function readJsonFile<T>(filePath: string, defaultVal: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2), 'utf-8');
      return defaultVal;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultVal;
  }
}

function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

export const db = {
  getProjects(): ProjectData[] {
    return readJsonFile<ProjectData[]>(PROJECTS_FILE, []);
  },
  getProjectById(id: string): ProjectData | undefined {
    const list = this.getProjects();
    return list.find((p) => p.id === id);
  },
  saveProject(project: ProjectData): ProjectData {
    const list = this.getProjects();
    const index = list.findIndex((p) => p.id === project.id);
    project.updatedAt = new Date().toISOString();
    if (index >= 0) {
      list[index] = project;
    } else {
      list.unshift(project);
    }
    writeJsonFile(PROJECTS_FILE, list);
    return project;
  },
  deleteProject(id: string): boolean {
    const list = this.getProjects();
    const filtered = list.filter((p) => p.id !== id);
    if (filtered.length !== list.length) {
      writeJsonFile(PROJECTS_FILE, filtered);
      return true;
    }
    return false;
  },

  getDrafts(): DraftExportItem[] {
    return readJsonFile<DraftExportItem[]>(DRAFTS_FILE, []);
  },
  addDraft(draft: DraftExportItem): void {
    const list = this.getDrafts();
    list.unshift(draft);
    writeJsonFile(DRAFTS_FILE, list);
  },
  deleteDraft(id: string): boolean {
    const list = this.getDrafts();
    const draft = list.find((d) => d.id === id);
    if (!draft) return false;

    // Delete exported file if exists
    try {
      const fullPath = path.resolve(process.cwd(), 'data', 'exports', draft.filename);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (e) {
      console.warn('Failed to delete draft file:', e);
    }

    const filtered = list.filter((d) => d.id !== id);
    writeJsonFile(DRAFTS_FILE, filtered);
    return true;
  },
};
