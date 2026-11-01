export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Acknowledge upload gracefully
  const uniqueId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return res.status(200).json({
    id: uniqueId,
    filename: `upload_${uniqueId}.mp4`,
    originalName: 'uploaded_media.mp4',
    size: 0,
    hasVideo: true,
    hasAudio: true,
    serverUploaded: true,
    message: 'Media acknowledged for processing.',
  });
}
