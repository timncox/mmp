import type { App } from "@modelcontextprotocol/ext-apps";
import { navigateTo } from "../navigation.js";
import { encryptForRecipient } from "../crypto/encrypt.js";
import { decryptFromSender } from "../crypto/decrypt.js";

interface MessageData {
  id: string;
  thread_id: string;
  from_handle: string;
  to_handle: string;
  body: string | null;
  ciphertext?: string;
  nonce?: string;
  sender_pub_key?: string;
  priority: string;
  encryption_mode: string;
  reply_to: string | null;
  created_at: number;
}

interface ThreadDetail {
  id: string;
  type?: "dm" | "group";
  name?: string;
  subject: string;
  messages: MessageData[];
  has_more?: boolean;
  members?: { handle: string; display_name: string; role: string }[];
  other_handle?: string;
  other_public_key?: string;
  other_client_public_key?: string;
  member_state: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text: string): string {
  return escapeHtml(text)
    // Bold: **text**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic: *text*
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
    // Inline code: `text`
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-size:13px">$1</code>')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>')
    // Bare URLs
    .replace(/(?<!")https?:\/\/[^\s<)]+/g, '<a href="$&" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$&</a>')
    // Newlines
    .replace(/\n/g, "<br>");
}

function formatTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function renderThreadView(
  container: HTMLElement,
  app: App,
  threadId: string,
): void {
  const myHandle = localStorage.getItem("mmp_handle") ?? "";

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.flex = "1";
  wrapper.style.minHeight = "0";
  wrapper.style.overflow = "hidden";

  // Header
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <button class="btn-icon" id="back-btn" title="Back">&#8592;</button>
    <div class="header-title" id="thread-subject">Loading...</div>
    <div class="header-actions">
      <button class="btn-icon" id="star-btn" title="Star">&#9734;</button>
      <button class="btn-icon" id="archive-btn" title="Archive">&#128230;</button>
      <button class="btn-icon" id="mute-btn" title="Mute">&#128263;</button>
    </div>
  `;
  wrapper.appendChild(header);

  const backBtn = header.querySelector("#back-btn")!;
  backBtn.addEventListener("click", () => navigateTo("threads"));

  // Messages area
  const messagesEl = document.createElement("div");
  messagesEl.className = "messages-container";
  wrapper.appendChild(messagesEl);

  // Lazy-load older messages on scroll-up
  messagesEl.addEventListener("scroll", async () => {
    if (messagesEl.scrollTop < 50 && hasMore && !loadingMore) {
      loadingMore = true;
      const oldest = allMessages.reduce((min, m) => m.created_at < min ? m.created_at : min, Infinity);
      try {
        const result = await app.callServerTool({
          name: "mmp-thread",
          arguments: { thread_id: threadId, limit: 30, before: oldest },
        });
        const content = result?.content;
        const textItem = content?.find((c: { type: string }) => c.type === "text") as { type: "text"; text: string } | undefined;
        if (textItem) {
          const older = JSON.parse(textItem.text) as ThreadDetail;
          hasMore = older.has_more ?? false;
          if (older.messages.length > 0) {
            // Deduplicate by id
            const existingIds = new Set(allMessages.map(m => m.id));
            const newMsgs = older.messages.filter(m => !existingIds.has(m.id));
            allMessages = [...newMsgs, ...allMessages];
            // Remember scroll position to prevent jump
            const prevHeight = messagesEl.scrollHeight;
            renderMessages(allMessages, false);
            messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight;
          }
        }
      } catch {
        // Ignore load-more failures
      } finally {
        loadingMore = false;
      }
    }
  });

  // AI action buttons
  const aiActions = document.createElement("div");
  aiActions.style.display = "flex";
  aiActions.style.gap = "8px";
  aiActions.style.padding = "8px 0";
  aiActions.innerHTML = `
    <button class="btn" id="ai-draft-btn">Ask AI to draft</button>
    <button class="btn" id="ai-summarize-btn">Summarize</button>
  `;
  wrapper.appendChild(aiActions);

  // Reply box
  const replyBox = document.createElement("div");
  replyBox.className = "reply-box";
  replyBox.innerHTML = `
    <textarea class="input" id="reply-input" placeholder="Type a message..." rows="2"></textarea>
    <button class="btn btn-primary" id="send-btn">Send</button>
  `;
  wrapper.appendChild(replyBox);

  container.appendChild(wrapper);

  let threadData: ThreadDetail | null = null;
  let allMessages: MessageData[] = [];
  let hasMore = false;
  let loadingMore = false;

  // Wire up action buttons
  const starBtn = header.querySelector("#star-btn") as HTMLButtonElement;
  const archiveBtn = header.querySelector("#archive-btn") as HTMLButtonElement;
  const muteBtn = header.querySelector("#mute-btn") as HTMLButtonElement;

  starBtn.addEventListener("click", async () => {
    try {
      await app.callServerTool({
        name: "mmp-star",
        arguments: { thread_id: threadId },
      });
      starBtn.innerHTML = "&#9733;";
      starBtn.title = "Starred";
    } catch {
      // Ignore
    }
  });

  archiveBtn.addEventListener("click", async () => {
    try {
      await app.callServerTool({
        name: "mmp-archive",
        arguments: { thread_id: threadId },
      });
      navigateTo("threads");
    } catch {
      // Ignore
    }
  });

  muteBtn.addEventListener("click", async () => {
    try {
      await app.callServerTool({
        name: "mmp-mute",
        arguments: { thread_id: threadId },
      });
      muteBtn.innerHTML = "&#128264;";
      muteBtn.title = "Muted";
    } catch {
      // Ignore
    }
  });

  // AI buttons
  const aiDraftBtn = aiActions.querySelector("#ai-draft-btn") as HTMLButtonElement;
  const aiSummarizeBtn = aiActions.querySelector("#ai-summarize-btn") as HTMLButtonElement;

  async function aiAction(prompt: string): Promise<void> {
    if (!threadData) return;
    const contextYAML = buildThreadContext(threadData);

    // Try the MCP App extension API first
    try {
      if (typeof app.updateModelContext === "function" && typeof app.sendMessage === "function") {
        await app.updateModelContext({
          content: [{ type: "text", text: contextYAML }],
        });
        await app.sendMessage({
          role: "user",
          content: { type: "text", text: prompt },
        });
        return;
      }
    } catch {
      // Fall through to fallback
    }

    // Fallback: copy to clipboard and show instruction
    const fullPrompt = `${contextYAML}\n\n${prompt}`;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      const notice = document.createElement("div");
      notice.style.cssText = "padding:8px 12px;background:#18181b;border:1px solid #3b82f6;border-radius:8px;color:#7dd3fc;font-size:13px;margin:8px 0;";
      notice.textContent = "Copied to clipboard — paste into your AI chat to get a response.";
      aiActions.appendChild(notice);
      setTimeout(() => notice.remove(), 4000);
    } catch {
      // Last resort: put it in the reply box
      const replyInput = replyBox.querySelector("#reply-input") as HTMLTextAreaElement;
      replyInput.value = fullPrompt;
      replyInput.focus();
    }
  }

  aiDraftBtn.addEventListener("click", () => aiAction("Draft a reply to this thread"));
  aiSummarizeBtn.addEventListener("click", () => aiAction("Summarize this thread"));

  // Send reply
  const replyInput = replyBox.querySelector("#reply-input") as HTMLTextAreaElement;
  const sendBtn = replyBox.querySelector("#send-btn") as HTMLButtonElement;

  sendBtn.addEventListener("click", async () => {
    const body = replyInput.value.trim();
    if (!body || !threadData) return;

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";

    try {
      const args: Record<string, unknown> = {
        thread_id: threadId,
        body,
      };

      // Try to encrypt client-side if we have the recipient's public key
      if (threadData.other_client_public_key) {
        try {
          const encrypted = encryptForRecipient(
            body,
            threadData.other_client_public_key,
          );
          args.ciphertext = encrypted.ciphertext;
          args.nonce = encrypted.nonce;
          args.sender_public_key = encrypted.sender_public_key;
          args.encryption_mode = "e2e";
        } catch {
          // Fall back to server-assisted encryption
        }
      }

      await app.callServerTool({
        name: "mmp-reply",
        arguments: args,
      });

      replyInput.value = "";
      await loadThread();
    } catch {
      // Show error inline
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  });

  function buildThreadContext(td: ThreadDetail): string {
    const lines = [
      `thread_id: ${td.id}`,
      `subject: ${td.subject}`,
      `with: @${td.other_handle}`,
      "messages:",
    ];
    td.messages.forEach((m) => {
      const body = m.body ?? "[encrypted]";
      lines.push(`  - from: @${m.from_handle}`);
      lines.push(`    body: "${body}"`);
      lines.push(`    time: ${formatTime(m.created_at)}`);
    });
    return lines.join("\n");
  }

  function renderMessages(messages: MessageData[], scrollToBottom = true): void {
    messagesEl.innerHTML = "";

    if (messages.length === 0) {
      messagesEl.innerHTML =
        '<div class="empty-state"><p>No messages in this thread yet.</p></div>';
      return;
    }

    // Sort chronologically (oldest first)
    const sorted = [...messages].sort((a, b) => a.created_at - b.created_at);

    sorted.forEach((msg) => {
      const isMine = msg.from_handle === myHandle;

      // Try to decrypt if body is null and we have encrypted data
      let body = msg.body;
      if (!body && msg.ciphertext && msg.nonce && msg.sender_pub_key) {
        body = decryptFromSender(msg.ciphertext, msg.nonce, msg.sender_pub_key);
      }

      const msgWrapper = document.createElement("div");
      msgWrapper.style.display = "flex";
      msgWrapper.style.flexDirection = "column";
      msgWrapper.style.alignItems = isMine ? "flex-end" : "flex-start";

      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.innerHTML = `
        <span class="message-handle ${isMine ? "you" : "them"}">@${msg.from_handle}</span>
        <span>${formatTime(msg.created_at)}</span>
        ${msg.encryption_mode === "e2e" ? '<span class="badge badge-e2e" title="End-to-end encrypted"></span>' : '<span class="badge badge-server-enc" title="Server-assisted encryption"></span>'}
      `;
      msgWrapper.appendChild(meta);

      const bubble = document.createElement("div");
      bubble.className = `message-bubble ${isMine ? "sent" : "received"}`;
      bubble.innerHTML = body ? renderMarkdown(body) : "[Unable to decrypt]";
      msgWrapper.appendChild(bubble);

      messagesEl.appendChild(msgWrapper);
    });

    // Scroll to bottom
    if (scrollToBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  async function loadThread(): Promise<void> {
    messagesEl.innerHTML = '<div class="loading">Loading messages...</div>';

    try {
      // Fetch thread details
      const result = await app.callServerTool({
        name: "mmp-thread",
        arguments: { thread_id: threadId },
      });

      const content = result?.content;
      if (!content || !Array.isArray(content)) {
        messagesEl.innerHTML =
          '<div class="empty-state"><p class="error-text">Failed to load thread.</p></div>';
        return;
      }

      const textItem = content.find(
        (c: { type: string }) => c.type === "text",
      ) as { type: "text"; text: string } | undefined;

      if (!textItem) {
        messagesEl.innerHTML =
          '<div class="empty-state"><p class="error-text">No thread data.</p></div>';
        return;
      }

      let parsed: ThreadDetail;
      try {
        parsed = JSON.parse(textItem.text);
      } catch {
        messagesEl.innerHTML =
          '<div class="empty-state"><p class="error-text">Invalid thread data.</p></div>';
        return;
      }

      threadData = parsed;
      allMessages = parsed.messages ?? [];
      hasMore = parsed.has_more ?? false;

      // Update header
      const subjectEl = header.querySelector("#thread-subject")!;
      if (parsed.type === "group") {
        subjectEl.textContent = parsed.name || parsed.subject || "Group";
      } else {
        subjectEl.textContent = parsed.subject || `@${parsed.other_handle || "unknown"}`;
      }

      // Update star state
      if (parsed.member_state === "starred") {
        starBtn.innerHTML = "&#9733;";
      }

      renderMessages(allMessages);

      // Mark as read
      try {
        await app.callServerTool({
          name: "mmp-mark_read",
          arguments: { thread_id: threadId },
        });
      } catch {
        // Non-critical
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load thread";
      messagesEl.innerHTML = `<div class="empty-state"><p class="error-text">${message}</p></div>`;
    }
  }

  loadThread();
}
