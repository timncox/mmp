import type { App } from "@modelcontextprotocol/ext-apps";
import { navigateTo } from "../navigation.js";

interface ContactData {
  handle: string;
  display_name: string;
  nickname: string;
}

interface SearchResult {
  handle: string;
  display_name: string;
}

export function renderContacts(container: HTMLElement, app: App): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.flex = "1";

  // Header
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <button class="btn-icon" id="back-btn" title="Back">&#8592;</button>
    <div class="header-title">Contacts</div>
  `;
  wrapper.appendChild(header);

  const backBtn = header.querySelector("#back-btn")!;
  backBtn.addEventListener("click", () => navigateTo("threads"));

  // Search bar
  const searchGroup = document.createElement("div");
  searchGroup.className = "form-group";
  searchGroup.style.padding = "8px 0";
  searchGroup.innerHTML = `
    <input
      id="search-input"
      class="input"
      type="text"
      placeholder="Search users by handle or name..."
      autocomplete="off"
      autocapitalize="off"
    />
  `;
  wrapper.appendChild(searchGroup);

  // Search results area
  const searchResults = document.createElement("div");
  searchResults.id = "search-results";
  searchResults.style.display = "none";
  wrapper.appendChild(searchResults);

  // Contacts list
  const listEl = document.createElement("div");
  listEl.id = "contacts-list";
  wrapper.appendChild(listEl);

  container.appendChild(wrapper);

  const searchInput = searchGroup.querySelector("#search-input") as HTMLInputElement;

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);

    if (query.length === 0) {
      searchResults.style.display = "none";
      listEl.style.display = "block";
      return;
    }

    debounceTimer = setTimeout(() => searchUsers(query), 300);
  });

  async function searchUsers(query: string): Promise<void> {
    searchResults.style.display = "block";
    listEl.style.display = "none";
    searchResults.innerHTML = '<div class="loading">Searching...</div>';

    try {
      const result = await app.callServerTool({
        name: "mmp-search_users",
        arguments: { query },
      });

      const content = result?.content;
      if (!content || !Array.isArray(content)) {
        searchResults.innerHTML = '<div class="empty-state"><p>No users found.</p></div>';
        return;
      }

      const textItem = content.find(
        (c: { type: string }) => c.type === "text",
      ) as { type: "text"; text: string } | undefined;

      if (!textItem) {
        searchResults.innerHTML = '<div class="empty-state"><p>No users found.</p></div>';
        return;
      }

      let users: SearchResult[];
      try {
        const parsed = JSON.parse(textItem.text);
        users = Array.isArray(parsed) ? parsed : parsed.users ?? [];
      } catch {
        users = [];
      }

      if (users.length === 0) {
        searchResults.innerHTML = '<div class="empty-state"><p>No users found.</p></div>';
        return;
      }

      searchResults.innerHTML = "";
      users.forEach((user) => {
        const item = document.createElement("div");
        item.className = "contact-item";
        item.innerHTML = `
          <div>
            <div class="contact-handle">@${user.handle}</div>
            ${user.display_name ? `<div class="contact-nickname">${user.display_name}</div>` : ""}
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn" data-action="add" data-handle="${user.handle}">Add</button>
            <button class="btn btn-primary" data-action="msg" data-handle="${user.handle}">Message</button>
          </div>
        `;
        searchResults.appendChild(item);
      });

      searchResults.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName !== "BUTTON") return;
        const action = target.dataset.action;
        const handle = target.dataset.handle;
        if (!handle) return;

        if (action === "add") {
          try {
            await app.callServerTool({
              name: "mmp-add_contact",
              arguments: { handle },
            });
            target.textContent = "Added";
            target.setAttribute("disabled", "true");
            loadContacts();
          } catch {
            target.textContent = "Error";
          }
        } else if (action === "msg") {
          navigateTo("compose", { recipientHandle: handle });
        }
      });
    } catch {
      searchResults.innerHTML =
        '<div class="empty-state"><p class="error-text">Search failed.</p></div>';
    }
  }

  async function loadContacts(): Promise<void> {
    listEl.innerHTML = '<div class="loading">Loading contacts...</div>';

    try {
      const result = await app.callServerTool({
        name: "mmp-contacts",
        arguments: {},
      });

      const content = result?.content;
      if (!content || !Array.isArray(content)) {
        listEl.innerHTML =
          '<div class="empty-state"><p>No contacts yet. Search above to find people.</p></div>';
        return;
      }

      const textItem = content.find(
        (c: { type: string }) => c.type === "text",
      ) as { type: "text"; text: string } | undefined;

      if (!textItem) {
        listEl.innerHTML =
          '<div class="empty-state"><p>No contacts yet. Search above to find people.</p></div>';
        return;
      }

      let contacts: ContactData[];
      try {
        const parsed = JSON.parse(textItem.text);
        contacts = Array.isArray(parsed) ? parsed : parsed.contacts ?? [];
      } catch {
        contacts = [];
      }

      if (contacts.length === 0) {
        listEl.innerHTML =
          '<div class="empty-state"><p>No contacts yet. Search above to find people.</p></div>';
        return;
      }

      listEl.innerHTML = '<div class="section-title">Your Contacts</div>';
      contacts.forEach((contact) => {
        const item = document.createElement("div");
        item.className = "contact-item";
        item.innerHTML = `
          <div>
            <div class="contact-handle">@${contact.handle}</div>
            ${contact.nickname ? `<div class="contact-nickname">${contact.nickname}</div>` : ""}
            ${contact.display_name ? `<div class="contact-nickname">${contact.display_name}</div>` : ""}
          </div>
        `;
        item.addEventListener("click", () => {
          navigateTo("compose", { recipientHandle: contact.handle });
        });
        listEl.appendChild(item);
      });
    } catch {
      listEl.innerHTML =
        '<div class="empty-state"><p class="error-text">Failed to load contacts.</p></div>';
    }
  }

  loadContacts();
}
