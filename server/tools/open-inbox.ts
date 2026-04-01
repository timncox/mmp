import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

const RESOURCE_URI = "ui://mmp/inbox.html";

function loadInboxHtml(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const htmlPath = resolve(__dirname, "../../app/dist/inbox.html");
    return readFileSync(htmlPath, "utf-8");
  } catch {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>MMP Inbox</title></head>
<body>
  <h1>MMP Inbox</h1>
  <p>The inbox app has not been built yet. Run the app build to generate inbox.html.</p>
</body>
</html>`;
  }
}

export function registerOpenInboxTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  // Register the app tool
  registerAppTool(
    server,
    "mmp-open_inbox",
    {
      description:
        "Open the MMP inbox in the MCP App UI. For text-only clients, returns a thread summary.",
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async () => {
      const user = getUser();
      if (!user) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Authentication required." }),
            },
          ],
          isError: true,
        };
      }

      // Fallback text content: thread count summary for text-only clients
      const threads = db.getThreadsForUser(user.id);
      const unreadCount = threads.reduce((sum, t) => sum + t.unread_count, 0);
      const activeCount = threads.filter(
        (t) => t.member_state === "active",
      ).length;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              summary: `${activeCount} active threads, ${unreadCount} unread messages.`,
              threads: threads.length,
              unread: unreadCount,
            }),
          },
        ],
      };
    },
  );

  // Register the app resource (HTML)
  registerAppResource(
    server,
    "MMP Inbox",
    RESOURCE_URI,
    {
      description: "Interactive MMP inbox interface",
      _meta: {
        ui: {
          domain: "a46c3a63c62bb2f9177f2f9491ae68bd.claudemcpcontent.com",
          csp: {
            connectDomains: ["https://mmp.chat"],
            resourceDomains: [],
          },
        },
      },
    },
    async () => {
      const html = loadInboxHtml();
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                domain: "a46c3a63c62bb2f9177f2f9491ae68bd.claudemcpcontent.com",
                csp: {
                  connectDomains: ["https://mmp.chat"],
                  resourceDomains: [],
                },
              },
            },
          },
        ],
      };
    },
  );
}
