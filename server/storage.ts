import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

// Ensure directories exist
for (const dir of [DATA_DIR, UPLOADS_DIR, EXPORTS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Optional Cloudflare R2 Client configuration
const r2AccountId = process.env.R2_ACCOUNT_ID;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2BucketName = process.env.R2_BUCKET_NAME;
const r2PublicUrl = process.env.R2_PUBLIC_URL;

let s3Client: S3Client | null = null;
if (r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2BucketName) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
  });
}

export function isR2Configured(): boolean {
  return s3Client !== null && !!r2BucketName;
}

export async function uploadToR2IfConfigured(
  localFilePath: string,
  key: string,
  contentType: string
): Promise<string | null> {
  if (!s3Client || !r2BucketName) return null;
  try {
    const fileStream = fs.createReadStream(localFilePath);
    const command = new PutObjectCommand({
      Bucket: r2BucketName,
      Key: key,
      Body: fileStream,
      ContentType: contentType,
    });
    await s3Client.send(command);
    if (r2PublicUrl) {
      return `${r2PublicUrl.replace(/\/$/, '')}/${key}`;
    }
    return `/api/r2/${key}`;
  } catch (err) {
    console.warn('[R2 Storage] Failed to upload to Cloudflare R2, falling back to local:', err);
    return null;
  }
}
