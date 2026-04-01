#!/usr/bin/env node
/**
 * MMP stdio-to-HTTP bridge for Claude Desktop.
 * Translates stdio JSON-RPC to Streamable HTTP against mmp.chat.
 * Requests are queued and sent sequentially to avoid race conditions.
 */

const SERVER_URL = "https://mmp.chat/mcp?token=sk_ba7e7c3e8c24da263579c66229513927a17fa565bc6b6202540ae328b909415d";
let sessionId = null;
let stdinEnded = false;

// Sequential queue
const queue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const message = queue.shift();
    await sendToServer(message);
  }

  processing = false;
  if (stdinEnded) process.exit(0);
}

function enqueue(message) {
  queue.push(message);
  processQueue();
}

async function sendToServer(message) {
  try {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(30000),
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    // Notifications have no id — drain response, don't output
    if (message.id === undefined || message.id === null) {
      await res.text();
      return;
    }

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      const text = await res.text();
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          process.stdout.write(line.slice(6) + "\n");
        }
      }
    } else {
      const data = await res.text();
      if (data.trim()) {
        process.stdout.write(data + "\n");
      }
    }
  } catch (err) {
    if (message.id !== undefined && message.id !== null) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: err.message },
        id: message.id,
      }) + "\n");
    }
    process.stderr.write(`Bridge error: ${err.message}\n`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      enqueue(msg);
    } catch {
      process.stderr.write(`Invalid JSON: ${line}\n`);
    }
  }
});

process.stdin.on("end", () => {
  stdinEnded = true;
  if (!processing && queue.length === 0) process.exit(0);
});
