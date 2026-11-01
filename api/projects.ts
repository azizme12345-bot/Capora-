const inMemoryProjects: any[] = [];

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json(inMemoryProjects);
  }

  if (req.method === 'POST') {
    const project = req.body;
    if (project && project.id) {
      const idx = inMemoryProjects.findIndex((p) => p.id === project.id);
      if (idx !== -1) {
        inMemoryProjects[idx] = project;
      } else {
        inMemoryProjects.unshift(project);
      }
    }
    return res.status(200).json({ success: true, project });
  }

  return res.status(200).json({ success: true });
}
