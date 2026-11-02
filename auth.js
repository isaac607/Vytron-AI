"use strict";

const views = {
  login: document.getElementById("loginView"),
  signup: document.getElementById("signupView"),
  verify: document.getElementById("verifyView")
};

const messageBox = document.getElementById("authMessage");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const verifyForm = document.getElementById("verifyForm");
const resendButton = document.getElementById("resendCodeButton");
const verificationEmail = document.getElementById("verificationEmail");

let pendingEmail = "";
let busy = false;

document.getElementById("currentYear").textContent =
  String(new Date().getFullYear());

function showMessage(message, type = "error") {
  messageBox.textContent = message;
  messageBox.className = `message ${type}`;
  messageBox.hidden = false;
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
  messageBox.hidden = true;
}

function showView(name) {
  if (!views[name]) return;

  Object.entries(views).forEach(([viewName, element]) => {
    const active = viewName === name;
    element.hidden = !active;
    element.classList.toggle("active", active);
  });

  clearMessage();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    showView(button.dataset.view);
  });
});

document.querySelectorAll("[data-toggle]").forEach(button => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.toggle);
    if (!input) return;

    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.textContent = reveal ? "Hide" : "Show";
    button.setAttribute(
      "aria-label",
      reveal ? "Hide password" : "Show password"
    );
  });
});

function setBusy(form, isBusy, busyLabel = "Please wait...") {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;

  if (isBusy) {
    button.dataset.originalText =
      button.querySelector("span")?.textContent || "Continue";

    const label = button.querySelector("span");
    if (label) label.textContent = busyLabel;
  } else {
    const label = button.querySelector("span");

    if (label && button.dataset.originalText) {
      label.textContent = button.dataset.originalText;
    }

    delete button.dataset.originalText;
  }

  button.disabled = isBusy;
}

async function apiRequest(endpoint, options = {}) {
  let response;

  try {
    response = await fetch(endpoint, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error(
      "Cannot connect to VYTRON's server. Make sure the server is running and try again."
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unexpected response.");
  }

  if (!response.ok) {
    const error = new Error(
      data.error || "Something went wrong. Please try again."
    );

    error.status = response.status;
    error.code = data.code;
    throw error;
  }

  return data;
}

function friendlyError(error) {
  if (error.status === 404) {
    return "The authentication server routes aren't installed yet. We'll connect them in the next step.";
  }

  if (error.status === 429) {
    return "Too many attempts. Please wait a little before trying again.";
  }

  return error.message || "Something went wrong. Please try again.";
}

function isGmailAddress(email) {
  return /^[^\s@]+@gmail\.com$/i.test(email);
}

function normaliseEmail(email) {
  return email.trim().toLowerCase();
}

function setPendingEmail(email) {
  pendingEmail = normaliseEmail(email);
  verificationEmail.textContent = pendingEmail;

  // Keep only the pending email between screen changes.
  // Passwords and session tokens are never stored here.
  try {
    sessionStorage.setItem("vytronPendingEmail", pendingEmail);
  } catch {
    // The email can still be used for this page session.
  }
}

function getPendingEmail() {
  if (pendingEmail) return pendingEmail;

  try {
    pendingEmail = sessionStorage.getItem("vytronPendingEmail") || "";
  } catch {
    pendingEmail = "";
  }

  return pendingEmail;
}

function clearPendingEmail() {
  pendingEmail = "";

  try {
    sessionStorage.removeItem("vytronPendingEmail");
  } catch {
    // Nothing else is required.
  }
}

async function enterWorkspace() {
  // The server must confirm the session before access is granted.
  const data = await apiRequest("/api/auth/me", {
    method: "GET",
    headers: {}
  });

  if (!data.authenticated) {
    throw new Error("Please sign in to continue.");
  }

  window.location.replace("/");
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (busy) return;

  clearMessage();

  const formData = new FormData(loginForm);
  const identity = String(formData.get("identity") || "").trim();
  const password = String(formData.get("password") || "");

  if (!identity || !password) {
    showMessage("Enter your username or email and your password.");
    return;
  }

  busy = true;
  setBusy(loginForm, true, "Signing in...");

  try {
    await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identity, password })
    });

    showMessage("Sign-in successful. Opening VYTRON AI...", "success");
    await enterWorkspace();
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    busy = false;
    setBusy(loginForm, false);
  }
});

signupForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (busy) return;

  clearMessage();

  const formData = new FormData(signupForm);

  const name = String(formData.get("name") || "").trim();
  const email = normaliseEmail(
    String(formData.get("email") || "")
  );
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (name.length < 2) {
    showMessage("Please enter your full name.");
    return;
  }

  if (!isGmailAddress(email)) {
    showMessage("Please enter a valid Gmail address ending in @gmail.com.");
    return;
  }

  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    showMessage(
      "Your username must be 3–24 characters and contain only letters, numbers, or underscores."
    );
    return;
  }

  if (password.length < 12) {
    showMessage("Use a password with at least 12 characters.");
    return;
  }

  busy = true;
  setBusy(signupForm, true, "Creating account...");

  try {
    const result = await apiRequest("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        username,
        password
      })
    });

    setPendingEmail(email);
    showView("verify");

    showMessage(
      result.message || "Your account was created. Check your inbox for the verification code.",
      "success"
    );

    document.getElementById("verificationCode").focus();
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    busy = false;
    setBusy(signupForm, false);
  }
});

verifyForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (busy) return;

  clearMessage();

  const email = getPendingEmail();
  const code = String(
    new FormData(verifyForm).get("code") || ""
  ).trim();

  if (!email) {
    showMessage("Please return to sign in and create your account again.");
    showView("signup");
    return;
  }

  if (!/^[0-9]{6}$/.test(code)) {
    showMessage("Enter the six-digit code from your email.");
    return;
  }

  busy = true;
  setBusy(verifyForm, true, "Verifying...");

  try {
    await apiRequest("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code })
    });

    clearPendingEmail();
    verifyForm.reset();
    loginForm.elements.identity.value = email;

    showView("login");
    showMessage(
      "Your email is verified! You can now sign in.",
      "success"
    );
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    busy = false;
    setBusy(verifyForm, false);
  }
});

resendButton.addEventListener("click", async () => {
  if (busy) return;

  clearMessage();

  const email = getPendingEmail();

  if (!email) {
    showMessage("Please create an account first.");
    showView("signup");
    return;
  }

  busy = true;
  resendButton.disabled = true;
  resendButton.textContent = "Sending code...";

  try {
    const result = await apiRequest("/api/auth/resend-code", {
      method: "POST",
      body: JSON.stringify({ email })
    });

    showMessage(
      result.message || "If the account can receive a new code, it will be sent shortly.",
      "success"
    );
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    busy = false;
    resendButton.disabled = false;
    resendButton.textContent = "Resend verification code";
  }
});

// If a valid session already exists, go straight to the workspace.
(async function checkExistingSession() {
  try {
    const result = await apiRequest("/api/auth/me", {
      method: "GET",
      headers: {}
    });

    if (result.authenticated) {
      window.location.replace("/");
      return;
    }
  } catch {
    // Authentication routes will be installed in the next server update.
  }

  const savedEmail = getPendingEmail();

  if (savedEmail) {
    verificationEmail.textContent = savedEmail;
  }
})();