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

  // Mode toggle: DM vs Group
  let mode: "dm" | "group" = "dm";

  const modeBar = document.createElement("div");
  modeBar.style.cssText = "display:flex;gap:0;margin-bottom:8px;";
  modeBar.innerHTML = `
    <button id="mode-dm" class="tab active" style="flex:1;border-radius:8px 0 0 8px;">Direct Message</button>
    <button id="mode-group" class="tab" style="flex:1;border-radius:0 8px 8px 0;">Group Chat</button>
  `;
  wrapper.appendChild(modeBar);

  // Form container
  const form = document.createElement("div");
  form.style.padding = "4px 0";
  wrapper.appendChild(form);

  container.appendChild(wrapper);

  const dmBtn = modeBar.querySelector("#mode-dm")!;
  const groupBtn = modeBar.querySelector("#mode-group")!;

  dmBtn.addEventListener("click", () => {
    if (mode === "dm") return;
    mode = "dm";
    dmBtn.classList.add("active");
    groupBtn.classList.remove("active");
    renderForm();
  });

  groupBtn.addEventListener("click", () => {
    if (mode === "group") return;
    mode = "group";
    groupBtn.classList.add("active");
    dmBtn.classList.remove("active");
    renderForm();
  });

  function renderForm(): void {
    if (mode === "dm") {
      renderDMForm();
    } else {
      renderGroupForm();
    }
  }

  function renderDMForm(): void {
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="to-input">To</label>
        <input
          id="to-input"
          class="input"
          type="text"
          placeholder="handle (e.g. jay)"
          value="${recipientHandle ? recipientHandle.replace(/^@/, "") : ""}"
          autocomplete="off"
          autocapitalize="off"
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

    const toInput = form.querySelector("#to-input") as HTMLInputElement;
    const bodyInput = form.querySelector("#body-input") as HTMLTextAreaElement;
    const priorityInput = form.querySelector("#priority-input") as HTMLSelectElement;
    const errorEl = form.querySelector("#compose-error") as HTMLElement;
    const sendBtn = form.querySelector("#send-btn") as HTMLButtonElement;

    // Clean handle: strip @ if typed, allow plain names
    toInput.addEventListener("blur", () => {
      toInput.value = toInput.value.trim().replace(/^@/, "");
    });

    sendBtn.addEventListener("click", async () => {
      const handle = toInput.value.trim().replace(/^@/, "");
      const body = bodyInput.value.trim();
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
        const args: Record<string, unknown> = { to: handle, body, priority };

        // Try E2E encryption
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
          // Fall back to server-assisted
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
            const data = JSON.parse(textItem.text);
            if (data.error) throw new Error(data.error);
            if (data.thread_id) {
              navigateTo("thread", { threadId: data.thread_id });
              return;
            }
          }
        }
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

  function renderGroupForm(): void {
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="group-name-input">Group Name</label>
        <input
          id="group-name-input"
          class="input"
          type="text"
          placeholder="e.g. Project Team"
          autocomplete="off"
        />
      </div>
      <div class="form-group">
        <label class="form-label" for="members-input">Members</label>
        <input
          id="members-input"
          class="input"
          type="text"
          placeholder="handles separated by commas (e.g. jay, erik)"
          autocomplete="off"
          autocapitalize="off"
        />
        <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">Comma-separated handles. You're added automatically as owner.</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="group-body-input">First Message (optional)</label>
        <textarea
          id="group-body-input"
          class="input"
          placeholder="Say something to kick things off..."
          rows="4"
        ></textarea>
      </div>
      <div id="compose-error" class="error-text" style="display:none;margin-bottom:12px;"></div>
      <button id="create-btn" class="btn btn-primary" style="width:100%;">Create Group</button>
    `;

    const nameInput = form.querySelector("#group-name-input") as HTMLInputElement;
    const membersInput = form.querySelector("#members-input") as HTMLInputElement;
    const bodyInput = form.querySelector("#group-body-input") as HTMLTextAreaElement;
    const errorEl = form.querySelector("#compose-error") as HTMLElement;
    const createBtn = form.querySelector("#create-btn") as HTMLButtonElement;

    createBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const membersRaw = membersInput.value.trim();
      const body = bodyInput.value.trim();

      if (!name) {
        errorEl.textContent = "Please enter a group name.";
        errorEl.style.display = "block";
        return;
      }
      if (!membersRaw) {
        errorEl.textContent = "Please enter at least one member handle.";
        errorEl.style.display = "block";
        return;
      }

      const members = membersRaw
        .split(",")
        .map((m) => m.trim().replace(/^@/, ""))
        .filter(Boolean);

      if (members.length === 0) {
        errorEl.textContent = "Please enter at least one member handle.";
        errorEl.style.display = "block";
        return;
      }

      errorEl.style.display = "none";
      createBtn.disabled = true;
      createBtn.textContent = "Creating...";

      try {
        // Create the group
        const result = await app.callServerTool({
          name: "mmp-create-group",
          arguments: { name, members },
        });

        const content = result?.content;
        let threadId: string | undefined;

        if (content && Array.isArray(content)) {
          const textItem = content.find(
            (c: { type: string }) => c.type === "text",
          ) as { type: "text"; text: string } | undefined;

          if (textItem) {
            const data = JSON.parse(textItem.text);
            if (data.error) throw new Error(data.error);
            threadId = data.thread_id;
          }
        }

        // Send first message if provided
        if (threadId && body) {
          await app.callServerTool({
            name: "mmp-send",
            arguments: { thread_id: threadId, body },
          });
        }

        if (threadId) {
          navigateTo("thread", { threadId });
        } else {
          navigateTo("threads");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create group.";
        errorEl.textContent = message;
        errorEl.style.display = "block";
        createBtn.disabled = false;
        createBtn.textContent = "Create Group";
      }
    });
  }

  // Render initial form
  renderForm();
}
