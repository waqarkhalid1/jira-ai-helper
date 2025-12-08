export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Only POST allowed' });
    }

    const { description, userId } = req.body;

    if (!description || !userId) {
      return res.status(400).json({ error: 'Missing description or userId' });
    }

    // Temporary dummy response
    return res.status(200).json({
      summary: `AI Summary is working for user: ${userId}`
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: err });
  }
}
