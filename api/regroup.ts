export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { captions = [], grouping = 'auto' } = req.body || {};

  if (!captions || captions.length === 0) {
    return res.status(200).json({ captions: [] });
  }

  if (grouping === 'auto') {
    return res.status(200).json({
      captions: captions.map((c: any) => ({
        ...c,
        text: String(c.text || '').replace(/[\r\n]+/g, ' ').trim(),
      })),
    });
  }

  interface WordTime {
    word: string;
    start: number;
    end: number;
  }
  const allWords: WordTime[] = [];

  for (const cap of captions) {
    const words = String(cap.text || '').split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const duration = Math.max(0.1, (Number(cap.end) || 0) - (Number(cap.start) || 0));
    const wordDuration = duration / words.length;

    words.forEach((w, i) => {
      allWords.push({
        word: w,
        start: Number(((Number(cap.start) || 0) + i * wordDuration).toFixed(2)),
        end: Number(((Number(cap.start) || 0) + (i + 1) * wordDuration).toFixed(2)),
      });
    });
  }

  if (allWords.length === 0) {
    return res.status(200).json({ captions });
  }

  let maxWords = 3;
  if (grouping === '1-2') maxWords = 2;
  else if (grouping === '2-3') maxWords = 3;
  else if (grouping === '3-4') maxWords = 4;
  else if (grouping === '4-5') maxWords = 5;
  else if (grouping === '5-6') maxWords = 6;

  const result: any[] = [];
  let currentGroup: WordTime[] = [];

  for (let i = 0; i < allWords.length; i++) {
    currentGroup.push(allWords[i]);
    const isPunctuationBreak = /[.!?]$/.test(allWords[i].word);
    const reachedLimit = currentGroup.length >= maxWords;
    const isLastWord = i === allWords.length - 1;

    if (reachedLimit || isPunctuationBreak || isLastWord) {
      const first = currentGroup[0];
      const last = currentGroup[currentGroup.length - 1];
      result.push({
        id: `cap_grp_${result.length}_${Date.now()}`,
        start: first.start,
        end: Math.max(first.start + 0.3, last.end),
        text: currentGroup.map((w) => w.word).join(' '),
      });
      currentGroup = [];
    }
  }

  return res.status(200).json({ captions: result });
}
