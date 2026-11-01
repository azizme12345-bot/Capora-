export default function handler(req: any, res: any) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
  res.status(200).json({
    geminiConfigured: hasGemini,
    platform: 'vercel-serverless',
    maxDurationMinutes: 30,
    maxUploadSizeMB: 500,
  });
}
