const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // CORS / preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    const body = req.body || {};
    const { issueKey, jiraUrl, jiraEmail, jiraToken, description: passedDescription } = body;

    if (!issueKey) return res.status(400).json({ error: 'Missing issueKey in request body.' });
    if (!jiraUrl) return res.status(400).json({ error: 'Missing jiraUrl in request body.' });
    if (!jiraEmail || !jiraToken) return res.status(400).json({ error: 'Missing jiraEmail or jiraToken in request body.' });

    const base = jiraUrl.replace(/\/+$/, '');
    const jiraApiUrl = `${base}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description,comment`;

    const authHeader = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

    const jiraResp = await fetch(jiraApiUrl, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    });

    if (!jiraResp.ok) {
      const text = await jiraResp.text();
      return res.status(jiraResp.status).json({ error: 'Jira API error', details: text });
    }

    const jiraJson = await jiraResp.json();
    const title = jiraJson.fields?.summary || '';
    const description = jiraJson.fields?.description ? (typeof jiraJson.fields.description === 'string' ? jiraJson.fields.description : JSON.stringify(jiraJson.fields.description)) : (passedDescription || '');
    const commentsArray = jiraJson.fields?.comment?.comments || [];
    const commentsText = commentsArray.map(c => {
      const author = c.author?.displayName || c.author?.name || 'Unknown';
      return `${author}: ${typeof c.body === 'string' ? c.body : JSON.stringify(c.body)}`;
    }).join('\n\n');

    const prompt = [
      `You are an assistant that summarizes Jira issues for developers.`,
      `Ticket: ${issueKey}`,
      `Title: ${title}`,
      `Description: ${description}`,
      `Comments:`,
      commentsText || '(no comments)',
      '',
      'Return ONLY valid JSON with keys: one_line_summary (string), tasks (array of short actionable tasks), final_comment (string).'
    ].join('\n');

    const openaiKey = process.env.OPENAI_API_KEY || process.env.Jira_AI_Key || process.env.JIRA_AI_KEY;
    if (!openaiKey) return res.status(500).json({ error: 'OpenAI API key not configured on the server. Set OPENAI_API_KEY.' });

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Return ONLY JSON with keys: one_line_summary, tasks (array), final_comment.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 800
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return res.status(openaiResp.status).json({ error: 'OpenAI API error', details: errText });
    }

    const openaiJson = await openaiResp.json();
    const answer = openaiJson.choices?.[0]?.message?.content || openaiJson.choices?.[0]?.text || '';

    let parsed = null;
    try {
      parsed = JSON.parse(answer);
    } catch (err) {
      parsed = { raw: answer };
    }

    res.status(200).json({
      summary: parsed,
      jira: {
        key: jiraJson.key,
        title,
        description: typeof description === 'string' ? description : JSON.stringify(description),
        commentsCount: commentsArray.length
      },
    });
  } catch (err) {
    console.error('Error in generate-summary:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
};