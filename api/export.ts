export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const jobId = `job_${Date.now()}`;
  return res.status(200).json({
    jobId,
    status: 'queued',
    progress: 10,
    message: 'Rendering queued',
  });
}
