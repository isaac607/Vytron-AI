(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const STORAGE_KEY = "vytron_ai_v1";
  const API_URL = "/api/chat";
  const MAX_MESSAGE_LENGTH = 6000;
  const MAX_HISTORY_MESSAGES = 20;

  const ACCENTS = [
    { name: "Violet / Mint", a: "#8b7bff", b: "#42e4d1" },
    { name: "Electric Blue", a: "#4d9bff", b: "#59e1ff" },
    { name: "Solar Ember", a: "#ff9b57", b: "#ff5d94" },
    { name: "Cyber Lime", a: "#b6f36a", b: "#42e4d1" },
    { name: "Rose Quartz", a: "#ff73b7", b: "#a18bff" },
    { name: "Gold / Flame", a: "#ffd166", b: "#ff795e" }
  ];

  const STARTERS = [
    {
      icon: "✳",
      title: "Build something",
      desc: "Turn an idea into a practical plan",
      prompt: "Help me turn a startup idea into a practical step-by-step plan."
    },
    {
      icon: "⌘",
      title: "Write some code",
      desc: "Explore HTML, CSS or JavaScript",
      prompt: "Show me a clean, modern responsive HTML, CSS and JavaScript starter."
    },
    {
      icon: "◈",
      title: "Think it through",
      desc: "Break down a difficult topic",
      prompt: "Explain a difficult technical topic in simple terms, with an example."
    },
    {
      icon: "✎",
      title: "Create a first draft",
      desc: "Get words on the page faster",
      prompt: "Help me write a compelling product description for a new app."
    }
  ];

  const VAULT = [
    { cat: "Build", icon: "⌘", title: "Launch a web app", desc: "Map an idea into a realistic build plan.", prompt: "Help me plan a modern web app. Ask about target users, core features, technology and launch." },
    { cat: "Build", icon: "▦", title: "Responsive UI", desc: "Create a layout for every screen.", prompt: "Help me build a complete responsive HTML and CSS layout with a polished modern design." },
    { cat: "Build", icon: "⌁", title: "Debugging partner", desc: "Find the likely cause of an error.", prompt: "Help me debug my code. Explain how to isolate the cause and fix it." },
    { cat: "Code", icon: "{ }", title: "JavaScript coach", desc: "Learn programming through examples.", prompt: "Teach me a useful JavaScript concept with an explanation, code example and practice task." },
    { cat: "Code", icon: "◫", title: "API integration", desc: "Connect a frontend to a backend.", prompt: "Explain how to connect a frontend to an API securely, including server-side secrets and error handling." },
    { cat: "Code", icon: "✳", title: "Code review", desc: "Improve readability and reliability.", prompt: "Review my code for readability, security, reliability and performance." },
    { cat: "Writing", icon: "✎", title: "Product story", desc: "Make your product pitch clearer.", prompt: "Help me write a compelling product pitch explaining the problem, audience, solution and differentiator." },
    { cat: "Writing", icon: "↗", title: "Professional email", desc: "Write a clear professional message.", prompt: "Help me write a concise, polite and professional email." },
    { cat: "Thinking", icon: "◎", title: "Decision matrix", desc: "Compare options and trade-offs.", prompt: "Compare three options using criteria, trade-offs, risks and a recommendation." },
    { cat: "Thinking", icon: "◷", title: "Weekly reset", desc: "Organize your priorities.", prompt: "Help me plan a balanced week around my three biggest priorities and deadlines." },
    { cat: "Learning", icon: "✦", title: "Learn by doing", desc: "Create a hands-on learning plan.", prompt: "Create a beginner learning plan with short exercises and checkpoints." },
    { cat: "Learning", icon: "⌬", title: "Explain a concept", desc: "Make complicated topics understandable.", prompt: "Explain a technical concept using a simple analogy and a practical example." }
  ];

  const DEFAULT_SETTINGS = {
    name: "",
    accent: 0,
    typing: true,
    orbs: true,
    style: "balanced",
    theme: "dark"
  };

  const DEFAULT_TOPICS = {
    Build: 0,
    Code: 0,
    Writing: 0,
    Thinking: 0,
    Learning: 0,
    General: 0
  };

  let state = {
    sessions: [],
    projects: [],
    settings: { ...DEFAULT_SETTINGS },
    stats: {
      msgs: 0,
      code: 0,
      latencies: [],
      topics: { ...DEFAULT_TOPICS }
    },
    logs: []
  };

  let authenticatedUser = null;
  let profileRequestId = 0;

  let activeId = null;
  let currentView = "chat";
  let busy = false;
  let vaultFilter = "All";
  let toastTimer;
  let requestController = null;

  const CREATOR_USERNAME = "LT.W31RD";

  const CREATOR_REPLY =
    "VYTRON AI was created by **Jonas Isaac, known as LT.W31RD**. He is the creator behind this independent AI workspace.";

  // --------------------------------------------------
  // STORAGE AND UTILITIES
  // --------------------------------------------------

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save VYTRON data.", error);
    }
  }

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const data = JSON.parse(saved);

      state = {
        ...state,
        ...data,
        sessions: Array.isArray(data.sessions)
          ? data.sessions
          : [],
        projects: Array.isArray(data.projects)
          ? data.projects
          : [],
        logs: Array.isArray(data.logs)
          ? data.logs
          : [],
        settings: {
          ...DEFAULT_SETTINGS,
          ...(data.settings || {})
        },
        stats: {
          msgs: 0,
          code: 0,
          latencies: [],
          ...(data.stats || {}),
          latencies: Array.isArray(data.stats?.latencies)
            ? data.stats.latencies
            : [],
          topics: {
            ...DEFAULT_TOPICS,
            ...(data.stats?.topics || {})
          }
        }
      };

      state.sessions = state.sessions.filter(session =>
        session &&
        typeof session.id === "string" &&
        Array.isArray(session.messages)
      );

      state.sessions.forEach(session => {
        session.messages = session.messages.filter(message =>
          message &&
          ["user", "bot", "model"].includes(message.role) &&
          typeof message.text === "string"
        );

        session.title =
          typeof session.title === "string"
            ? session.title
            : "New conversation";
      });
    } catch (error) {
      console.warn("Could not load saved data.", error);
    }
  }

  function uid(prefix = "id") {
    return prefix + "_" + Math.random().toString(36).slice(2, 10);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function activeSession() {
    return state.sessions.find(session => session.id === activeId) || null;
  }

  function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 2800);
  }

  function log(message, type = "info") {
    state.logs.push({
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      }),
      message,
      type
    });

    state.logs = state.logs.slice(-40);
    save();

    if (currentView === "dashboard") renderLog();
  }

  // --------------------------------------------------
  // AUTHENTICATED IDENTITY
  // --------------------------------------------------

  function getAuthenticatedUsername() {
    if (!authenticatedUser) return "";

    return String(
      authenticatedUser.username ||
      authenticatedUser.name ||
      ""
    ).trim();
  }

  function isCreatorAccount() {
    if (!authenticatedUser) return false;

    const role = String(authenticatedUser.role || "").toLowerCase();
    const username = getAuthenticatedUsername().toLowerCase();

    // The server's authenticated role is authoritative.
    return role === "creator" || role === "admin";
  }

  function getDisplayUsername() {
    if (authenticatedUser) {
      return getAuthenticatedUsername() || CREATOR_USERNAME;
    }

    return state.settings.name.trim() || "";
  }

  function initials() {
    const name = getDisplayUsername() || CREATOR_USERNAME;

    return name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join("")
      .toUpperCase();
  }

  function applyIdentity() {
    const chip = $("userChip");
    const profileName = $("profileName");

    const username = getDisplayUsername();
    const authenticated = Boolean(authenticatedUser);
    const creator = isCreatorAccount();

    if (chip) {
      chip.textContent = initials();
      chip.title = username || "Guest";
      chip.setAttribute("aria-label", username || "Guest");
    }

    if (!profileName) return;

    profileName.textContent = authenticated
      ? username
      : state.settings.name.trim() || "Guest creator";

    // Create the account-role badge without requiring an HTML edit.
    let badge = $("profileRoleBadge");

    if (!badge) {
      badge = document.createElement("span");
      badge.id = "profileRoleBadge";
      badge.className = "profile-role-badge";

      Object.assign(badge.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginLeft: "8px",
        padding: "3px 7px",
        borderRadius: "6px",
        fontSize: "9px",
        fontWeight: "800",
        letterSpacing: "1px",
        verticalAlign: "middle",
        lineHeight: "1.4"
      });

      profileName.insertAdjacentElement("afterend", badge);
    }

    if (!authenticated) {
      badge.textContent = "GUEST";
      badge.style.color = "#a8a8b8";
      badge.style.background = "rgba(150,150,170,.12)";
      badge.title = "You are not signed in";
    } else if (creator) {
      badge.textContent = "ADMIN";
      badge.style.color = "#b8aaff";
      badge.style.background = "rgba(139,123,255,.16)";
      badge.title = "Authenticated creator account";
    } else {
      badge.textContent = "USER";
      badge.style.color = "#58dfc8";
      badge.style.background = "rgba(66,228,209,.12)";
      badge.title = "Authenticated user account";
    }

    // Keep profile name separate from the saved display-name preference.
    const nameInput = $("setName");

    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = state.settings.name;
    }
  }

  async function loadAuthenticatedUser() {
    const requestId = ++profileRequestId;

    try {
      const response = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        },
        cache: "no-store"
      });

      const data = await response.json().catch(() => ({}));

      // Ignore stale responses if another profile request has started.
      if (requestId !== profileRequestId) return;

      if (
        !response.ok ||
        data.authenticated !== true ||
        !data.user ||
        typeof data.user !== "object"
      ) {
        authenticatedUser = null;
        applyIdentity();
        renderMessages();
        return;
      }

      authenticatedUser = data.user;

      applyIdentity();
      renderMessages();

      log("Authenticated profile loaded", "success");
    } catch (error) {
      if (requestId !== profileRequestId) return;

      console.warn("Could not load the authenticated profile:", error);

      authenticatedUser = null;
      applyIdentity();
      renderMessages();
    }
  }

  // Refresh the profile when the user returns to this browser tab.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadAuthenticatedUser();
  });

  // --------------------------------------------------
  // NAVIGATION
  // --------------------------------------------------

  function setView(name) {
    currentView = name;

    document.querySelectorAll(".view").forEach(view => {
      view.classList.toggle("active", view.id === "view-" + name);
    });

    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.view === name);
    });

    const titles = {
      chat: "AI Chat",
      dashboard: "Insights",
      vault: "Prompt studio",
      projects: "Projects",
      settings: "Preferences"
    };

    $("viewTitle").textContent = titles[name] || "AI Chat";
    closeMenu();

    if (name === "dashboard") renderDashboard();
    if (name === "vault") renderVault();
    if (name === "projects") renderProjects();

    if (name === "chat") {
      setTimeout(() => $("userInput")?.focus(), 50);
    }
  }

  function openMenu() {
    $("sidebar").classList.add("open");
    $("scrim").classList.add("open");
  }

  function closeMenu() {
    $("sidebar").classList.remove("open");
    $("scrim").classList.remove("open");
  }

  // --------------------------------------------------
  // MESSAGE FORMATTING
  // --------------------------------------------------

  function inline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function renderText(text) {
    let output = "";
    let paragraphs = [];
    let list = [];

    function flushParagraph() {
      if (!paragraphs.length) return;

      output += "<p>" +
        inline(paragraphs.join("\n")).replace(/\n/g, "<br>") +
        "</p>";

      paragraphs = [];
    }

    function flushList() {
      if (!list.length) return;

      output += "<ul>" +
        list.map(item => "<li>" + inline(item) + "</li>").join("") +
        "</ul>";

      list = [];
    }

    String(text).split("\n").forEach(line => {
      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }

      if (/^\s*[-*] /.test(line)) {
        flushParagraph();
        list.push(line.replace(/^\s*[-*] /, ""));
        return;
      }

      flushList();
      paragraphs.push(line);
    });

    flushParagraph();
    flushList();

    return output;
  }

  function codeBlock(language, code) {
    return `
      <div class="code-block">
        <div class="code-head">
          <span>${esc(language || "code")}</span>
          <button class="copy-btn" type="button">Copy code</button>
        </div>
        <pre><code>${esc(code)}</code></pre>
      </div>
    `;
  }

  function renderMarkdown(source) {
    const parts = String(source).split(/```/);
    let output = "";

    parts.forEach((part, index) => {
      if (index % 2) {
        const newline = part.indexOf("\n");

        const language = newline >= 0
          ? part.slice(0, newline).trim()
          : "code";

        const code = newline >= 0
          ? part.slice(newline + 1).replace(/\n$/, "")
          : part;

        output += codeBlock(language, code);
      } else {
        output += renderText(part);
      }
    });

    return output;
  }

  function createMessageElement(role, text) {
    const element = document.createElement("div");

    element.className =
      "msg " + (role === "user" ? "user" : "bot");

    const displayName = getDisplayUsername();

    const label = role === "user"
      ? (displayName || "YOU").toUpperCase()
      : "VYTRON AI";

    const avatar = role === "user" ? initials() : "V";

    element.innerHTML = `
      <div class="msg-avatar">${esc(avatar)}</div>
      <div class="msg-body">
        <div class="msg-name">${esc(label)}</div>
        <div class="bubble">${renderMarkdown(text)}</div>
      </div>
    `;

    return element;
  }

  function scrollChat() {
    const chatScroll = $("chatScroll");
    if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function renderMessages() {
    const box = $("messages");
    const welcome = $("welcome");
    const session = activeSession();

    if (!box || !welcome) return;

    const hasMessages = Boolean(session && session.messages.length);

    welcome.classList.toggle("hidden", hasMessages);
    box.innerHTML = "";

    if (hasMessages) {
      session.messages.forEach(message => {
        box.appendChild(
          createMessageElement(message.role, message.text)
        );
      });
    }

    scrollChat();
  }

  // --------------------------------------------------
  // CONVERSATION HISTORY
  // --------------------------------------------------

  function renderHistory() {
    const wrap = $("historyList");
    const search = $("historySearch");

    if (!wrap || !search) return;

    const query = search.value.trim().toLowerCase();

    wrap.innerHTML = "";

    const sessions = state.sessions.slice().reverse().filter(session =>
      session.title.toLowerCase().includes(query) ||
      session.messages.some(message =>
        message.text.toLowerCase().includes(query)
      )
    );

    if (!sessions.length) {
      wrap.innerHTML = `
        <div class="empty-hint">
          ${query ? "No matching conversations" : "Your conversations will appear here."}
        </div>`;
      return;
    }

    sessions.forEach(session => {
      const row = document.createElement("div");

      row.className = "history-item" +
        (session.id === activeId ? " active" : "");

      row.innerHTML = `
        <span class="history-title" title="${esc(session.title)}">
          ${esc(session.title)}
        </span>
        <button class="del" type="button" title="Delete conversation">×</button>
      `;

      row.addEventListener("click", event => {
        if (event.target.closest(".del")) {
          state.sessions = state.sessions.filter(
            item => item.id !== session.id
          );

          if (activeId === session.id) activeId = null;

          save();
          renderHistory();
          renderMessages();
          return;
        }

        if (busy) {
          toast("Wait for the current reply to finish before switching chats.");
          return;
        }

        activeId = session.id;

        renderHistory();
        renderMessages();
        setView("chat");
      });

      wrap.appendChild(row);
    });
  }

  // --------------------------------------------------
  // INTELLIGENCE ENGINE
  // --------------------------------------------------

  function classify(text) {
    const value = text.toLowerCase();

    if (/html|css|javascript|react|code|program|debug|api|website|node\.?js|python/.test(value)) {
      return "Code";
    }

    if (/write|email|story|caption|essay|pitch|copy/.test(value)) {
      return "Writing";
    }

    if (/plan|startup|business|project|launch|build/.test(value)) {
      return "Build";
    }

    if (/compare|decision|choose|strategy|pros and cons/.test(value)) {
      return "Thinking";
    }

    if (/learn|explain|teach|understand|meaning/.test(value)) {
      return "Learning";
    }

    return "General";
  }

  function isCreatorQuestion(text) {
    return /\b(who (made|created|built|developed|designed) you|who is behind you|who is your creator|who is your founder|creator of vytron|who is jonas isaac|lt\.w31rd)\b/i.test(text);
  }

  function offlineReply(text) {
    const value = text.toLowerCase();
    const topic = classify(text);

    if (isCreatorQuestion(text)) return CREATOR_REPLY;

    if (/^(hi|hello|hey|yo)\b|good morning|good evening/i.test(value)) {
      const name = getDisplayUsername();

      return `Hey${name ? " " + name : ""}! Welcome to **VYTRON AI**. I'm currently in offline mode, but we can still work through supported tasks. What are you building today?`;
    }

    if (/who are you|what can you do/.test(value)) {
      return "I'm **VYTRON AI**, an AI workspace created by Jonas Isaac, known as LT.W31RD. I help with coding, planning, writing and learning. A connected AI service is needed for full open-ended intelligence.";
    }

    if (/what time is it|current time/.test(value)) {
      return "Your device's current time is **" +
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        }) + "**.";
    }

    if (/what date|today's date|current date/.test(value)) {
      return "Your device's current date is **" +
        new Date().toLocaleDateString([], {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        }) + "**.";
    }

    if (/thank|appreciate it/.test(value)) {
      return "You're welcome! Keep building. Strong products come from solving real problems, testing ideas and improving consistently.";
    }

    if (/^(what is|define|meaning of) /.test(value)) {
      return "I'm currently offline, so I can't reliably research that topic. Connect the AI service for a more complete explanation.";
    }

    const replies = {
      Code: "Let's debug this systematically.\n\n- **Expected:** What should the code do?\n- **Actual:** What happens instead?\n- **Evidence:** Check the exact error and the browser or terminal console.\n- **Isolation:** Test the smallest section that reproduces the issue.\n\nI'm offline right now, so this is general guidance rather than an AI-generated analysis of your specific code.",

      Build: "Let's make the idea practical.\n\n- Define the problem.\n- Identify the people experiencing it.\n- Choose the three most important features.\n- Build a small working version.\n- Test it with real users.\n\nI'm offline right now, so connect the AI service for a tailored plan.",

      Writing: "A strong draft needs a clear audience, purpose and tone. Start with the main point, explain the value, remove unnecessary words and finish with a clear next step.\n\nI'm offline right now. Connect the AI service to generate a complete draft for your specific request.",

      Thinking: "A useful decision framework is to compare each option by impact, cost, time, risk and reversibility. Give the most important criteria more weight, then test your assumptions.\n\nI'm offline right now, so I can't evaluate your specific options yet.",

      Learning: "Try this learning loop: understand the core idea, see one example, practise it yourself, check the result and explain it in your own words.\n\nI'm offline right now. Connect the AI service for a deeper explanation tailored to your question.",

      General: "I'm currently in **offline mode**. Your workspace and saved conversations still work, but full AI responses require a connection to the VYTRON AI backend."
    };

    return replies[topic] || replies.General;
  }

  function buildHistoryForApi(messages) {
    return messages
      .filter(message =>
        message &&
        ["user", "bot", "model"].includes(message.role) &&
        typeof message.text === "string" &&
        message.text.trim()
      )
      .slice(-MAX_HISTORY_MESSAGES)
      .map(message => ({
        role: message.role === "user" ? "user" : "model",
        text: message.text
      }));
  }

  async function buildReply(text, history = []) {
    if (isCreatorQuestion(text)) {
      return {
        text: CREATOR_REPLY,
        topic: "General",
        mode: "local"
      };
    }

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          message: text,
          history: buildHistoryForApi(history),
          style: state.settings.style,
          userName: getDisplayUsername() || "User"
        }),
        signal: requestController?.signal
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || `AI service returned HTTP ${response.status}.`
        );
      }

      const reply = typeof data.reply === "string"
        ? data.reply.trim()
        : "";

      if (!reply) {
        throw new Error("The AI service returned an empty reply.");
      }

      return {
        text: reply,
        topic: classify(text),
        mode: "ai"
      };
    } catch (error) {
      console.warn("VYTRON AI backend unavailable:", error);

      const message = error.name === "AbortError"
        ? "The request was cancelled."
        : error.message || "Could not connect to VYTRON AI.";

      return {
        text: `**VYTRON couldn't reach its AI service.**\n\n${message}\n\nPlease check that your server is running and try again.`,
        topic: classify(text),
        mode: "error"
      };
    }
  }

  // --------------------------------------------------
  // SEND A MESSAGE
  // --------------------------------------------------

  async function sendMessage(raw) {
    const text = String(raw || "").trim();

    if (!text || busy) return;

    if (text.length > MAX_MESSAGE_LENGTH) {
      toast(`Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }

    let session = activeSession();

    if (!session) {
      session = {
        id: uid("chat"),
        title: text.length > 34 ? text.slice(0, 34) + "…" : text,
        messages: [],
        createdAt: Date.now()
      };

      state.sessions.push(session);
      activeId = session.id;
    }

    const sessionId = session.id;
    const history = buildHistoryForApi(session.messages);

    session.messages.push({ role: "user", text });

    renderHistory();

    $("welcome").classList.add("hidden");
    $("messages").appendChild(createMessageElement("user", text));
    scrollChat();

    $("userInput").value = "";
    autosize();

    busy = true;
    $("sendBtn").disabled = true;

    const thinking = document.createElement("div");

    thinking.className = "msg bot";
    thinking.innerHTML = `
      <div class="msg-avatar">V</div>
      <div class="msg-body">
        <div class="msg-name">VYTRON AI</div>
        <div class="bubble">
          <span class="typing"><i></i><i></i><i></i></span>
        </div>
      </div>`;

    $("messages").appendChild(thinking);
    scrollChat();

    const started = performance.now();
    requestController = new AbortController();

    log("Message received", "info");

    try {
      const result = await buildReply(text, history);
      const elapsed = (performance.now() - started) / 1000;

      thinking.remove();

      const currentSession = state.sessions.find(
        item => item.id === sessionId
      );

      if (!currentSession) return;

      currentSession.messages.push({
        role: "bot",
        text: result.text
      });

      state.stats.msgs++;
      state.stats.latencies.push(elapsed);
      state.stats.latencies = state.stats.latencies.slice(-50);

      state.stats.code += Math.floor(
        (result.text.match(/```/g) || []).length / 2
      );

      state.stats.topics[result.topic] =
        (state.stats.topics[result.topic] || 0) + 1;

      log(
        result.mode === "ai"
          ? "AI reply completed · " + result.topic
          : result.mode === "error"
            ? "AI request failed"
            : "Local reply completed · " + result.topic,
        result.mode === "ai"
          ? "success"
          : result.mode === "error"
            ? "error"
            : "warn"
      );

      save();

      if (activeId !== sessionId) {
        renderHistory();
        return;
      }

      const message = createMessageElement("bot", "");
      $("messages").appendChild(message);

      const bubble = message.querySelector(".bubble");

      if (!state.settings.typing) {
        bubble.innerHTML = renderMarkdown(result.text);
        scrollChat();
        return;
      }

      let index = 0;
      const step = Math.max(2, Math.ceil(result.text.length / 180));

      await new Promise(resolve => {
        const timer = setInterval(() => {
          if (activeId !== sessionId) {
            clearInterval(timer);
            resolve();
            return;
          }

          index = Math.min(result.text.length, index + step);
          bubble.innerHTML = renderMarkdown(result.text.slice(0, index));
          scrollChat();

          if (index >= result.text.length) {
            clearInterval(timer);
            resolve();
          }
        }, 12);
      });
    } catch (error) {
      console.error("Message handling error:", error);

      thinking.remove();
      toast("Something went wrong. Please try again.");
      log("Message handling error", "error");
    } finally {
      requestController = null;
      finishSend();
    }
  }

  function finishSend() {
    busy = false;
    $("sendBtn").disabled = false;

    if (currentView === "chat") $("userInput").focus();

    renderHistory();

    if (currentView === "dashboard") renderDashboard();
  }

  function autosize() {
    const input = $("userInput");
    if (!input) return;

    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 150) + "px";

    $("charCount").textContent =
      input.value.length + " / " + MAX_MESSAGE_LENGTH;
  }

  // --------------------------------------------------
  // THEME AND APPEARANCE
  // --------------------------------------------------

  function hexRgba(hex, alpha) {
    const number = parseInt(hex.slice(1), 16);

    return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
  }

  function applyAccent() {
    const accent = ACCENTS[state.settings.accent] || ACCENTS[0];
    const root = document.documentElement.style;

    root.setProperty("--accent", accent.a);
    root.setProperty("--accent2", accent.b);
    root.setProperty("--accent-glow", hexRgba(accent.a, .2));

    document.querySelectorAll(".swatch").forEach((element, index) => {
      element.classList.toggle("active", index === state.settings.accent);
    });

    if (currentView === "dashboard") drawChart();
  }

  function applyTheme() {
    document.body.classList.toggle(
      "light",
      state.settings.theme === "light"
    );

    $("themeBtn").textContent =
      state.settings.theme === "light" ? "☼" : "◐";
  }

  function applyOrbs() {
    document.body.classList.toggle("no-glow", !state.settings.orbs);
  }

  function buildSwatches() {
    $("swatches").innerHTML = ACCENTS.map((accent, index) => `
      <button class="swatch" type="button" data-i="${index}"
        title="${esc(accent.name)}" aria-label="${esc(accent.name)}"
        style="background:linear-gradient(135deg,${accent.a},${accent.b})">
      </button>
    `).join("");
  }

  // --------------------------------------------------
  // DASHBOARD
  // --------------------------------------------------

  function renderDashboard() {
    $("statMsgs").textContent = state.stats.msgs;

    const times = state.stats.latencies;

    $("statLatency").textContent = times.length
      ? (times.reduce((total, value) => total + value, 0) / times.length).toFixed(1) + "s"
      : "—";

    $("statCode").textContent = Math.floor(state.stats.code);
    $("statSessions").textContent = state.sessions.length;

    renderTopics();
    renderLog();

    requestAnimationFrame(drawChart);
  }

  function renderTopics() {
    const wrap = $("topicBars");
    const entries = Object.entries(state.stats.topics);
    const max = Math.max(1, ...entries.map(item => item[1]));

    wrap.innerHTML = entries.map(([name, value]) => `
      <div class="topic-row">
        <span class="lbl">${esc(name)}</span>
        <div class="track"><div class="fill" style="width:${Math.round(value / max * 100)}%"></div></div>
        <span class="val">${value}</span>
      </div>
    `).join("");
  }

  function renderLog() {
    $("sysLog").innerHTML = state.logs.slice().reverse().map(item => `
      <div class="log-line ${esc(item.type)}">
        [${esc(item.time)}] <b>${esc(item.message)}</b>
      </div>
    `).join("") ||
      '<div class="empty-hint">Activity will appear here as you use the workspace.</div>';
  }

  function drawChart() {
    const canvas = $("activityChart");

    if (!canvas || !canvas.clientWidth) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = 220;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    const ctx = canvas.getContext("2d");

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const values = [0, 0, 0, 0, 0, 0, 0];

    state.sessions.forEach(session => {
      const offset = Math.max(0, Math.min(6, 6 - Math.floor(
        (Date.now() - (session.createdAt || Date.now())) / 86400000
      )));

      values[offset] += session.messages.filter(
        message => message.role === "user"
      ).length;
    });

    const max = Math.max(4, ...values) * 1.2;
    const padding = { left: 25, right: 12, top: 15, bottom: 28 };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const xs = values.map((_, i) =>
      padding.left + chartWidth * i / 6
    );

    const ys = values.map(value =>
      padding.top + chartHeight - value / max * chartHeight
    );

    for (let i = 0; i < 4; i++) {
      const y = padding.top + chartHeight * i / 3;

      ctx.strokeStyle = "rgba(140,150,180,.15)";
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const accent = ACCENTS[state.settings.accent] || ACCENTS[0];
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height);

    gradient.addColorStop(0, hexRgba(accent.a, .25));
    gradient.addColorStop(1, hexRgba(accent.a, 0));

    ctx.beginPath();
    ctx.moveTo(xs[0], height - padding.bottom);

    xs.forEach((x, i) => ctx.lineTo(x, ys[i]));

    ctx.lineTo(xs[6], height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();

    xs.forEach((x, i) =>
      i === 0 ? ctx.moveTo(x, ys[i]) : ctx.lineTo(x, ys[i])
    );

    ctx.strokeStyle = accent.a;
    ctx.lineWidth = 2;
    ctx.stroke();

    xs.forEach((x, i) => {
      ctx.beginPath();
      ctx.arc(x, ys[i], 3, 0, Math.PI * 2);
      ctx.fillStyle = accent.b;
      ctx.fill();
    });
  }

  // --------------------------------------------------
  // PROMPT STUDIO
  // --------------------------------------------------

  function renderVault() {
    const categories = ["All", ...new Set(VAULT.map(item => item.cat))];

    $("vaultFilters").innerHTML = categories.map(category => `
      <button class="filter-btn ${category === vaultFilter ? "active" : ""}"
        data-cat="${esc(category)}" type="button">${esc(category)}</button>
    `).join("");

    const items = VAULT.filter(item =>
      vaultFilter === "All" || item.cat === vaultFilter
    );

    $("vaultCount").textContent = items.length + " PROMPTS";

    $("vaultGrid").innerHTML = items.map(item => `
      <button class="vault-card" type="button" data-title="${esc(item.title)}">
        <span class="vault-symbol">${esc(item.icon)}</span>
        <div class="vault-cat">${esc(item.cat.toUpperCase())}</div>
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.desc)}</p>
      </button>
    `).join("");
  }

  // --------------------------------------------------
  // PROJECTS
  // --------------------------------------------------

  function renderProjects() {
    $("projectGrid").innerHTML = state.projects.map(project => `
      <article class="project-card">
        <div class="project-card-top">
          <span class="project-card-icon">▣</span>
          <button class="project-delete" data-id="${esc(project.id)}"
            title="Delete project">×</button>
        </div>
        <h3>${esc(project.name)}</h3>
        <p>${esc(project.desc || "No description added yet.")}</p>
        <small>CREATED ${new Date(project.createdAt).toLocaleDateString()}</small>
      </article>
    `).join("") || `
      <article class="surface-card">
        <div class="empty-hint">No projects yet. Create one above to give your next idea a home.</div>
      </article>`;
  }

  // --------------------------------------------------
  // EXPORT AND SETTINGS
  // --------------------------------------------------

  function exportConversation() {
    const session = activeSession();

    if (!session) {
      toast("Start a conversation before exporting.");
      return;
    }

    const content = "# " + session.title + "\n\n" +
      session.messages.map(message =>
        "## " + (message.role === "user"
          ? (getDisplayUsername() || "You")
          : "VYTRON AI") +
        "\n\n" + message.text
      ).join("\n\n---\n\n");

    const blob = new Blob([content], {
      type: "text/markdown;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "vytron-conversation.md";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast("Conversation exported.");
  }

  function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS };

    $("setName").value = "";
    $("setStyle").value = "balanced";
    $("setTyping").checked = true;
    $("setOrbs").checked = true;

    applyAccent();
    applyTheme();
    applyOrbs();
    applyIdentity();

    save();

    toast("Preferences reset.");
  }

  // --------------------------------------------------
  // EVENTS
  // --------------------------------------------------

  function bindEvents() {
    $("sendBtn").addEventListener("click", () =>
      sendMessage($("userInput").value)
    );

    // LOGOUT
const logoutBtn = $("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to log out?")) return;

    logoutBtn.disabled = true;
    logoutBtn.querySelector("span:last-child").textContent = "Logging out...";

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        }
      });
    } catch (error) {
      console.warn("Logout request failed:", error);
    }

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.clear();

    window.location.href = "auth.html";
  });
}

    $("userInput").addEventListener("input", autosize);

    $("userInput").addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage($("userInput").value);
      }
    });

    document.querySelectorAll(".nav-item").forEach(button => {
      button.addEventListener("click", () =>
        setView(button.dataset.view)
      );
    });

    $("menuBtn").addEventListener("click", openMenu);
    $("scrim").addEventListener("click", closeMenu);

    $("newChatBtn").addEventListener("click", () => {
      if (busy) {
        toast("Wait for the current reply to finish.");
        return;
      }

      activeId = null;

      renderHistory();
      renderMessages();
      setView("chat");
    });

    $("messages").addEventListener("click", async event => {
      const button = event.target.closest(".copy-btn");

      if (!button) return;

      const code = button.closest(".code-block")
        .querySelector("pre").textContent;

      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "Copied!";
      } catch {
        toast("Clipboard access failed. Select and copy the code manually.");
        return;
      }

      setTimeout(() => button.textContent = "Copy code", 1300);
    });

    $("starterChips").innerHTML = STARTERS.map(item => `
      <button class="starter-card" type="button" data-prompt="${esc(item.prompt)}">
        <span class="starter-icon">${esc(item.icon)}</span>
        <span><strong>${esc(item.title)}</strong><small>${esc(item.desc)}</small></span>
      </button>
    `).join("");

    $("starterChips").addEventListener("click", event => {
      const button = event.target.closest(".starter-card");

      if (button) sendMessage(button.dataset.prompt);
    });

    $("vaultFilters").addEventListener("click", event => {
      const button = event.target.closest(".filter-btn");

      if (!button) return;

      vaultFilter = button.dataset.cat;
      renderVault();
    });

    $("vaultGrid").addEventListener("click", event => {
      const button = event.target.closest(".vault-card");

      if (!button) return;

      const item = VAULT.find(
        prompt => prompt.title === button.dataset.title
      );

      if (!item) return;

      if (busy) {
        toast("Wait for the current reply to finish.");
        return;
      }

      setView("chat");
      sendMessage(item.prompt);
    });

    $("historySearch").addEventListener("input", renderHistory);

    $("clearSearch").addEventListener("click", () => {
      $("historySearch").value = "";
      renderHistory();
    });

    $("setName").addEventListener("input", event => {
      state.settings.name = event.target.value.slice(0, 28);

      // This changes the local display preference, not the account username.
      applyIdentity();
      save();
    });

    $("setStyle").addEventListener("change", event => {
      state.settings.style = event.target.value;
      save();

      toast("Response style updated.");
    });

    $("swatches").addEventListener("click", event => {
      const button = event.target.closest(".swatch");

      if (!button) return;

      state.settings.accent = Number(button.dataset.i);

      applyAccent();
      save();

      toast("Accent updated.");
    });

    $("setTyping").addEventListener("change", event => {
      state.settings.typing = event.target.checked;
      save();
    });

    $("setOrbs").addEventListener("change", event => {
      state.settings.orbs = event.target.checked;

      applyOrbs();
      save();
    });

    $("themeBtn").addEventListener("click", () => {
      state.settings.theme =
        state.settings.theme === "dark" ? "light" : "dark";

      applyTheme();
      save();
    });

    $("exportBtn").addEventListener("click", exportConversation);

    $("profileSettings").addEventListener("click", () =>
      setView("settings")
    );

    $("clearAllBtn").addEventListener("click", () => {
      if (!state.sessions.length) {
        toast("There are no conversations to delete.");
        return;
      }

      if (!confirm("Delete every saved conversation in this browser?")) return;

      state.sessions = [];
      activeId = null;

      save();
      renderHistory();
      renderMessages();

      log("All conversations deleted", "warn");
      toast("Conversations deleted.");
    });

    $("resetSettingsBtn").addEventListener("click", resetSettings);

    $("createProjectBtn").addEventListener("click", () => {
      const name = $("projectName").value.trim();
      const desc = $("projectDesc").value.trim();

      if (!name) {
        toast("Give your project a name first.");
        $("projectName").focus();
        return;
      }

      state.projects.unshift({
        id: uid("project"),
        name,
        desc,
        createdAt: Date.now()
      });

      $("projectName").value = "";
      $("projectDesc").value = "";

      save();
      renderProjects();

      toast("Project created.");
    });

    $("projectGrid").addEventListener("click", event => {
      const button = event.target.closest(".project-delete");

      if (!button) return;

      state.projects = state.projects.filter(
        project => project.id !== button.dataset.id
      );

      save();
      renderProjects();

      toast("Project deleted.");
    });

    window.addEventListener("resize", () => {
      if (currentView === "dashboard") drawChart();
    });

    document.addEventListener("keydown", event => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();

        if (busy) return;

        activeId = null;

        renderHistory();
        renderMessages();
        setView("chat");
      }

      if (event.key === "Escape") closeMenu();
    });
  }

  // --------------------------------------------------
  // START APPLICATION
  // --------------------------------------------------

  function init() {
    load();
    buildSwatches();

    $("setName").value = state.settings.name;
    $("setStyle").value = state.settings.style;
    $("setTyping").checked = state.settings.typing;
    $("setOrbs").checked = state.settings.orbs;

    applyAccent();
    applyTheme();
    applyOrbs();
    applyIdentity();

    bindEvents();

    renderHistory();
    renderMessages();
    renderVault();
    renderProjects();

    log("VYTRON workspace initialized");
    log("Conversation history is enabled in the frontend");

    // Fetch the actual logged-in account from the backend.
    loadAuthenticatedUser();
  }

  init();
})();



