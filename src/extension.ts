import * as vscode from 'vscode';
import * as crypto from 'crypto';
const fetch: any = require('node-fetch');

// -------------------- Activate Extension --------------------
export function activate(context: vscode.ExtensionContext) {
    console.log('Jira AI Helper activated');

    // 1️⃣ Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    statusBarItem.text = `$(server) Jira AI`;
    statusBarItem.tooltip = 'Click to fetch Jira tickets or manage connections';
    statusBarItem.command = 'jiraAi.showMenu';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 2️⃣ Direct fetch command
    const directFetchCmd = vscode.commands.registerCommand('jiraAi.fetchTicket', async () => {
        try {
            const connections = await getAllConnections(context);

            if (connections.length === 0) {
                vscode.window.showInformationMessage('No Jira connections found. Please add one first.');
                await connectJira(context);
                return;
            }

            await fetchTicket(context, connections);
        } catch (err) {
            console.error('directFetchCmd error:', err);
            vscode.window.showErrorMessage('Error running Jira fetch command.');
        }
    });
    context.subscriptions.push(directFetchCmd);

    // 3️⃣ Main menu command
    const disposableMenu = vscode.commands.registerCommand('jiraAi.showMenu', async () => {
        try {
            const connections = await getAllConnections(context);

            const menuOptions: string[] = [
                'Fetch Ticket',
                'Connect / Add Jira',
                'Manage Connections'
            ];

            const choice = await vscode.window.showQuickPick(menuOptions, { placeHolder: 'Select an action' });
            if (!choice) return;

            if (choice === 'Connect / Add Jira') {
                await connectJira(context);
            } else if (choice === 'Manage Connections') {
                await manageConnections(context);
            } else if (choice === 'Fetch Ticket') {
                if (connections.length === 0) {
                    vscode.window.showInformationMessage('No Jira connections found. Please add one.');
                    await connectJira(context);
                    return;
                }
                await fetchTicket(context, connections);
            }
        } catch (err) {
            console.error('Error in menu:', err);
            vscode.window.showErrorMessage('Unexpected error in Jira AI menu.');
        }
    });
    context.subscriptions.push(disposableMenu);

    // 4️⃣ Auto setup first-time user
    (async () => {
        try {
            const list = await context.secrets.get('jira-connections');
            if (!list) {
                vscode.window.showInformationMessage('Welcome to Jira AI Helper! Let’s set up your first Jira connection.');
                await connectJira(context);
            }

            // Create unique userId for usage tracking
            let userId = await context.secrets.get('jiraAi-userId');
            if (!userId) {
                userId = crypto.randomUUID();
                await context.secrets.store('jiraAi-userId', userId);
            }
        } catch (err) {
            console.error('Auto-setup error:', err);
        }
    })();
}

// -------------------- Connect / Add Jira --------------------
async function connectJira(context: vscode.ExtensionContext): Promise<void> {
    try {
        const jiraName = await vscode.window.showInputBox({ prompt: 'Connection Name (e.g. Main Portal)', ignoreFocusOut: true });
        if (!jiraName) return;

        const jiraUrl = await vscode.window.showInputBox({ prompt: 'Jira URL (https://example.atlassian.net)', ignoreFocusOut: true });
        if (!jiraUrl) return;

        const email = await vscode.window.showInputBox({ prompt: 'Jira Email', ignoreFocusOut: true });
        if (!email) return;

        const token = await vscode.window.showInputBox({ prompt: 'Jira API Token', password: true, ignoreFocusOut: true });
        if (!token) return;

        await context.secrets.store(`jira-${jiraName}-url`, jiraUrl);
        await context.secrets.store(`jira-${jiraName}-email`, email);
        await context.secrets.store(`jira-${jiraName}-token`, token);

        const connections = await getAllConnections(context);
        if (!connections.includes(jiraName)) connections.push(jiraName);
        await context.secrets.store('jira-connections', JSON.stringify(connections));

        vscode.window.showInformationMessage(`Jira connection "${jiraName}" saved successfully.`);
    } catch (err) {
        console.error('connectJira error:', err);
    }
}

// -------------------- Get all connections --------------------
async function getAllConnections(context: vscode.ExtensionContext): Promise<string[]> {
    try {
        const list = await context.secrets.get('jira-connections');
        return list ? JSON.parse(list) : [];
    } catch {
        return [];
    }
}

// -------------------- Manage Connections --------------------
async function manageConnections(context: vscode.ExtensionContext): Promise<void> {
    try {
        const connections = await getAllConnections(context);
        if (connections.length === 0) {
            vscode.window.showInformationMessage('No connections found.');
            return;
        }

        const choice = await vscode.window.showQuickPick([...connections, 'Cancel'], { placeHolder: 'Select connection to manage' });
        if (!choice || choice === 'Cancel') return;

        const action = await vscode.window.showQuickPick(['Update Credentials', 'Delete Connection'], { placeHolder: `Action for ${choice}` });
        if (!action) return;

        if (action === 'Delete Connection') {
            await context.secrets.delete(`jira-${choice}-url`);
            await context.secrets.delete(`jira-${choice}-email`);
            await context.secrets.delete(`jira-${choice}-token`);

            const updated = connections.filter(c => c !== choice);
            await context.secrets.store('jira-connections', JSON.stringify(updated));
            vscode.window.showInformationMessage(`Deleted connection "${choice}".`);
        } else {
            await connectJira(context);
        }
    } catch (err) {
        console.error('manageConnections error:', err);
    }
}

// -------------------- Fetch Ticket --------------------
async function fetchTicket(context: vscode.ExtensionContext, connections: string[]): Promise<void> {
    try {
        const selected = await vscode.window.showQuickPick(connections, { placeHolder: 'Select Jira connection' });
        if (!selected) return;

        const jiraUrl = await context.secrets.get(`jira-${selected}-url`);
        const email = await context.secrets.get(`jira-${selected}-email`);
        const apiToken = await context.secrets.get(`jira-${selected}-token`);

        const issueKey = await vscode.window.showInputBox({ prompt: 'Jira ticket key (e.g. SCRUM-5)' });
        if (!issueKey) return;

        const jiraData = await fetchJiraIssue(jiraUrl!, issueKey, email!, apiToken!);
        if (!jiraData) {
            vscode.window.showErrorMessage('Failed to fetch Jira ticket.');
            return;
        }

        const description = jiraData?.fields?.description ? extractText(jiraData.fields.description) : 'No description';
        const summaryContent = buildJiraSummary(jiraData, description);

        // Generate AI summary via backend
        const aiSummary = await generateSummary(context, description);

        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: `${summaryContent}\n## ✨ AI Summary\n${aiSummary}`
        });
        await vscode.window.showTextDocument(doc, { preview: false });

        await vscode.window.showQuickPick(['Do manually', 'Send to Copilot', 'Send to Cursor'], { placeHolder: 'Next step' });

    } catch (err) {
        console.error('fetchTicket error:', err);
    }
}

// -------------------- Fetch Jira Ticket Data --------------------
async function fetchJiraIssue(jiraUrl: string, issueKey: string, email: string, apiToken: string) {
    try {
        const response = await fetch(`${jiraUrl}/rest/api/3/issue/${issueKey}`, {
            headers: {
                "Authorization": "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64"),
                "Accept": "application/json"
            }
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

// -------------------- Build Jira Summary --------------------
function buildJiraSummary(jiraData: any, description: string): string {
    const key = jiraData?.key || 'UNKNOWN';
    const fields = jiraData?.fields || {};
    const summary = fields?.summary || "No summary";
    const status = fields?.status?.name || "Unknown";
    const type = fields?.issuetype?.name || "Unknown";
    const assignee = fields?.assignee?.displayName || "Unassigned";
    const reporter = fields?.reporter?.displayName || "Unknown";
    const priority = fields?.priority?.name || "N/A";

    return `
# Jira Ticket: ${key}
## ${summary}

**Type:** ${type}  
**Status:** ${status}  
**Assignee:** ${assignee}  
**Reporter:** ${reporter}  
**Priority:** ${priority}  

---

## 📄 Description
${description}

---
`;
}

// -------------------- Extract Jira Description --------------------
function extractText(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.text || '';
    if (node.content) return node.content.map((c: any) => extractText(c)).join(' ');
    if (Array.isArray(node)) return node.map(n => extractText(n)).join(' ');
    return '';
}

// -------------------- Generate AI Summary via Backend --------------------
async function generateSummary(context: vscode.ExtensionContext, text: string): Promise<string> {
    const userId = await context.secrets.get('jiraAi-userId');
    if (!userId) return 'User ID missing. Cannot generate summary.';

    try {
        const response = await fetch('https://your-backend.vercel.app/generateSummary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: text, userId })
        });
        const data = await response.json();
        return data.summary || data.error || 'No summary generated';
    } catch (err) {
        console.error('generateSummary error:', err);
        return 'Failed to generate summary';
    }
}

// -------------------- Deactivate --------------------
export function deactivate() {}
