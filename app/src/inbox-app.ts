import { App } from "@modelcontextprotocol/ext-apps";
import "./styles/theme.css";
import { renderOnboarding } from "./views/onboarding.js";
import { renderThreadList } from "./views/thread-list.js";
import { renderThreadView } from "./views/thread-view.js";
import { renderCompose } from "./views/compose.js";
import { renderContacts } from "./views/contacts.js";
import { renderSettings } from "./views/settings.js";
import { hasClientKeys } from "./crypto/keys.js";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------
export type ViewName =
  | "onboarding"
  | "threads"
  | "thread"
  | "compose"
  | "contacts"
  | "settings";

export interface ViewParams {
  threadId?: string;
  recipientHandle?: string;
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let currentView: ViewName = "threads";
let viewParams: ViewParams = {};
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastUnreadCount = 0;

// ---------------------------------------------------------------------------
// MCP App instance
// ---------------------------------------------------------------------------
export const app = new App({ name: "MMP Inbox", version: "1.0.0" });

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------
function getContainer(): HTMLElement {
  const el = document.getElementById("app");
  if (!el) throw new Error("Missing #app container");
  return el;
}

function renderView(): void {
  const container = getContainer();
  container.innerHTML = "";

  switch (currentView) {
    case "onboarding":
      renderOnboarding(container, app);
      break;
    case "threads":
      renderThreadList(container, app);
      break;
    case "thread":
      renderThreadView(container, app, viewParams.threadId ?? "");
      break;
    case "compose":
      renderCompose(container, app, viewParams.recipientHandle);
      break;
    case "contacts":
      renderContacts(container, app);
      break;
    case "settings":
      renderSettings(container, app);
      break;
    default:
      container.textContent = "Unknown view";
  }
}

export function navigateTo(view: ViewName, params?: ViewParams): void {
  currentView = view;
  viewParams = params ?? {};
  renderView();
}

// ---------------------------------------------------------------------------
// Polling for unread messages
// ---------------------------------------------------------------------------
async function pollUnread(): Promise<void> {
  try {
    const result = await app.callServerTool({
      name: "msg-inbox",
      arguments: { unread_only: true },
    });
    const content = result?.content;
    if (!content || !Array.isArray(content)) return;

    const textItem = content.find(
      (c: { type: string }) => c.type === "text",
    ) as { type: "text"; text: string } | undefined;
    if (!textItem) return;

    let data: { unread_count?: number };
    try {
      data = JSON.parse(textItem.text);
    } catch {
      return;
    }

    const unreadCount = data.unread_count ?? 0;
    if (unreadCount > lastUnreadCount && unreadCount > 0) {
      app.updateModelContext({
        content: [
          {
            type: "text",
            text: `[MMP] You have ${unreadCount} unread message${unreadCount === 1 ? "" : "s"}.`,
          },
        ],
      });
    }
    lastUnreadCount = unreadCount;
  } catch {
    // Polling failure is non-fatal
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function init(): Promise<void> {
  try {
    await app.connect();
  } catch {
    // Connection may fail if not in an MCP App host — render anyway
  }

  // Determine initial view
  const token = localStorage.getItem("mmp_token");
  if (!token || !hasClientKeys()) {
    currentView = "onboarding";
  } else {
    currentView = "threads";
  }

  renderView();

  // Set up tool result handler
  app.ontoolresult = () => {
    // Re-render current view when a tool result comes in, if relevant
  };

  // Set up theme change handler
  app.onhostthemechanged = (theme: string) => {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  };

  // Start polling for unread messages (every 15 seconds)
  pollInterval = setInterval(pollUnread, 15_000);
  // Initial poll
  pollUnread();

  // Cleanup on teardown
  app.onteardown = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };
}

init();
