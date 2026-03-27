import type { App } from "@modelcontextprotocol/ext-apps";
import { navigateTo } from "../inbox-app.js";
import { getPublicKey, getPrivateKey } from "../crypto/keys.js";

export function renderSettings(container: HTMLElement, app: App): void {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.flex = "1";

  // Header
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <button class="btn-icon" id="back-btn" title="Back">&#8592;</button>
    <div class="header-title">Settings</div>
  `;
  wrapper.appendChild(header);

  const backBtn = header.querySelector("#back-btn")!;
  backBtn.addEventListener("click", () => navigateTo("threads"));

  // Content
  const content = document.createElement("div");
  content.innerHTML = `
    <div class="section">
      <div class="section-title">Profile</div>
      <div class="form-group">
        <label class="form-label" for="display-name">Display Name</label>
        <input id="display-name" class="input" type="text" placeholder="Your display name" />
      </div>
      <div class="form-group">
        <label class="form-label" for="bio">Bio</label>
        <textarea id="bio" class="input" placeholder="Write a short bio..." rows="3"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="status">Status</label>
        <input id="status" class="input" type="text" placeholder="What are you up to?" />
      </div>
      <div class="form-group">
        <label class="form-label" for="privacy">Privacy</label>
        <select id="privacy" class="input">
          <option value="public">Public</option>
          <option value="contacts_only">Contacts Only</option>
          <option value="private">Private</option>
        </select>
      </div>
      <div id="profile-status" style="display:none;margin-bottom:8px;"></div>
      <button id="save-profile-btn" class="btn btn-primary">Save Profile</button>
    </div>

    <div class="section">
      <div class="section-title">Change Handle</div>
      <div class="form-group">
        <label class="form-label" for="current-handle">Current Handle</label>
        <div class="mono-box" id="current-handle">Loading...</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="new-handle">New Handle</label>
        <input id="new-handle" class="input" type="text" placeholder="new_handle" autocomplete="off" autocapitalize="off" />
      </div>
      <div id="handle-status" style="display:none;margin-bottom:8px;"></div>
      <button id="change-handle-btn" class="btn">Change Handle</button>
    </div>

    <div class="section">
      <div class="section-title">Encryption Keys</div>
      <div class="form-group">
        <label class="form-label">Client Public Key</label>
        <div class="mono-box" id="pub-key-display">Not available</div>
      </div>
      <div class="form-group">
        <label class="form-label">Private Key Backup</label>
        <div class="copyable">
          <div class="mono-box" id="priv-key-display" style="overflow:hidden;text-overflow:ellipsis;">Not available</div>
          <button class="btn" id="copy-priv-key-btn">Copy</button>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">Save this key securely. If you lose it, you cannot decrypt your E2E messages.</p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Auth Token</div>
      <div class="copyable">
        <div class="mono-box" id="token-display" style="overflow:hidden;text-overflow:ellipsis;">Not available</div>
        <button class="btn" id="copy-token-btn">Copy</button>
      </div>
    </div>

    <div class="section" style="border-bottom:none;">
      <button id="logout-btn" class="btn" style="width:100%;color:var(--error);">Log Out</button>
    </div>
  `;
  wrapper.appendChild(content);
  container.appendChild(wrapper);

  // Populate key info
  const pubKey = getPublicKey();
  const privKey = getPrivateKey();
  const token = localStorage.getItem("mmp_token");
  const currentHandle = localStorage.getItem("mmp_handle") ?? "unknown";

  const pubKeyEl = content.querySelector("#pub-key-display") as HTMLElement;
  const privKeyEl = content.querySelector("#priv-key-display") as HTMLElement;
  const tokenEl = content.querySelector("#token-display") as HTMLElement;
  const handleEl = content.querySelector("#current-handle") as HTMLElement;

  handleEl.textContent = `@${currentHandle}`;
  if (pubKey) pubKeyEl.textContent = pubKey;
  if (privKey) privKeyEl.textContent = privKey.substring(0, 24) + "...";
  if (token) tokenEl.textContent = token.substring(0, 20) + "...";

  // Copy buttons
  const copyPrivBtn = content.querySelector("#copy-priv-key-btn") as HTMLButtonElement;
  copyPrivBtn.addEventListener("click", () => {
    if (privKey) {
      navigator.clipboard.writeText(privKey);
      copyPrivBtn.textContent = "Copied!";
      setTimeout(() => { copyPrivBtn.textContent = "Copy"; }, 2000);
    }
  });

  const copyTokenBtn = content.querySelector("#copy-token-btn") as HTMLButtonElement;
  copyTokenBtn.addEventListener("click", () => {
    if (token) {
      navigator.clipboard.writeText(token);
      copyTokenBtn.textContent = "Copied!";
      setTimeout(() => { copyTokenBtn.textContent = "Copy"; }, 2000);
    }
  });

  // Load current profile
  const displayNameInput = content.querySelector("#display-name") as HTMLInputElement;
  const bioInput = content.querySelector("#bio") as HTMLTextAreaElement;
  const statusInput = content.querySelector("#status") as HTMLInputElement;
  const privacySelect = content.querySelector("#privacy") as HTMLSelectElement;

  async function loadProfile(): Promise<void> {
    try {
      const result = await app.callServerTool({
        name: "msg/profile",
        arguments: {},
      });

      const contentArr = result?.content;
      if (!contentArr || !Array.isArray(contentArr)) return;

      const textItem = contentArr.find(
        (c: { type: string }) => c.type === "text",
      ) as { type: "text"; text: string } | undefined;

      if (!textItem) return;

      let profile: {
        display_name?: string;
        bio?: string;
        status?: string;
        privacy?: string;
        handle?: string;
      };
      try {
        profile = JSON.parse(textItem.text);
      } catch {
        return;
      }

      if (profile.display_name) displayNameInput.value = profile.display_name;
      if (profile.bio) bioInput.value = profile.bio;
      if (profile.status) statusInput.value = profile.status;
      if (profile.privacy) privacySelect.value = profile.privacy;
      if (profile.handle) {
        handleEl.textContent = `@${profile.handle}`;
        localStorage.setItem("mmp_handle", profile.handle);
      }
    } catch {
      // Non-critical
    }
  }

  // Save profile
  const profileStatusEl = content.querySelector("#profile-status") as HTMLElement;
  const saveProfileBtn = content.querySelector("#save-profile-btn") as HTMLButtonElement;

  saveProfileBtn.addEventListener("click", async () => {
    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = "Saving...";
    profileStatusEl.style.display = "none";

    try {
      await app.callServerTool({
        name: "msg/set_profile",
        arguments: {
          display_name: displayNameInput.value.trim(),
          bio: bioInput.value.trim(),
          status: statusInput.value.trim(),
          privacy: privacySelect.value,
        },
      });

      profileStatusEl.className = "success-text";
      profileStatusEl.textContent = "Profile saved.";
      profileStatusEl.style.display = "block";
    } catch {
      profileStatusEl.className = "error-text";
      profileStatusEl.textContent = "Failed to save profile.";
      profileStatusEl.style.display = "block";
    } finally {
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = "Save Profile";
    }
  });

  // Change handle
  const newHandleInput = content.querySelector("#new-handle") as HTMLInputElement;
  const handleStatusEl = content.querySelector("#handle-status") as HTMLElement;
  const changeHandleBtn = content.querySelector("#change-handle-btn") as HTMLButtonElement;

  newHandleInput.addEventListener("input", () => {
    if (newHandleInput.value.startsWith("@")) {
      newHandleInput.value = newHandleInput.value.slice(1);
    }
  });

  changeHandleBtn.addEventListener("click", async () => {
    const newHandle = newHandleInput.value.trim();
    if (!newHandle) {
      handleStatusEl.className = "error-text";
      handleStatusEl.textContent = "Please enter a new handle.";
      handleStatusEl.style.display = "block";
      return;
    }

    if (newHandle.length < 3 || newHandle.length > 20 || !/^[a-zA-Z0-9_]+$/.test(newHandle)) {
      handleStatusEl.className = "error-text";
      handleStatusEl.textContent = "Handle must be 3-20 chars, alphanumeric + underscores.";
      handleStatusEl.style.display = "block";
      return;
    }

    changeHandleBtn.disabled = true;
    changeHandleBtn.textContent = "Changing...";
    handleStatusEl.style.display = "none";

    try {
      const result = await app.callServerTool({
        name: "msg/change_handle",
        arguments: { new_handle: newHandle },
      });

      const contentArr = result?.content;
      if (contentArr && Array.isArray(contentArr)) {
        const textItem = contentArr.find(
          (c: { type: string }) => c.type === "text",
        ) as { type: "text"; text: string } | undefined;

        if (textItem) {
          let data: { error?: string };
          try {
            data = JSON.parse(textItem.text);
          } catch {
            data = {};
          }

          if (data.error) {
            throw new Error(data.error);
          }
        }
      }

      localStorage.setItem("mmp_handle", newHandle);
      handleEl.textContent = `@${newHandle}`;
      newHandleInput.value = "";

      handleStatusEl.className = "success-text";
      handleStatusEl.textContent = "Handle changed successfully.";
      handleStatusEl.style.display = "block";
    } catch (err) {
      handleStatusEl.className = "error-text";
      handleStatusEl.textContent =
        err instanceof Error ? err.message : "Failed to change handle.";
      handleStatusEl.style.display = "block";
    } finally {
      changeHandleBtn.disabled = false;
      changeHandleBtn.textContent = "Change Handle";
    }
  });

  // Logout
  const logoutBtn = content.querySelector("#logout-btn") as HTMLButtonElement;
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("mmp_token");
    localStorage.removeItem("mmp_handle");
    localStorage.removeItem("mmp_private_key");
    localStorage.removeItem("mmp_public_key");
    navigateTo("onboarding");
  });

  loadProfile();
}
