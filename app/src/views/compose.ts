import type { App } from "@modelcontextprotocol/ext-apps";
import { navigateTo } from "../inbox-app.js";
import { encryptForRecipient } from "../crypto/encrypt.js";

export function renderCompose(
  container: HTMLElement,
  app: App,
  recipientHandle?: string,
): void {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.flex = "1";

  // Header
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <button class="btn-icon" id="back-btn" title="Back">&#8592;</button>
    <div class="header-title">New Message</div>
  `;
  wrapper.appendChild(header);

  const backBtn = header.querySelector("#back-btn")!;
  backBtn.addEventListener("click", () => navigateTo("threads"));

  // Form
  const form = document.createElement("div");
  form.style.padding = "12px 0";
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="to-input">To</label>
      <input
        id="to-input"
        class="input"
        type="text"
        placeholder="@handle"
        value="${recipientHandle ? recipientHandle : ""}"
        autocomplete="off"
        autocapitalize="off"
      />
    </div>
    <div class="form-group">
      <label class="form-label" for="subject-input">Subject (optional)</label>
      <input
        id="subject-input"
        class="input"
        type="text"
        placeholder="Subject"
        autocomplete="off"
      />
    </div>
    <div class="form-group">
      <label class="form-label" for="body-input">Message</label>
      <textarea
        id="body-input"
        class="input"
        placeholder="Write your message..."
        rows="6"
      ></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="priority-input">Priority</label>
      <select id="priority-input" class="input">
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="low">Low</option>
        <option value="fyi">FYI</option>
      </select>
    </div>
    <div id="compose-error" class="error-text" style="display:none;margin-bottom:12px;"></div>
    <button id="send-btn" class="btn btn-primary" style="width:100%;">Send Message</button>
  `;
  wrapper.appendChild(form);

  container.appendChild(wrapper);

  const toInput = form.querySelector("#to-input") as HTMLInputElement;
  const subjectInput = form.querySelector("#subject-input") as HTMLInputElement;
  const bodyInput = form.querySelector("#body-input") as HTMLTextAreaElement;
  const priorityInput = form.querySelector("#priority-input") as HTMLSelectElement;
  const errorEl = form.querySelector("#compose-error") as HTMLElement;
  const sendBtn = form.querySelector("#send-btn") as HTMLButtonElement;

  // Strip leading @
  toInput.addEventListener("input", () => {
    if (toInput.value.startsWith("@")) {
      toInput.value = toInput.value.slice(1);
    }
  });

  sendBtn.addEventListener("click", async () => {
    const handle = toInput.value.trim();
    const body = bodyInput.value.trim();
    const subject = subjectInput.value.trim();
    const priority = priorityInput.value;

    if (!handle) {
      errorEl.textContent = "Please enter a recipient handle.";
      errorEl.style.display = "block";
      return;
    }
    if (!body) {
      errorEl.textContent = "Please enter a message.";
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";

    try {
      const args: Record<string, unknown> = {
        to: handle,
        body,
        priority,
      };

      if (subject) {
        args.subject = subject;
      }

      // Try to look up recipient's public key for e2e encryption
      try {
        const profileResult = await app.callServerTool({
          name: "mmp-lookup",
          arguments: { handle },
        });
        const profileContent = profileResult?.content;
        if (profileContent && Array.isArray(profileContent)) {
          const profileText = profileContent.find(
            (c: { type: string }) => c.type === "text",
          ) as { type: "text"; text: string } | undefined;
          if (profileText) {
            const profile = JSON.parse(profileText.text);
            if (profile.client_public_key) {
              const encrypted = encryptForRecipient(body, profile.client_public_key);
              args.ciphertext = encrypted.ciphertext;
              args.nonce = encrypted.nonce;
              args.sender_public_key = encrypted.sender_public_key;
              args.encryption_mode = "e2e";
            }
          }
        }
      } catch {
        // Fall back to server-assisted encryption
      }

      const result = await app.callServerTool({
        name: "mmp-send",
        arguments: args,
      });

      const content = result?.content;
      if (content && Array.isArray(content)) {
        const textItem = content.find(
          (c: { type: string }) => c.type === "text",
        ) as { type: "text"; text: string } | undefined;

        if (textItem) {
          let data: { thread_id?: string; error?: string };
          try {
            data = JSON.parse(textItem.text);
          } catch {
            data = {};
          }

          if (data.error) {
            throw new Error(data.error);
          }

          if (data.thread_id) {
            navigateTo("thread", { threadId: data.thread_id });
            return;
          }
        }
      }

      // If no thread_id returned, go to threads list
      navigateTo("threads");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send message.";
      errorEl.textContent = message;
      errorEl.style.display = "block";
      sendBtn.disabled = false;
      sendBtn.textContent = "Send Message";
    }
  });
}
