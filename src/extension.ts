import * as vscode from 'vscode';
import fetch from 'node-fetch';

/**
 * Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Jira AI Helper activated');

    const disposable = vscode.commands.registerCommand('jiraAi.fetchTicket', async () => {
        try {
            const config = vscode.workspace.getConfiguration("jiraAiHelper");
            const jiraUrl = config.get<string>("jiraUrl");
            const email = config.get<string>("email");
            const apiToken = config.get<string>("apiToken");
            const summaryApi = "https://jira-ai-helper-fe7rlstn5-waqar-khalids-projects-490fb453.vercel.app/api/generate-summary";
 // Vercel function URL

            if (!jiraUrl || !email || !apiToken || !summaryApi) {
                vscode.window.showErrorMessage(
                    "Please set Jira URL, Email, API Token, and Summary API URL in Settings → Jira AI Helper"
                );
                return;
            }

            const issueKey = await vscode.window.showInputBox({
                prompt: 'Enter Jira ticket key (e.g. TLC-27)'
            });
            if (!issueKey) return;

            // 1️⃣ Fetch Jira ticket + comments
            const jiraData = await fetchJiraIssue(jiraUrl, issueKey, email, apiToken);
            if (!jiraData) {
                vscode.window.showErrorMessage("Failed to fetch Jira ticket details.");
                return;
            }

            // 2️⃣ Call your Vercel function to generate summary
            const aiSummary = await fetchAiSummary(summaryApi, {
                issueKey,
                jiraUrl,
                jiraEmail: email,
                jiraToken: apiToken,
                description: jiraData.description
            });

            const prompt = buildPrompt(issueKey, jiraData.summary, jiraData.description, jiraData.comments, aiSummary);

            const doc = await vscode.workspace.openTextDocument({
                language: "markdown",
                content: prompt
            });

            vscode.window.showTextDocument(doc, { preview: false });

        } catch (err) {
            console.error("Error in Jira AI Helper:", err);
            vscode.window.showErrorMessage("Unexpected error while fetching Jira ticket or AI summary.");
        }
    });

    context.subscriptions.push(disposable);
}

/**
 * Fetch Jira Ticket Details (summary, description, comments)
 */
async function fetchJiraIssue(
    jiraUrl: string,
    issueKey: string,
    email: string,
    apiToken: string
): Promise<{ summary: string; description: string; comments: string } | null> {
    try {
        const response = await fetch(`${jiraUrl}/rest/api/3/issue/${issueKey}?fields=summary,description,comment`, {
            headers: {
                "Authorization": "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64"),
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            console.error("Jira API error:", response.status, response.statusText);
            return null;
        }

        const data: any = await response.json();
        const summary = data.fields?.summary || "(No summary)";
        const desc = data.fields?.description;
        const descriptionText = desc ? (typeof desc === "string" ? desc : JSON.stringify(desc)) : "";

        const commentsArray: any[] = data.fields?.comment?.comments || [];
        const commentsText = commentsArray.map((c: any) => {
            const author = c.author?.displayName || c.author?.name || 'Unknown';
            const body = typeof c.body === 'string' ? c.body : JSON.stringify(c.body);
            return `- ${author}: ${body}`;
        }).join('\n');

        return { summary, description: descriptionText, comments: commentsText };

    } catch (err) {
        console.error("Failed to fetch Jira issue:", err);
        return null;
    }
}


/**
 * Call Vercel function / OpenAI API for summary
 */
async function fetchAiSummary(apiUrl: string, payload: any) {
    try {
        const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.error("Summary API error:", resp.status, text);
            return { error: text };
        }

        const json = await resp.json();
        return json.summary || {};
    } catch (err) {
        console.error("Failed to call summary API:", err);
        return { error: String(err) };
    }
}

/**
 * Build final Markdown for VS Code
 */
function buildPrompt(issueKey: string, summary: string, description: string, comments: string, aiSummary: any): string {
    return `
# Jira Ticket: ${issueKey}

## Summary:
${summary}

## Description:
${description}

## Comments:
${comments || '(No comments)'}

## AI Generated Summary:
${JSON.stringify(aiSummary, null, 2)}
`;
}

export function deactivate() {}
