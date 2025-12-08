export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { description, userId } = req.body;

  return res.status(200).json({
    summary: `AI Summary: ${description?.substring(0, 80) || ''}...`
  });
}
