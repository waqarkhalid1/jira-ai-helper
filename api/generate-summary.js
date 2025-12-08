import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({ error: "Missing ticket description" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Summarize Jira ticket professionally." },
        { role: "user", content: description }
      ]
    });

    const summary = response.choices[0].message.content;
    return res.status(200).json({ summary });

  } catch (error) {
    console.error("AI SUMMARY ERROR:", error);
    res.status(500).json({ error: "AI summary failed" });
  }
}
