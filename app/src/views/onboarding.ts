import type { App } from "@modelcontextprotocol/ext-apps";
import { generateClientKeyPair, savePrivateKey, savePublicKey } from "../crypto/keys.js";
import { navigateTo } from "../navigation.js";

function validateHandle(handle: string): string | null {
  if (handle.length < 3 || handle.length > 20) {
    return "Handle must be 3-20 characters.";
  }
  if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
    return "Handle can only contain letters, numbers, and underscores.";
  }
  return null;
}

export function renderOnboarding(container: HTMLElement, app: App): void {
  const div = document.createElement("div");
  div.className = "onboarding";
  div.innerHTML = `
    <h1>Welcome to MMP</h1>
    <p>Encrypted messaging over the Model Context Protocol. Claim a handle to get started.</p>
    <div class="form-group">
      <label class="form-label" for="handle-input">Your Handle</label>
      <input
        id="handle-input"
        class="input"
        type="text"
        placeholder="@your_handle"
        maxlength="20"
        autocomplete="off"
        autocapitalize="off"
      />
      <div id="handle-error" class="error-text" style="display:none;"></div>
    </div>
    <button id="claim-btn" class="btn btn-primary" style="width:100%;max-width:300px;">
      Claim Handle
    </button>
    <div id="onboard-status" style="display:none;"></div>
  `;
  container.appendChild(div);

  const input = div.querySelector("#handle-input") as HTMLInputElement;
  const errorEl = div.querySelector("#handle-error") as HTMLElement;
  const btn = div.querySelector("#claim-btn") as HTMLButtonElement;
  const statusEl = div.querySelector("#onboard-status") as HTMLElement;

  // Auto-strip leading @
  input.addEventListener("input", () => {
    if (input.value.startsWith("@")) {
      input.value = input.value.slice(1);
    }
    errorEl.style.display = "none";
  });

  btn.addEventListener("click", async () => {
    const handle = input.value.trim();
    const validationError = validateHandle(handle);
    if (validationError) {
      errorEl.textContent = validationError;
      errorEl.style.display = "block";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Claiming...";
    errorEl.style.display = "none";

    try {
      // Generate client-side key pair
      const keyPair = generateClientKeyPair();

      // Call server registration
      const result = await app.callServerTool({
        name: "mmp-register",
        arguments: {
          handle,
          client_public_key: keyPair.publicKey,
        },
      });

      const content = result?.content;
      if (!content || !Array.isArray(content)) {
        throw new Error("Invalid response from server.");
      }

      const textItem = content.find(
        (c: { type: string }) => c.type === "text",
      ) as { type: "text"; text: string } | undefined;

      if (!textItem) {
        throw new Error("No text response from server.");
      }

      let data: {
        token?: string;
        error?: string;
        handle?: string;
        recovery_code?: string;
      };

      try {
        data = JSON.parse(textItem.text);
      } catch {
        // If it's not JSON, it might be an error message
        throw new Error(textItem.text);
      }

      if (data.error) {
        if (data.error.toLowerCase().includes("taken") || data.error.toLowerCase().includes("exists")) {
          errorEl.textContent = "That handle is already taken. Try another.";
          errorEl.style.display = "block";
          btn.disabled = false;
          btn.textContent = "Claim Handle";
          return;
        }
        throw new Error(data.error);
      }

      if (!data.token) {
        throw new Error("No token received from server.");
      }

      // Save credentials locally
      localStorage.setItem("mmp_token", data.token);
      localStorage.setItem("mmp_handle", handle);
      savePrivateKey(keyPair.privateKey);
      savePublicKey(keyPair.publicKey);

      // Show success
      statusEl.style.display = "block";
      statusEl.innerHTML = `
        <div style="margin-top:16px;">
          <p class="success-text" style="margin-bottom:12px;">
            Account created! You are <strong>@${handle}</strong>.
          </p>
          ${data.recovery_code ? `
          <div class="form-group">
            <label class="form-label">Recovery Code (save this!)</label>
            <div class="mono-box">${data.recovery_code}</div>
          </div>
          ` : ""}
          <div class="form-group">
            <label class="form-label">Your Token</label>
            <div class="copyable">
              <div class="mono-box" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;">
                ${data.token.substring(0, 20)}...
              </div>
              <button class="btn" id="copy-token-btn">Copy</button>
            </div>
          </div>
          <button id="continue-btn" class="btn btn-primary" style="width:100%;margin-top:12px;">
            Continue to Inbox
          </button>
        </div>
      `;

      const copyBtn = statusEl.querySelector("#copy-token-btn") as HTMLButtonElement;
      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(data.token!);
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
        });
      }

      const continueBtn = statusEl.querySelector("#continue-btn") as HTMLButtonElement;
      if (continueBtn) {
        continueBtn.addEventListener("click", () => {
          navigateTo("threads");
        });
      }

      btn.style.display = "none";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed.";
      errorEl.textContent = message;
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Claim Handle";
    }
  });
}
