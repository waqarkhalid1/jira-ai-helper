const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Basic CORS / preflight handling (safe for VS Code webviews or browser calls)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    const body = req.body || {};
    const { issueKey, jiraUrl, jiraEmail, jiraToken } = body;

    if (!issueKey) return res.status(400).json({ error: 'Missing issueKey in request body.' });
    if (!jiraUrl) return res.status(400).json({ error: 'Missing jiraUrl in request body.' });
    // jiraEmail/jiraToken can be optional if you handle auth in the extension; validate per your flow
    if (!jiraEmail || !jiraToken) return res.status(400).json({ error: 'Missing jiraEmail or jiraToken in request body.' });

    // Build Jira API URL (Cloud REST API v2)
    const base = jiraUrl.replace(/\/+$/, '');
    const jiraApiUrl = `${base}/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=summary,description,comment`;

    // Basic auth for Jira
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
    const description = jiraJson.fields?.description || '';
    const commentsArray = jiraJson.fields?.comment?.comments || [];
    const commentsText = commentsArray.map(c => {
      const author = c.author?.displayName || c.author?.name || 'Unknown';
      // Jira comment bodies can be storage format; for simplicity use body as-is
      return `${author}: ${c.body}`;
    }).join('\n\n');

    // Compose prompt
    const prompt = [
      `You are an expert assistant that summarizes Jira issues for developers.`,
      `Ticket: ${issueKey}`,
      `Title: ${title}`,
      `Description: ${description}`,
      `Comments:`,
      commentsText || '(no comments)',
      '',
      'Return ONLY valid JSON with keys: one_line_summary (string), tasks (array of short actionable tasks), final_comment (string suitable for posting as a Jira comment).'
    ].join('\n');

    const openaiKey = process.env.OPENAI_API_KEY || process.env.Jira_AI_Key || process.env.JIRA_AI_KEY;
    if (!openaiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured on the server. Set OPENAI_API_KEY or Jira_AI_Key.' });
    }

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a concise assistant who returns ONLY JSON with keys one_line_summary, tasks (array), final_comment.' },
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

    // Try to parse JSON output from model
    let parsed = null;
    try {
      parsed = JSON.parse(answer);
    } catch (err) {
      // If model didn't return parseable JSON, put raw answer into `raw` key
      parsed = { raw: answer };
    }

    // Return summary + some Jira metadata
    res.status(200).json({
      summary: parsed,
      jira: {
        key: jiraJson.key,
        title,
        description,
        commentsCount: commentsArray.length
      },
    });
  } catch (err) {
    console.error('Error in generate-summary:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
};