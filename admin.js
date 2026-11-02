
const $ = selector => document.querySelector(selector);

const state = {
  chatHistory: [],
  user: null,
  role: "user",
  users: [],
  logs: [],
  pending: null,
  searchTimer: null,
  chatSending: false
};

// =====================================
// API CONNECTION
// =====================================

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    location.href = "/auth.html";
    throw new Error("Please sign in again.");
  }

  if (!response.ok) {
    throw new Error(data.error || "The request could not be completed.");
  }

  return data;
}

// =====================================
// NOTIFICATIONS
// =====================================

function notice(message, error = false) {
  const el = $("#notice");
  if (!el) return;

  el.textContent = message;
  el.classList.toggle("error", error);
}

// =====================================
// HELPERS
// =====================================

function dateLabel(value) {
  if (!value) return "—";

  const date = new Date(
    value.includes("T")
      ? value
      : value.replace(" ", "T") + "Z"
  );

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
}

function initials(value = "V") {
  return String(value).trim().slice(0, 1).toUpperCase() || "V";
}

function roleName(role) {
  return String(role || "user").replaceAll("_", " ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// =====================================
// USER TABLE ROWS
// =====================================

function userMarkup(user, adminMode = false) {
  const actions = [];

  if (user.role !== "creator" && state.role !== "admin") {
    if (state.role === "creator" || user.role === "user") {
      actions.push(`
        <button
          class="table-action"
          data-role="${escapeHtml(user.id)}"
          data-next="${user.role === "admin" ? "user" : "admin"}"
        >
          ${user.role === "admin" ? "Make user" : "Make admin"}
        </button>
      `);
    }

    if (state.role === "creator" && user.role !== "super_admin") {
      actions.push(`
        <button
          class="table-action"
          data-role="${escapeHtml(user.id)}"
          data-next="super_admin"
        >
          Make super admin
        </button>
      `);
    }
  }

  if (
    user.role !== "creator" &&
    (
      state.role === "creator" ||
      state.role === "super_admin" ||
      user.role === "user"
    )
  ) {
    actions.push(`
      <button
        class="table-action ${user.status === "active" ? "danger" : ""}"
        data-status="${escapeHtml(user.id)}"
        data-next-status="${user.status === "active" ? "suspended" : "active"}"
      >
        ${user.status === "active" ? "Suspend" : "Restore"}
      </button>
    `);
  }

  const joined = dateLabel(user.createdAt);

  if (adminMode) {
    return `
      <tr>
        <td>
          <div class="user-cell">
            <span class="user-avatar">${escapeHtml(initials(user.username))}</span>
            <div>
              <b>${escapeHtml(user.username)}</b>
              <small>${escapeHtml(user.email || "")}</small>
            </div>
          </div>
        </td>
        <td>
          <span class="role-label">${escapeHtml(roleName(user.role))}</span>
        </td>
        <td>
          <span class="status ${escapeHtml(user.status)}">
            ${escapeHtml(user.status)}
          </span>
        </td>
        <td>${escapeHtml(joined)}</td>
        <td>${actions.join(" ") || "—"}</td>
      </tr>
    `;
  }

  return `
    <tr>
      <td>
        <div class="user-cell">
          <span class="user-avatar">${escapeHtml(initials(user.username))}</span>
          <div>
            <b>${escapeHtml(user.name)}</b>
            <small>@${escapeHtml(user.username)}</small>
          </div>
        </div>
      </td>
      <td>${escapeHtml(user.email || "")}</td>
      <td>
        <span class="role-label">${escapeHtml(roleName(user.role))}</span>
      </td>
      <td>
        <span class="status ${escapeHtml(user.status)}">
          ${escapeHtml(user.status)}
        </span>
      </td>
      <td>${escapeHtml(joined)}</td>
      <td>${actions.join(" ") || "—"}</td>
    </tr>
  `;
}

// =====================================
// RENDER USERS
// =====================================

function renderUsers(users) {
  state.users = users;

  $("#usersTable").innerHTML = users.length
    ? users.map(user => userMarkup(user)).join("")
    : `<tr><td colspan="6" class="empty">No matching accounts found.</td></tr>`;

  const admins = users.filter(user =>
    ["admin", "super_admin"].includes(user.role)
  );

  $("#adminsTable").innerHTML = admins.length
    ? admins.map(user => userMarkup(user, true)).join("")
    : `<tr><td colspan="5" class="empty">No administrators have been appointed yet.</td></tr>`;

  $("#recentUsers").innerHTML = users.slice(0, 5).map(user => `
    <tr>
      <td>
        <div class="user-cell">
          <span class="user-avatar">${escapeHtml(initials(user.username))}</span>
          <div>
            <b>${escapeHtml(user.name)}</b>
            <small>@${escapeHtml(user.username)}</small>
          </div>
        </div>
      </td>
      <td>
        <span class="role-label">${escapeHtml(roleName(user.role))}</span>
      </td>
      <td>
        <span class="status ${escapeHtml(user.status)}">${escapeHtml(user.status)}</span>
      </td>
      <td>${escapeHtml(dateLabel(user.createdAt))}</td>
    </tr>
  `).join("") || `
    <tr><td colspan="4" class="empty">No accounts yet.</td></tr>
  `;
}

// =====================================
// OVERVIEW
// =====================================

async function loadOverview() {
  const data = await api("/api/admin/overview");
  const stats = data.stats || {};

  $("#totalUsers").textContent = stats.totalUsers ?? 0;
  $("#activeUsers").textContent = stats.activeUsers ?? 0;
  $("#adminCount").textContent =
    (stats.admins || 0) + (stats.superAdmins || 0);
  $("#activeSessions").textContent = stats.activeSessions ?? 0;

  $("#aiStatus").textContent = data.aiConfigured
    ? "Configured"
    : "Not configured";

  $("#emailStatus").textContent = data.emailConfigured
    ? "Configured"
    : "Not configured";

  $("#aiDot").classList.toggle("good", Boolean(data.aiConfigured));
  $("#emailDot").classList.toggle("good", Boolean(data.emailConfigured));
}

// =====================================
// LOAD USERS
// =====================================

async function loadUsers(query = "") {
  const data = await api(
    `/api/admin/users?q=${encodeURIComponent(query)}`
  );

  renderUsers(data.users || []);
}

// =====================================
// AUDIT LOG
// =====================================

async function loadAudit() {
  const data = await api("/api/admin/audit");

  state.logs = data.logs || [];

  $("#auditTable").innerHTML = state.logs.length
    ? state.logs.map(log => `
      <tr>
        <td>${escapeHtml(log.action)}</td>
        <td>
          ${escapeHtml(log.actor_username)}
          <br>
          <small>${escapeHtml(roleName(log.actor_role))}</small>
        </td>
        <td>${escapeHtml(log.target_username || "—")}</td>
        <td>${escapeHtml(JSON.stringify(log.details || {}))}</td>
        <td>${escapeHtml(dateLabel(log.created_at))}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5" class="empty">No administrative activity recorded yet.</td></tr>`;
}

// =====================================
// REFRESH DASHBOARD
// =====================================

async function refreshAll() {
  try {
    await Promise.all([
      loadOverview(),
      loadUsers($("#userSearch").value),
      loadAudit()
    ]);
  } catch (error) {
    notice(error.message, true);
  }
}

// =====================================
// NAVIGATION
// =====================================

function showView(name) {
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });

  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.dataset.view === name);
  });

  $("#pageHeading").textContent = ({
    overview: "Overview",
    users: "User management",
    admins: "Administrators",
    security: "Security & audit",
    chat: "VYTRON AI Chat"
  })[name] || "Overview";

  $("#sidebar").classList.remove("open");
}

// =====================================
// CONFIRMATION MODAL
// =====================================

function askConfirm(title, message, action) {
  state.pending = action;

  $("#modalTitle").textContent = title;
  $("#modalText").textContent = message;

  $("#confirmModal").classList.add("open");
}

async function performPending() {
  const action = state.pending;
  if (!action) return;

  $("#confirmAction").disabled = true;

  try {
    await action();

    $("#confirmModal").classList.remove("open");
    notice("Changes saved successfully.");

    await refreshAll();
  } catch (error) {
    notice(error.message, true);
  } finally {
    $("#confirmAction").disabled = false;
    state.pending = null;
  }
}

// =====================================
// DASHBOARD CLICK ACTIONS
// =====================================

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-view], [data-goto]");

  if (nav) {
    showView(nav.dataset.view || nav.dataset.goto);
  }

  const roleButton = event.target.closest("[data-role]");

  if (roleButton) {
    const next = roleButton.dataset.next;

    const user = state.users.find(
      item => String(item.id) === roleButton.dataset.role
    );

    askConfirm(
      "Change account role?",
      `Change ${user?.username || "this account"} to ${roleName(next)}?`,
      async () => {
        await api(
          `/api/admin/users/${roleButton.dataset.role}/role`,
          {
            method: "PATCH",
            body: JSON.stringify({ role: next })
          }
        );
      }
    );
  }

  const statusButton = event.target.closest("[data-status]");

  if (statusButton) {
    const next = statusButton.dataset.nextStatus;

    const user = state.users.find(
      item => String(item.id) === statusButton.dataset.status
    );

    askConfirm(
      next === "suspended"
        ? "Suspend this account?"
        : "Restore this account?",

      `${user?.username || "This user"} will ${
        next === "suspended"
          ? "lose access immediately"
          : "regain access"
      }. `,

      async () => {
        await api(
          `/api/admin/users/${statusButton.dataset.status}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({ status: next })
          }
        );
      }
    );
  }
});

// =====================================
// MODAL BUTTONS
// =====================================

$("#confirmAction").addEventListener("click", performPending);

$("#cancelAction").addEventListener("click", () => {
  $("#confirmModal").classList.remove("open");
  state.pending = null;
});

// =====================================
// REFRESH BUTTON
// =====================================

$("#refreshBtn").addEventListener("click", refreshAll);

// =====================================
// MOBILE MENU
// =====================================

$("#menuBtn").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

// =====================================
// LOGOUT
// =====================================

$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", {
      method: "POST",
      body: "{}"
    });
  } catch (error) {
    console.error("Logout error:", error);
  } finally {
    location.href = "/auth.html";
  }
});

// =====================================
// USER SEARCH
// =====================================

$("#userSearch").addEventListener("input", () => {
  clearTimeout(state.searchTimer);

  state.searchTimer = setTimeout(() => {
    loadUsers($("#userSearch").value).catch(error => {
      notice(error.message, true);
    });
  }, 250);
});

// =====================================
// VYTRON AI — ADMIN CHAT
// =====================================

const adminChatMessages = $("#adminChatMessages");
const adminChatInput = $("#adminChatInput");
const adminChatSend = $("#adminChatSend");
const adminChatClear = $("#adminChatClear");
const adminChatStatus = $("#adminChatStatus");
const adminChatCount = $("#adminChatCount");

function scrollAdminChat() {
  adminChatMessages.scrollTop = adminChatMessages.scrollHeight;
}

function addAdminChatMessage(role, message) {
  const welcome = $("#adminChatWelcome");
  if (welcome) welcome.remove();

  const messageElement = document.createElement("div");
  messageElement.className = `admin-chat-message ${role}`;

  const label = document.createElement("div");
  label.className = "admin-chat-label";
  label.textContent = role === "user" ? "YOU" : "VYTRON AI";

  const content = document.createElement("div");
  content.className = "admin-chat-content";
  content.textContent = message;

  messageElement.append(label, content);
  adminChatMessages.appendChild(messageElement);

  scrollAdminChat();
  return messageElement;
}

function showAdminTyping() {
  const element = document.createElement("div");
  element.className = "admin-chat-message assistant";

  const label = document.createElement("div");
  label.className = "admin-chat-label";
  label.textContent = "VYTRON AI";

  const dots = document.createElement("div");
  dots.className = "admin-chat-typing";

  for (let i = 0; i < 3; i++) {
    dots.appendChild(document.createElement("span"));
  }

  element.append(label, dots);
  adminChatMessages.appendChild(element);

  scrollAdminChat();
  return element;
}

function updateAdminChatCount() {
  adminChatCount.textContent = `${adminChatInput.value.length} / 6000`;
}

function resizeAdminChatInput() {
  adminChatInput.style.height = "auto";
  adminChatInput.style.height =
    Math.min(adminChatInput.scrollHeight, 150) + "px";
}

async function sendAdminChatMessage() {
  const message = adminChatInput.value.trim();

  if (!message || state.chatSending) return;

  state.chatSending = true;

  adminChatInput.value = "";
  updateAdminChatCount();
  resizeAdminChatInput();

  adminChatInput.disabled = true;
  adminChatSend.disabled = true;

  adminChatStatus.textContent = "VYTRON AI is thinking...";

  addAdminChatMessage("user", message);

  const previousHistory = [...state.chatHistory];

  state.chatHistory.push({
    role: "user",
    text: message
  });

  state.chatHistory = state.chatHistory.slice(-20);

  const typing = showAdminTyping();

  try {
    const data = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        history: previousHistory,
        style: "balanced",
        userName: state.user?.name || state.user?.username || "User"
      })
    });

    typing.remove();

    const reply = data.reply ||
      "I couldn't generate a response. Please try again.";

    addAdminChatMessage("assistant", reply);

    state.chatHistory.push({
      role: "model",
      text: reply
    });

    state.chatHistory = state.chatHistory.slice(-20);

    adminChatStatus.textContent = "VYTRON AI is ready.";

  } catch (error) {
    typing.remove();

    addAdminChatMessage(
      "assistant",
      `I couldn't connect to VYTRON AI. ${error.message}`
    );

    state.chatHistory = previousHistory;

    adminChatStatus.textContent = "Connection error.";
    console.error("Admin chat error:", error);

  } finally {
    state.chatSending = false;
    adminChatInput.disabled = false;
    adminChatSend.disabled = false;
    adminChatInput.focus();
  }
}

// SEND BUTTON
adminChatSend.addEventListener("click", sendAdminChatMessage);

// ENTER TO SEND, SHIFT + ENTER FOR NEW LINE
adminChatInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendAdminChatMessage();
  }
});

// AUTO RESIZE + CHARACTER COUNT
adminChatInput.addEventListener("input", () => {
  resizeAdminChatInput();
  updateAdminChatCount();
});

// STARTER PROMPTS
function attachAdminStarterEvents() {
  adminChatMessages.querySelectorAll(".admin-starter").forEach(button => {
    button.addEventListener("click", () => {
      adminChatInput.value = button.dataset.prompt || "";
      updateAdminChatCount();
      resizeAdminChatInput();
      adminChatInput.focus();
    });
  });
}

attachAdminStarterEvents();

// NEW CHAT
adminChatClear.addEventListener("click", () => {
  if (state.chatSending) return;

  state.chatHistory = [];

  adminChatMessages.innerHTML = `
    <div class="vytron-welcome" id="adminChatWelcome">
      <div class="vytron-hero-orb">
        <div class="vytron-orb-ring ring-one"></div>
        <div class="vytron-orb-ring ring-two"></div>
        <div class="vytron-orb-core">✦</div>
      </div>

      <span class="chat-eyebrow">YOUR AI WORKSPACE</span>
      <h1>Ideas become <span>real here.</span></h1>
      <p>Think clearly. Create boldly. Build what comes next.</p>

      <div class="admin-starter-grid">
        <button class="admin-starter" data-prompt="Explain how VYTRON AI works.">
          <span>✧</span>
          <b>Explore VYTRON</b>
          <small>Understand your AI assistant</small>
        </button>

        <button class="admin-starter" data-prompt="Help me analyze my platform's performance and suggest improvements.">
          <span>◈</span>
          <b>Analyze my platform</b>
          <small>Discover useful improvements</small>
        </button>

        <button class="admin-starter" data-prompt="Help me write clean and efficient JavaScript code.">
          <span>⌘</span>
          <b>Write some code</b>
          <small>Build something useful</small>
        </button>

        <button class="admin-starter" data-prompt="Give me five creative ideas for improving an educational platform.">
          <span>✦</span>
          <b>Brainstorm ideas</b>
          <small>Turn ideas into possibilities</small>
        </button>
      </div>
    </div>
  `;

  attachAdminStarterEvents();

  adminChatInput.value = "";
  updateAdminChatCount();
  resizeAdminChatInput();

  adminChatStatus.textContent = "New conversation started.";
});

// =====================================
// INITIALIZE DASHBOARD
// =====================================

(async function init() {
  try {
    const data = await api("/api/auth/me");

    if (
      !data.authenticated ||
      !data.user ||
      !["creator", "super_admin", "admin"].includes(data.user.role)
    ) {
      location.href = "/";
      return;
    }

    state.user = data.user;
    state.role = data.user.role;

    $("#adminName").textContent =
      data.user.name || data.user.username;

    $("#adminRole").textContent = roleName(data.user.role);

    $("#avatar").textContent =
      initials(data.user.name || data.user.username);

    if (state.role === "admin") {
      $("#adminsNav").hidden = true;
      $("#quickAdmins").hidden = true;

      $("#roleNote").textContent =
        "Admins can manage ordinary user accounts. Role assignment is reserved for Super Admins and the Creator.";

    } else if (state.role === "super_admin") {
      $("#roleNote").textContent =
        "Super Admins can appoint standard Admins. Only the Creator can appoint or modify Super Admins.";

    } else {
      $("#roleNote").textContent =
        "The Creator has full administrative control over platform roles and permissions.";
    }

    await refreshAll();

  } catch (error) {
    notice(error.message, true);
  }
})();
