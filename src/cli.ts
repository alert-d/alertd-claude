/**
 * MCP CLI — call the AlertD MCP server from the command line.
 *
 * Usage:
 *   bun run mcp login                        # authenticate and save token
 *   bun run mcp "what is in my aws"
 *   bun run mcp --url http://localhost:1776 "list my EC2 instances"
 *   bun run mcp --tool aws_discovery "find all VPCs"
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createHash, randomBytes } from 'crypto';
import { exec } from 'child_process';
import { createInterface } from 'readline';

const MCP_PROTOCOL_VERSION = '2025-11-25';

const ROOT = process.cwd();
const ENV_LOCAL = resolve(ROOT, '.env.local');

// --- env helpers -----------------------------------------------------------

/** Read .env and .env.local without triggering SOPS or DB connections. */
function loadLocalEnv(): void {
    for (const file of ['.env', '.env.local']) {
        try {
            const content = readFileSync(resolve(ROOT, file), 'utf-8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eq = trimmed.indexOf('=');
                if (eq === -1) continue;
                const key = trimmed.slice(0, eq).trim();
                const val = trimmed
                    .slice(eq + 1)
                    .trim()
                    .replace(/^["']|["']$/g, '');
                if (!(key in process.env)) process.env[key] = val;
            }
        } catch {
            // file not found — ok
        }
    }
}

/** Remove a key from .env.local. No-op if the key isn't present. */
function removeEnvLocal(key: string): void {
    if (!existsSync(ENV_LOCAL)) return;
    const lines = readFileSync(ENV_LOCAL, 'utf-8').split('\n');
    const filtered = lines.filter((l) => !l.trimStart().startsWith(`${key}=`));
    writeFileSync(ENV_LOCAL, filtered.join('\n'));
}

/**
 * Set or update a key in .env.local.
 * Creates the file if it doesn't exist; updates the line if the key is present.
 */
function setEnvLocal(key: string, value: string): void {
    let content = '';
    if (existsSync(ENV_LOCAL)) {
        content = readFileSync(ENV_LOCAL, 'utf-8');
    }

    const lines = content.split('\n');
    const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
    if (idx !== -1) {
        lines[idx] = `${key}=${value}`;
    } else {
        // Append, ensuring a trailing newline before it
        if (content && !content.endsWith('\n')) lines.push('');
        lines.push(`${key}=${value}`);
    }

    writeFileSync(ENV_LOCAL, lines.join('\n'));
}

// --- OAuth PKCE helpers ----------------------------------------------------

function base64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePkce(): { verifier: string; challenge: string } {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

/**
 * Start a one-shot HTTP server on a random port.
 * Resolves with the first request's URL search params, then shuts down.
 */
function waitForCallback(port: number): Promise<URLSearchParams> {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            const params = new URL(
                req.url ?? '/',
                `http://localhost:${port}`,
            ).searchParams;

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(
                '<html><body><h2>Login successful — you can close this tab.</h2></body></html>',
            );

            server.close();

            if (params.get('error')) {
                reject(new Error(`OAuth error: ${params.get('error_description') ?? params.get('error')}`));
            } else {
                resolve(params);
            }
        });

        server.on('error', reject);
        server.listen(port);
    });
}

/** Pick a random port in 10000–19999 range. */
function randomPort(): number {
    return 10000 + Math.floor(Math.random() * 10000);
}

function openBrowser(url: string): void {
    exec(`open ${JSON.stringify(url)}`);
}

function prompt(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// --- OAuth login flow -------------------------------------------------------

/**
 * Run the OAuth PKCE login flow.
 * If serverUrl is not provided, prompts the user for it and saves it to .env.local.
 * Always fetches a fresh token (clears any existing MCP_TOKEN first).
 */
async function login(serverUrl: string | undefined): Promise<string> {
    if (!serverUrl) {
        const saved = process.env.MCP_SERVER_URL;
        const input = await prompt(
            `AlertD server URL${saved ? ` [${saved}]` : ' (e.g. https://alertd.yourorg.com)'}: `,
        );
        serverUrl = input || saved || 'http://localhost:1776';
        setEnvLocal('MCP_SERVER_URL', serverUrl);
        process.env.MCP_SERVER_URL = serverUrl;
    }

    const port = randomPort();
    const redirectUri = `http://localhost:${port}/callback`;
    const { verifier, challenge } = generatePkce();
    const state = base64url(randomBytes(16));

    const authorizeUrl = new URL(`${serverUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);

    console.log(`\nOpening browser for login...`);
    console.log(`If it doesn't open, visit:\n  ${authorizeUrl}\n`);

    const callbackPromise = waitForCallback(port);
    openBrowser(authorizeUrl.toString());

    const params = await callbackPromise;

    if (params.get('state') !== state) {
        throw new Error('OAuth state mismatch — possible CSRF');
    }

    const code = params.get('code');
    if (!code) throw new Error('No code in callback');

    // Exchange code for token
    const tokenRes = await fetch(`${serverUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
        }).toString(),
    });

    if (!tokenRes.ok) {
        const body = await tokenRes.text().catch(() => '');
        throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    setEnvLocal('MCP_TOKEN', access_token);
    process.env.MCP_TOKEN = access_token;
    console.log(`Token saved to .env.local\n`);
    return access_token;
}

// --- MCP RPC ---------------------------------------------------------------

interface McpRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: any;
    id: string;
}

interface ProgressParams {
    progressToken: string | number;
    progress: number;
    total?: number;
    message?: string;
}

async function mcpRpc(
    baseUrl: string,
    token: string,
    method: string,
    params: any,
    sessionId: string | null,
    opts: {
        stream?: boolean;
        onProgress?: (params: ProgressParams) => void;
    } = {},
): Promise<{ result?: any; error?: any; sessionId?: string }> {
    const id = crypto.randomUUID();
    const progressToken = opts.stream ? crypto.randomUUID() : undefined;

    if (progressToken && params) {
        params._meta = { progressToken };
    }

    const body: McpRpcRequest = { jsonrpc: '2.0', method, params, id };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        Authorization: `Bearer ${token}`,
    };
    if (sessionId) headers['MCP-Session-Id'] = sessionId;
    if (opts.stream) headers['Accept'] = 'text/event-stream';

    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        const err = new Error(`MCP request failed (${res.status}): ${text}`) as Error & { status: number };
        err.status = res.status;
        throw err;
    }

    const returnedSessionId = res.headers.get('MCP-Session-Id') ?? undefined;

    if (
        opts.stream &&
        res.headers.get('content-type')?.includes('text/event-stream')
    ) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: any = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.method === 'notifications/progress') {
                        opts.onProgress?.(parsed.params as ProgressParams);
                    } else {
                        finalResult = parsed;
                    }
                } catch {
                    // ignore malformed SSE lines
                }
            }
        }

        return { ...finalResult, sessionId: returnedSessionId };
    }

    const data = await res.json();
    return { ...data, sessionId: returnedSessionId };
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

// --- main ------------------------------------------------------------------

async function main(): Promise<void> {
    loadLocalEnv();

    const args = process.argv.slice(2);

    // Simple arg parsing — no heavy yargs needed
    const flags: Record<string, string> = {};
    const positional: string[] = [];

    const booleanFlags = new Set(['help', 'h']);

    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const [key, ...rest] = args[i].slice(2).split('=');
            if (rest.length) {
                flags[key] = rest.join('=');
            } else if (booleanFlags.has(key) || args[i + 1]?.startsWith('--') || args[i + 1] === undefined) {
                flags[key] = 'true';
            } else {
                flags[key] = args[++i];
            }
        } else {
            positional.push(args[i]);
        }
    }

    const command = positional[0];
    let baseUrl = flags.url ?? process.env.MCP_SERVER_URL ?? undefined;

    if (command === 'login') {
        await login(baseUrl);
        return;
    }

    if (command === 'logout') {
        removeEnvLocal('MCP_TOKEN');
        delete process.env.MCP_TOKEN;
        console.log('Logged out (MCP_TOKEN removed from .env.local).');
        return;
    }

    if (flags.help || flags.h || command === 'help') {
        console.log(`Usage: alertd-mcp [options] "<query>"
       alertd-mcp login

Commands:
  login                  Authenticate via browser and save token to .env.local
  logout                 Remove saved token from .env.local

Options:
  --url <url>            MCP server base URL
  --token <token>        Bearer token (overrides MCP_TOKEN env var)
  --tool <name>          Tool to call (default: aws_discovery)
  --help                 Show this help`);
        return;
    }

    const query = positional.join(' ') || undefined;
    const toolName = flags.tool ?? 'aws_discovery';
    let token: string | undefined = flags.token ?? process.env.MCP_TOKEN;

    // No token — run login flow now (which also prompts for server URL if needed)
    if (!token) {
        token = await login(baseUrl);
        // login() may have set MCP_SERVER_URL, re-read it
        baseUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:1776';
    }

    baseUrl ??= 'http://localhost:1776';

    if (!query) {
        console.error('Error: no query provided');
        console.error('Usage: bun run mcp "what is in my aws"');
        process.exit(1);
    }

    console.log(`\n--- AlertD MCP CLI ---`);
    console.log(`Server: ${baseUrl}`);
    console.log(`Tool:   ${toolName}`);
    console.log(`Query:  "${query}"`);
    console.log();

    // Initialize session — if 401, token is stale: re-login once and retry
    process.stderr.write('Connecting...');
    let initResult: Awaited<ReturnType<typeof mcpRpc>>;
    try {
        initResult = await mcpRpc(baseUrl, token, 'initialize', {}, null, {
            stream: true,
        });
    } catch (err: any) {
        if (err.status === 401) {
            process.stderr.write(' token expired, re-authenticating...\n');
            token = await login(baseUrl);
            process.stderr.write('Connecting...');
            initResult = await mcpRpc(baseUrl, token, 'initialize', {}, null, {
                stream: true,
            });
        } else {
            throw err;
        }
    }

    if (initResult.error) {
        console.error(`\nInitialize error: ${JSON.stringify(initResult.error)}`);
        process.exit(1);
    }

    const sessionId = initResult.sessionId;
    if (!sessionId) {
        console.error('\nError: server did not return a session ID');
        process.exit(1);
    }
    process.stderr.write(` session ${sessionId.slice(0, 8)}...\n\n`);

    // Call the tool with streaming progress
    const callResult = await mcpRpc(
        baseUrl,
        token,
        'tools/call',
        { name: toolName, arguments: { query } },
        sessionId,
        {
            stream: true,
            onProgress(params) {
                if (params.message) {
                    try {
                        const status = JSON.parse(params.message);
                        if (status.text) {
                            const timing =
                                status.durationMs !== undefined
                                    ? ` (${formatDuration(status.durationMs)})`
                                    : '';
                            if (status.type === 'analysis:chunk') {
                                process.stderr.write(status.text);
                            } else {
                                process.stderr.write(status.text + timing + '\n');
                            }
                        }
                    } catch {
                        process.stderr.write(String(params.message) + '\n');
                    }
                }
            },
        },
    );

    console.log();

    if (callResult.error) {
        console.error(`Error: ${JSON.stringify(callResult.error)}`);
        process.exit(1);
    }

    const content = callResult.result?.content;
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.type === 'text' && item.text) {
                try {
                    const parsed = JSON.parse(item.text);
                    if (parsed.data) {
                        console.log('--- Result ---');
                        console.log(parsed.data);
                    }
                    if (parsed.sessionUrl) {
                        console.log(`\nSession: ${parsed.sessionUrl}`);
                    }
                } catch {
                    console.log(item.text);
                }
            }
        }
    } else {
        console.log(JSON.stringify(callResult.result, null, 2));
    }
}

main().then(() => process.exit(0));
