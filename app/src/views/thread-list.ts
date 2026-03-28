import type { App } from "@modelcontextprotocol/ext-apps";
import { navigateTo } from "../inbox-app.js";

type TabFilter = "active" | "starred" | "archived";

function relativeTime(epochSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - epochSec;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return "yesterday";
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(epochSec * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.substring(0, max) + "...";
}

interface ThreadData {
  id: string;
  type?: "dm" | "group";
  name?: string;
  subject: string;
  other_handle?: string;
  other_display_name?: string;
  member_count?: number;
  last_message_body: string | null;
  last_message_at: number;
  unread_count: number;
  member_state: string;
  starred?: boolean;
  priority?: string;
  encryption_mode?: string;
}

export function renderThreadList(container: HTMLElement, app: App): void {
  let activeTab: TabFilter = "active";

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.flex = "1";

  // Header
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <div class="header-title">Inbox</div>
    <div class="header-actions">
      <button class="btn-icon" id="settings-btn" title="Settings">&#9881;</button>
    </div>
  `;
  wrapper.appendChild(header);

  const settingsBtn = header.querySelector("#settings-btn")!;
  settingsBtn.addEventListener("click", () => navigateTo("settings"));

  // Tab bar
  const tabBar = document.createElement("div");
  tabBar.className = "tab-bar";
  const tabs: { label: string; filter: TabFilter | "contacts" }[] = [
    { label: "Inbox", filter: "active" },
    { label: "Starred", filter: "starred" },
    { label: "Archived", filter: "archived" },
    { label: "Contacts", filter: "contacts" },
  ];

  tabs.forEach(({ label, filter }) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (filter === activeTab ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      if (filter === "contacts") {
        navigateTo("contacts");
        return;
      }
      activeTab = filter;
      tabBar.querySelectorAll(".tab").forEach((t, i) => {
        t.classList.toggle("active", tabs[i].filter === activeTab);
      });
      loadThreads();
    });
    tabBar.appendChild(btn);
  });
  wrapper.appendChild(tabBar);

  // Thread list container
  const listEl = document.createElement("div");
  listEl.style.flex = "1";
  wrapper.appendChild(listEl);

  // FAB compose button
  const fab = document.createElement("button");
  fab.className = "btn-fab";
  fab.textContent = "+";
  fab.title = "New message";
  fab.addEventListener("click", () => navigateTo("compose"));
  wrapper.appendChild(fab);

  container.appendChild(wrapper);

  async function loadThreads(): Promise<void> {
    listEl.innerHTML = '<div class="loading">Loading threads...</div>';

    try {
      const result = await app.callServerTool({
        name: "mmp-threads",
        arguments: {},
      });

      const content = result?.content;
      if (!content || !Array.isArray(content)) {
        listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128172;</div><p>No messages yet. Send your first message!</p></div>';
        return;
      }

      const textItem = content.find(
        (c: { type: string }) => c.type === "text",
      ) as { type: "text"; text: string } | undefined;

      if (!textItem) {
        listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128172;</div><p>No messages yet. Send your first message!</p></div>';
        return;
      }

      let threads: ThreadData[];
      try {
        const parsed = JSON.parse(textItem.text);
        threads = Array.isArray(parsed) ? parsed : parsed.threads ?? [];
      } catch {
        threads = [];
      }

      // Filter by tab
      const filtered = threads.filter((t) => {
        if (activeTab === "active") return t.member_state === "active" || t.member_state === "muted";
        if (activeTab === "starred") return !!t.starred;
        if (activeTab === "archived") return t.member_state === "archived";
        return true;
      });

      if (filtered.length === 0) {
        const emptyMessages: Record<TabFilter, string> = {
          active: "No messages yet. Send your first message!",
          starred: "No starred threads.",
          archived: "No archived threads.",
        };
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#128172;</div><p>${emptyMessages[activeTab]}</p></div>`;
        return;
      }

      listEl.innerHTML = "";
      filtered.forEach((thread) => {
        const item = document.createElement("div");
        const priorityClass = thread.priority
          ? `priority-${thread.priority}`
          : "priority-normal";
        item.className = `thread-item ${priorityClass}`;

        const isGroup = thread.type === "group";
        const title = isGroup
          ? (thread.name || "Group")
          : `@${thread.other_handle || "unknown"}`;
        const subtitle = isGroup
          ? `${thread.member_count || 0} members`
          : (thread.other_display_name && thread.other_display_name !== thread.other_handle
              ? thread.other_display_name
              : "");
        const preview = thread.last_message_body
          ? truncate(thread.last_message_body, 80)
          : "No messages yet";
        const timeStr = relativeTime(thread.last_message_at);
        const isE2E = thread.encryption_mode === "e2e";

        item.innerHTML = `
          <div class="thread-item-header">
            <span class="thread-item-handle">
              ${isGroup ? "&#128101; " : ""}${title}
              ${subtitle ? ` <span style="font-weight:400;color:var(--text-secondary);">${subtitle}</span>` : ""}
            </span>
            <div class="thread-item-meta">
              ${isE2E ? '<span class="badge badge-e2e" title="End-to-end encrypted"></span>' : ""}
              ${thread.unread_count > 0 ? `<span class="badge badge-unread">${thread.unread_count}</span>` : ""}
              <span class="thread-item-time">${timeStr}</span>
            </div>
          </div>
          ${thread.subject ? `<div class="thread-item-subject">${thread.subject}</div>` : ""}
          <div class="thread-item-preview">${preview}</div>
        `;

        item.addEventListener("click", () => {
          navigateTo("thread", { threadId: thread.id });
        });

        listEl.appendChild(item);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load threads";
      listEl.innerHTML = `<div class="empty-state"><p class="error-text">${message}</p></div>`;
    }
  }

  loadThreads();
}
