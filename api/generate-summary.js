export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Only POST method allowed' });
    }

    const { description, userId } = req.body;

    if (!description || !userId) {
      return res.status(400).json({ error: 'Missing description or userId' });
    }

    return res.status(200).json({
      summary: `AI Summary generated for user ${userId}: ${description.substring(0, 50)}...`
    });

  } catch (error) {
    return res.status(500).json({ error: "Server error", details: error.toString() });
  }
}
