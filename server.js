import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  randomBytes,
  createHash,
  randomInt
} from "node:crypto";

import { GoogleGenAI } from "@google/genai";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const emailTransporter =
  process.env.BREVO_SMTP_HOST &&
  process.env.BREVO_SMTP_USER &&
  process.env.BREVO_SMTP_KEY &&
  process.env.BREVO_SENDER_EMAIL
    ? nodemailer.createTransport({
        host: process.env.BREVO_SMTP_HOST,
        port: Number(process.env.BREVO_SMTP_PORT || 587),
        secure: Number(process.env.BREVO_SMTP_PORT || 587) === 465,
        auth: {
          user: process.env.BREVO_SMTP_USER,
          pass: process.env.BREVO_SMTP_KEY
        }
      })
    : null;

const AI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const MAX_CONCURRENT_REQUESTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_SIZE = 100_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 20_000;
const MAX_HISTORY_TEXT_LENGTH = 6_000;
const SESSION_DAYS = 30;
const VERIFICATION_MINUTES = 15;
const MAX_VERIFICATION_ATTEMPTS = 5;

const MASTER_USERNAME = process.env.MASTER_USERNAME || "LT.W31RD";
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || "";

const isProduction = process.env.NODE_ENV === "production";

const COOKIE_NAME = isProduction
  ? "__Host-vytron_session"
  : "vytron_session";

let activeRequests = 0;
// ======================================================
// LOGIN RATE LIMITING
// ======================================================

// ======================================================
// PERSISTENT LOGIN RATE LIMITING
// ======================================================

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;

function getLoginKey(req, identity) {
  const ip = req.socket.remoteAddress || "unknown";
  return sha256(`${ip}:${identity.toLowerCase()}`);
}

function isLoginBlocked(key) {
  const record = db.prepare(`
    SELECT attempt_count, reset_at
    FROM login_attempts
    WHERE login_key = ?
  `).get(key);

  if (!record) return false;

  if (Date.now() >= record.reset_at) {
    db.prepare(`
      DELETE FROM login_attempts
      WHERE login_key = ?
    `).run(key);

    return false;
  }

  return record.attempt_count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(key) {
  const now = Date.now();

  const record = db.prepare(`
    SELECT attempt_count, reset_at
    FROM login_attempts
    WHERE login_key = ?
  `).get(key);

  if (!record || now >= record.reset_at) {
    db.prepare(`
      INSERT INTO login_attempts (
        login_key,
        attempt_count,
        reset_at
      )
      VALUES (?, 1, ?)
      ON CONFLICT(login_key)
      DO UPDATE SET
        attempt_count = 1,
        reset_at = excluded.reset_at
    `).run(key, now + LOGIN_WINDOW_MS);

    return;
  }

  db.prepare(`
    UPDATE login_attempts
    SET attempt_count = attempt_count + 1
    WHERE login_key = ?
  `).run(key);
}

function clearLoginAttempts(key) {
  db.prepare(`
    DELETE FROM login_attempts
    WHERE login_key = ?
  `).run(key);
}

const db = new Database(path.join(__dirname, "users.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ======================================================
// DATABASE
// ======================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    verification_hash TEXT,
    verification_expires_at TEXT,
    verification_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON sessions(expires_at);

  CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

    CREATE TABLE IF NOT EXISTS login_attempts (
    login_key TEXT PRIMARY KEY,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL
  );
`);

// ======================================================
// ADMIN DATABASE MIGRATIONS
// ======================================================

const existingUserColumns = db
  .prepare("PRAGMA table_info(users)")
  .all()
  .map(column => column.name);

if (!existingUserColumns.includes("role")) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

if (!existingUserColumns.includes("status")) {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
}

if (!existingUserColumns.includes("updated_at")) {
  db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_username TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_username TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON admin_audit_logs(created_at);
`);

db.prepare(`
  DELETE FROM sessions
  WHERE expires_at <= ?
`).run(new Date().toISOString());

db.prepare(`
  DELETE FROM login_attempts
  WHERE reset_at <= ?
`).run(Date.now());

// ======================================================
// MIME TYPES
// ======================================================

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8"
};

// ======================================================
// HTTP HELPERS
// ======================================================

function sendJson(res, status, data, extraHeaders = {}) {
  if (res.headersSent || res.destroyed || res.writableEnded) {
    return;
  }

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });

  res.end(JSON.stringify(data));
}

function sendError(res, status, message, extra = {}) {
  return sendJson(res, status, {
    error: message,
    ...extra
  });
}

function redirect(res, location) {
  if (res.headersSent || res.destroyed) return;

  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store"
  });

  res.end();
}

async function readRequestBody(req) {
  let body = "";
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_BODY_SIZE) {
      const error = new Error("Request body is too large.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }

    body += chunk.toString("utf8");
  }

  try {
    const parsed = JSON.parse(body || "{}");

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      const error = new Error("Request body must be a JSON object.");
      error.code = "INVALID_JSON";
      throw error;
    }

    return parsed;
  } catch (error) {
    if (error.code === "INVALID_JSON") throw error;

    const invalidError = new Error("Invalid JSON.");
    invalidError.code = "INVALID_JSON";
    throw invalidError;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeSessionToken() {
  return randomBytes(32).toString("base64url");
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch {
        return "";
      }
    }
  }

  return "";
}

function cookieHeader(token, maxAge) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];

  if (isProduction) parts.push("Secure");

  return parts.join("; ");
}

function clearSessionCookie() {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (isProduction) parts.push("Secure");

  return parts.join("; ");
}

function isValidGmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@gmail\.com$/i.test(email)
  );
}

function validUsername(username) {
  return /^[A-Za-z0-9_]{3,24}$/.test(username);
}

function makeVerificationCode() {
  return String(randomInt(100000, 1000000));
}

// ======================================================
// SESSION MANAGEMENT
// ======================================================

function createSession(res, user) {
  const token = makeSessionToken();

  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  db.prepare(`
    INSERT INTO sessions
      (token_hash, user_id, username, name, email, role, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sha256(token),
    user.id ?? null,
    user.username,
    user.name,
    user.email || null,
    user.role || "user",
    expiresAt
  );

  res.setHeader(
    "Set-Cookie",
    cookieHeader(token, SESSION_DAYS * 24 * 60 * 60)
  );
}

function getCurrentSession(req) {
  const token = getCookie(req, COOKIE_NAME);
  if (!token || token.length > 200) return null;

  const session = db.prepare(`
    SELECT id, user_id, username, name, email, role, expires_at
    FROM sessions
    WHERE token_hash = ?
  `).get(sha256(token));

  if (!session) return null;

  if (session.expires_at <= new Date().toISOString()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    return null;
  }

  if (session.user_id !== null) {
    const user = db.prepare(`
      SELECT id, verified, role, status, name, email, username
      FROM users
      WHERE id = ?
    `).get(session.user_id);

    if (!user || user.verified !== 1 || user.status !== "active") {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      return null;
    }

    if (session.role !== user.role || session.username !== user.username) {
      db.prepare(`
        UPDATE sessions
        SET role = ?, username = ?, name = ?, email = ?
        WHERE id = ?
      `).run(
        user.role,
        user.username,
        user.name,
        user.email,
        session.id
      );

      session.role = user.role;
      session.username = user.username;
      session.name = user.name;
      session.email = user.email;
    }
  }

  return session;
}

function publicUser(session) {
  return {
    username: session.username,
    name: session.name,
    email: session.email,
    role: session.role
  };
}

function requireAuth(req, res) {
  const session = getCurrentSession(req);

  if (!session) {
    sendError(res, 401, "Please sign in to use VYTRON AI.");
    return null;
  }

  return session;
}
// ======================================================
// ======================================================
// EMAIL VERIFICATION — BREVO SMTP
// ======================================================

async function sendVerificationEmail(email, code) {
  if (!emailTransporter) {
    const error = new Error(
      "Brevo SMTP is not configured. Check your .env file."
    );
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const from = {
    name: process.env.BREVO_SENDER_NAME || "VYTRON AI",
    address: process.env.BREVO_SENDER_EMAIL
  };

  try {
    const info = await emailTransporter.sendMail({
      from,
      to: email,
      subject: "Your VYTRON AI verification code",

      text: [
        "Welcome to VYTRON AI!",
        "",
        `Your verification code is: ${code}`,
        "",
        `This code expires in ${VERIFICATION_MINUTES} minutes.`,
        "If you did not request this, you can ignore this email."
      ].join("\n"),

      html: `
        <div style="
          font-family:Arial,sans-serif;
          background:#0b0d18;
          color:#f5f5ff;
          padding:32px;
          border-radius:16px;
          max-width:520px;
          margin:auto;
        ">
          <h1 style="color:#b6a8ff;">VYTRON AI</h1>

          <p>
            Welcome! Use the verification code below
            to activate your account.
          </p>

          <div style="
            font-size:32px;
            font-weight:bold;
            letter-spacing:8px;
            padding:20px 0;
            color:#c4baff;
          ">${code}</div>

          <p>
            This code expires in ${VERIFICATION_MINUTES} minutes.
          </p>

          <p style="color:#9ca3b8;font-size:12px;">
            If you did not request this, you can ignore this email.
          </p>
        </div>
      `
    });

    console.log("Verification email accepted by Brevo:", {
      messageId: info.messageId,
      recipient: email
    });

    return info;
  } catch (error) {
    console.error("Brevo SMTP email failed:", {
      code: error.code,
      responseCode: error.responseCode,
      message: error.message
    });

    throw error;
  }
}

// ======================================================
// AI CONVERSATION HISTORY
// ======================================================

function buildConversationHistory(history, currentMessage) {
  const safeHistory = Array.isArray(history)
    ? history
        .filter(item =>
          item &&
          (item.role === "user" || item.role === "model") &&
          typeof item.text === "string" &&
          item.text.trim().length > 0
        )
        .slice(-MAX_HISTORY_MESSAGES)
    : [];

  const contents = safeHistory.map(item => ({
    role: item.role,
    parts: [{
      text: item.text.slice(0, MAX_HISTORY_TEXT_LENGTH)
    }]
  }));

  contents.push({
    role: "user",
    parts: [{ text: currentMessage }]
  });

  return contents;
}

function getErrorMessage(error) {
  const status = Number(error?.status || error?.statusCode) || 500;

  if (error?.code === "AI_TIMEOUT") {
    return {
      status: 504,
      message: "VYTRON took too long to respond. Please try again."
    };
  }

  if (status === 400) {
    return {
      status: 400,
      message: "The AI service rejected the request. Try rephrasing it."
    };
  }

  if (status === 401 || status === 403) {
    return {
      status,
      message: "Check your Gemini API key and API access."
    };
  }

  if (status === 404) {
    return {
      status: 502,
      message: "The selected Gemini model is unavailable for this API key."
    };
  }

  if (status === 429) {
    return {
      status: 429,
      message: "Gemini's rate limit or quota has been reached. Please wait and try again."
    };
  }

  if (status >= 500) {
    return {
      status: 503,
      message: "The AI service is temporarily unavailable. Please try again."
    };
  }

  return {
    status: 500,
    message: "Something went wrong while generating your response."
  };
}

// ======================================================
// SIGNUP
// ======================================================

async function handleSignup(req, res) {
  let data;

  try {
    data = await readRequestBody(req);
  } catch (error) {
    return sendError(
      res,
      error.code === "BODY_TOO_LARGE" ? 413 : 400,
      error.code === "BODY_TOO_LARGE"
        ? "Your request is too large."
        : "Invalid signup request."
    );
  }

  const name = String(data.name || "").trim();
  const email = String(data.email || "").trim().toLowerCase();
  const username = String(data.username || "").trim();
  const password = data.password;

  if (name.length < 2 || name.length > 80) {
    return sendError(
      res,
      400,
      "Your name must be between 2 and 80 characters."
    );
  }

  if (!isValidGmail(email)) {
    return sendError(res, 400, "Please use a valid Gmail address.");
  }

  if (!validUsername(username)) {
    return sendError(
      res,
      400,
      "Username must be 3–24 characters using letters, numbers, or underscores."
    );
  }

  if (username.toLowerCase() === MASTER_USERNAME.toLowerCase()) {
    return sendError(res, 400, "That username is reserved.");
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  ) {
    return sendError(
      res,
      400,
      "Your password must be between 12 and 128 characters."
    );
  }

  if (!emailTransporter) {
    return sendError(
      res,
      503,
      "Email is not configured. Add RESEND_API_KEY to your .env file."
    );
  }

  const existing = db.prepare(`
    SELECT id
    FROM users
    WHERE email = ? OR username = ? COLLATE NOCASE
  `).get(email, username);

  if (existing) {
    return sendError(
      res,
      409,
      "That email or username is already registered. Try signing in instead."
    );
  }

  const code = makeVerificationCode();
  const verificationHash = await bcrypt.hash(code, 10);
  const passwordHash = await bcrypt.hash(password, 12);

  const expiresAt = new Date(
    Date.now() + VERIFICATION_MINUTES * 60 * 1000
  ).toISOString();

  let userId;

  try {
    const result = db.prepare(`
      INSERT INTO users (
        name,
        email,
        username,
        password_hash,
        verified,
        verification_hash,
        verification_expires_at,
        verification_attempts
      )
      VALUES (?, ?, ?, ?, 0, ?, ?, 0)
    `).run(
      name,
      email,
      username,
      passwordHash,
      verificationHash,
      expiresAt
    );

    userId = Number(result.lastInsertRowid);
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) {
      return sendError(
        res,
        409,
        "That email or username is already in use."
      );
    }

    throw error;
  }

  try {
    await sendVerificationEmail(email, code);

    return sendJson(res, 201, {
      message: "Account created. Check your Gmail inbox for your six-digit verification code."
    });
  } catch (error) {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    console.error("Signup verification failed:", {
      code: error.code,
      statusCode: error.statusCode,
      message: error.message
    });

    return sendError(
      res,
      502,
      "We couldn't send the verification email. Check the server terminal for the exact Resend error, then try again."
    );
  }
}

// ======================================================
// VERIFY EMAIL
// ======================================================

async function handleVerify(req, res) {
  let data;

  try {
    data = await readRequestBody(req);
  } catch {
    return sendError(res, 400, "Invalid verification request.");
  }

  const email = String(data.email || "").trim().toLowerCase();
  const code = String(data.code || "").trim();

  if (!isValidGmail(email) || !/^\d{6}$/.test(code)) {
    return sendError(
      res,
      400,
      "Enter your Gmail address and six-digit verification code."
    );
  }

  const user = db.prepare(`
    SELECT
      id,
      username,
      name,
      email,
      verification_hash,
      verification_expires_at,
      verification_attempts,
      verified
    FROM users
    WHERE email = ?
  `).get(email);

  if (!user) {
    return sendError(res, 400, "Invalid or expired verification code.");
  }

  if (user.verified === 1) {
    return sendJson(res, 200, {
      message: "Your email is already verified. You can sign in."
    });
  }

  if (
    !user.verification_hash ||
    !user.verification_expires_at ||
    user.verification_expires_at <= new Date().toISOString()
  ) {
    return sendError(
      res,
      400,
      "Your verification code has expired. Request a new one."
    );
  }

  if (user.verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
    return sendError(
      res,
      429,
      "Too many incorrect attempts. Request a new verification code."
    );
  }

  const matches = await bcrypt.compare(
    code,
    user.verification_hash
  );

  if (!matches) {
    db.prepare(`
      UPDATE users
      SET verification_attempts = verification_attempts + 1
      WHERE id = ?
    `).run(user.id);

    return sendError(res, 400, "That verification code is incorrect.");
  }

  db.prepare(`
    UPDATE users
    SET verified = 1,
        verification_hash = NULL,
        verification_expires_at = NULL,
        verification_attempts = 0
    WHERE id = ?
  `).run(user.id);

  return sendJson(res, 200, {
    message: "Email verified successfully. You can now sign in."
  });
}

// ======================================================
// RESEND VERIFICATION CODE — CORRECTED
// ======================================================

async function handleResendCode(req, res) {
  let data;

  try {
    data = await readRequestBody(req);
  } catch {
    return sendError(res, 400, "Invalid request.");
  }

  const email = String(data.email || "").trim().toLowerCase();

  if (!isValidGmail(email)) {
    return sendError(res, 400, "Enter a valid Gmail address.");
  }

  if (!emailTransporter) {
    return sendError(
      res,
      503,
      "Brevo SMTP is not configured. Check your .env file."
    );
  }

  const user = db.prepare(`
    SELECT id, verified
    FROM users
    WHERE email = ?
  `).get(email);

  if (!user) {
    return sendError(res, 404, "No account was found for that email.");
  }

  if (user.verified === 1) {
    return sendJson(res, 200, {
      message: "This email is already verified. You can sign in."
    });
  }

  const code = makeVerificationCode();
  const verificationHash = await bcrypt.hash(code, 10);

  const expiresAt = new Date(
    Date.now() + VERIFICATION_MINUTES * 60 * 1000
  ).toISOString();

  db.prepare(`
    UPDATE users
    SET verification_hash = ?,
        verification_expires_at = ?,
        verification_attempts = 0
    WHERE id = ?
  `).run(verificationHash, expiresAt, user.id);

  try {
    await sendVerificationEmail(email, code);

    return sendJson(res, 200, {
      message: "A new verification code has been sent to your inbox."
    });
  } catch (error) {
    console.error("Resend verification failed:", {
      code: error.code,
      statusCode: error.statusCode,
      message: error.message
    });

    return sendError(
      res,
      502,
      "We couldn't send a new code. Check the server terminal for the exact Resend error, then try again."
    );
  }
}

// ======================================================
// LOGIN
// ======================================================

async function handleLogin(req, res) {
  let data;

  try {
    data = await readRequestBody(req);
  } catch {
    return sendError(res, 400, "Invalid login request.");
  }

  const identity = String(
    data.identity || data.username || data.email || ""
  ).trim();

  const password = data.password;

  if (
    !identity ||
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > 128
  ) {
    return sendError(
      res,
      400,
      "Enter your username/email and password."
    );
  }

    const loginKey = getLoginKey(req, identity);

  if (isLoginBlocked(loginKey)) {
    return sendError(
      res,
      429,
      "Too many unsuccessful sign-in attempts. Please wait 15 minutes before trying again."
    );
  }

  // Creator login
  if (
    MASTER_PASSWORD &&
    identity.toLowerCase() === MASTER_USERNAME.toLowerCase()
  ) {
    const matches = await bcrypt.compare(
      password,
      await bcrypt.hash(MASTER_PASSWORD, 12)
    );

           if (!matches) {
      recordFailedLogin(loginKey);
      return sendError(res, 401, "Invalid username or password.");
    }

    clearLoginAttempts(loginKey);

    createSession(res, {
      id: null,
      username: MASTER_USERNAME,
      name: "Jonas Isaac",
      email: process.env.MASTER_EMAIL || null,
      role: "creator"
    });

    return sendJson(res, 200, {
      message: "Creator sign-in successful.",
      user: {
        username: MASTER_USERNAME,
        name: "Jonas Isaac",
        email: process.env.MASTER_EMAIL || null,
        role: "creator"
      }
    });
  }

  const normalizedIdentity = identity.toLowerCase();

  const user = db.prepare(`
    SELECT
      id,
      name,
      email,
      username,
      password_hash,
      verified,
      role,
      status
    FROM users
    WHERE email = ? OR username = ? COLLATE NOCASE
  `).get(normalizedIdentity, identity);

   if (!user) {
    recordFailedLogin(loginKey);

    return sendError(
      res,
      401,
      "Invalid username/email or password."
    );
  }

  const matches = await bcrypt.compare(
    password,
    user.password_hash
  );

    if (!matches) {
    recordFailedLogin(loginKey);

    return sendError(
      res,
      401,
      "Invalid username/email or password."
    );
  }

  if (user.status !== "active") {
    return sendError(
      res,
      403,
      "This account is currently suspended. Contact support for help."
    );
  }

    if (user.verified !== 1) {
    return sendJson(res, 403, {
      code: "EMAIL_NOT_VERIFIED",
      error: "Please verify your email before signing in.",
      email: user.email
    });
  }

  clearLoginAttempts(loginKey);

  createSession(res, {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role || "user"
  });

  return sendJson(res, 200, {
    message: "Sign-in successful.",
    user: {
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role || "user"
    }
  });
}

// ======================================================
// LOGOUT
// ======================================================

function handleLogout(req, res) {
  const token = getCookie(req, COOKIE_NAME);

  if (token) {
    db.prepare(`
      DELETE FROM sessions
      WHERE token_hash = ?
    `).run(sha256(token));
  }

  return sendJson(
    res,
    200,
    { message: "You have been signed out." },
    { "Set-Cookie": clearSessionCookie() }
  );
}
// ======================================================
// GEMINI CHAT
// ======================================================

async function handleChat(req, res) {
  const session = requireAuth(req, res);

  if (!session) return;

  if (!ai) {
    return sendError(
      res,
      503,
      "Gemini is not configured. Add GEMINI_API_KEY to your .env file."
    );
  }

  let data;

  try {
    data = await readRequestBody(req);
  } catch (error) {
    const tooLarge = error.code === "BODY_TOO_LARGE";

    return sendError(
      res,
      tooLarge ? 413 : 400,
      tooLarge
        ? "Your request is too large."
        : "Invalid chat request."
    );
  }

  const message = String(data.message || "").trim();

  if (!message) {
    return sendError(res, 400, "Please enter a message.");
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return sendError(
      res,
      413,
      "Please shorten your message to 20,000 characters or fewer."
    );
  }

  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return sendError(
      res,
      429,
      "VYTRON is busy right now. Please try again shortly."
    );
  }

  const contents = buildConversationHistory(
    data.history,
    message
  );

  activeRequests++;

  let timedOut = false;
  let generationSettled = false;
  let timeoutId;

  const releaseRequestSlot = () => {
    if (generationSettled) return;

    generationSettled = true;
    activeRequests = Math.max(0, activeRequests - 1);
  };

  try {
    console.log(
      `VYTRON: Gemini request for ${session.username}. Active: ${activeRequests}`
    );

    const generationPromise = ai.models.generateContent({
      model: AI_MODEL,
      contents,
      config: {
        systemInstruction: `
You are VYTRON AI, an intelligent, helpful, creative AI assistant.

CREATOR:
If asked who created you, who made you, who your creator is,
or who is behind VYTRON AI, answer:
"VYTRON AI was created by Jonas Isaac, known as LT.W31RD."

IDENTITY:
- Your name is VYTRON AI.
- Be transparent that you are an AI assistant.
- Never claim to be human or to have performed actions you did not perform.

CONVERSATION:
- Use the conversation history provided to understand follow-up questions.
- Maintain continuity within the supplied conversation.
- Do not claim to remember conversations that are not included in the context.
- Ask for clarification when important context is missing.

HELPFULNESS:
- Answer the user's actual question.
- Be clear, accurate, respectful, and practical.
- Explain coding topics in beginner-friendly steps when useful.
- When the user requests complete code, provide complete, coherent code.
- Help with education, programming, writing, reasoning, science, and general knowledge.
- Be honest about uncertainty.
- Never reveal API keys, passwords, or private server configuration.
        `.trim(),
        temperature: 0.7,
        maxOutputTokens: 4096
      }
    });

    // Release the concurrency slot when Gemini actually settles.
    generationPromise.then(
      releaseRequestSlot,
      releaseRequestSlot
    );

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;

        const error = new Error("Gemini request timed out.");
        error.code = "AI_TIMEOUT";

        reject(error);
      }, REQUEST_TIMEOUT_MS);
    });

    let result;

    try {
      result = await Promise.race([
        generationPromise,
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    const reply = result.text?.trim();

    if (!reply) {
      return sendError(
        res,
        502,
        "Gemini returned an empty response. Please try again."
      );
    }

    return sendJson(res, 200, {
      reply,
      model: AI_MODEL
    });

  } catch (error) {
    console.error("VYTRON Gemini request failed:", {
      code: error.code,
      status: error.status,
      message: error.message
    });

    const failure = getErrorMessage(error);

    return sendError(
      res,
      failure.status,
      failure.message
    );

  } finally {
    clearTimeout(timeoutId);

    if (!timedOut) {
      releaseRequestSlot();
    }
  }
}


// ======================================================
// STATIC FILE SERVING
// ======================================================

function serveStatic(req, res, pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendError(res, 400, "Invalid URL.");
  }

  if (
    decodedPath.includes("\0") ||
    decodedPath.includes(String.fromCharCode(92))
  ) {
    return sendError(res, 400, "Invalid URL.");
  }

  const requestedPath =
    decodedPath === "/" ? "/index.html" : decodedPath;

  const filePath = path.resolve(
    __dirname,
    "." + requestedPath
  );

  if (
    filePath !== __dirname &&
    !filePath.startsWith(__dirname + path.sep)
  ) {
    return sendError(res, 403, "Access denied.");
  }

  // Block private files and directories
const relativePath = path.relative(__dirname, filePath);

const blockedSegments = relativePath.split(path.sep);

const blockedFiles = new Set([
  ".env",
  "server.js",
  "users.db",
  "users.db-wal",
  "users.db-shm",
  "package.json",
  "package-lock.json"
]);

if (
  blockedSegments.some(segment =>
    segment.startsWith(".") ||
    segment === "node_modules"
  ) ||
  blockedFiles.has(path.basename(filePath).toLowerCase())
) {
  return sendError(res, 403, "Access denied.");
}

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      return sendError(res, 404, "File not found.");
    }

    const extension = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      "Content-Type":
        mimeTypes[extension] || "application/octet-stream",
      "Cache-Control":
        extension === ".html"
          ? "no-cache"
          : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });

    if (req.method === "HEAD") {
      return res.end();
    }

    const stream = fs.createReadStream(filePath);

    stream.on("error", error => {
      console.error("Static file error:", error.message);

      if (!res.headersSent) {
        sendError(res, 500, "Could not read the requested file.");
      } else if (!res.destroyed) {
        res.destroy(error);
      }
    });

    stream.pipe(res);
  });
}


// ======================================================
// ADMINISTRATION API
// ======================================================

const ADMIN_ROLES = ["admin", "super_admin", "creator"];


function writeAudit(
  actor,
  action,
  targetUsername = null,
  details = {},
  req = null
) {
  db.prepare(`
    INSERT INTO admin_audit_logs
      (actor_username, actor_role, action, target_username, details, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    actor.username,
    actor.role,
    action,
    targetUsername,
    JSON.stringify(details),
    req?.socket?.remoteAddress || null
  );
}


function adminCanManage(actor, target) {
  if (!target || target.role === "creator") {
    return false;
  }

  if (actor.role === "creator") {
    return true;
  }

  if (actor.role === "super_admin") {
    return target.role === "user" || target.role === "admin";
  }

  if (actor.role === "admin") {
    return target.role === "user";
  }

  return false;
}


async function handleAdminRequest(req, res, requestUrl) {
  const actor = requireAuth(req, res);

  if (!actor) return;

  if (!ADMIN_ROLES.includes(actor.role)) {
    return sendError(
      res,
      403,
      "You do not have permission to access administration."
    );
  }

  const pathname = requestUrl.pathname;


  // --------------------------------------------------
  // ADMIN OVERVIEW
  // --------------------------------------------------

  if (
    req.method === "GET" &&
    pathname === "/api/admin/overview"
  ) {
    const totalUsers = db.prepare(
      "SELECT COUNT(*) AS count FROM users"
    ).get().count;

    const activeUsers = db.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE status = 'active'"
    ).get().count;

    const admins = db.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"
    ).get().count;

    const superAdmins = db.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin'"
    ).get().count;

    const activeSessions = db.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?"
    ).get(new Date().toISOString()).count;

    return sendJson(res, 200, {
      stats: {
        totalUsers,
        activeUsers,
        admins,
        superAdmins,
        activeSessions
      },
      aiConfigured: Boolean(ai),
      emailConfigured: Boolean(emailTransporter)
    });
  }


  // --------------------------------------------------
  // USER MANAGEMENT
  // --------------------------------------------------

  if (
    req.method === "GET" &&
    pathname === "/api/admin/users"
  ) {
    const q = String(
      requestUrl.searchParams.get("q") || ""
    ).trim().slice(0, 100);

    const like = `%${q}%`;

    const users = db.prepare(`
      SELECT
        id,
        name,
        email,
        username,
        role,
        status,
        created_at AS createdAt
      FROM users
      WHERE (
        ? = ''
        OR username LIKE ?
        OR email LIKE ?
        OR name LIKE ?
      )
      ORDER BY id DESC
      LIMIT 200
    `).all(q, like, like, like);

    return sendJson(res, 200, { users });
  }


  // --------------------------------------------------
  // AUDIT LOGS
  // --------------------------------------------------

  if (
    req.method === "GET" &&
    pathname === "/api/admin/audit"
  ) {
    const rows = db.prepare(`
      SELECT
        id,
        actor_username,
        actor_role,
        action,
        target_username,
        details,
        ip_address,
        created_at
      FROM admin_audit_logs
      ORDER BY id DESC
      LIMIT 100
    `).all();

    const logs = rows.map(row => ({
      ...row,
      details: (() => {
        try {
          return JSON.parse(row.details || "{}");
        } catch {
          return {};
        }
      })()
    }));

    return sendJson(res, 200, { logs });
  }


  // --------------------------------------------------
  // CHANGE USER ROLE OR STATUS
  // --------------------------------------------------

  const match = pathname.match(
    /^\/api\/admin\/users\/(\d+)\/(role|status)$/
  );

  if (match && req.method === "PATCH") {
    let data;

    try {
      data = await readRequestBody(req);
    } catch (error) {
      return sendError(
        res,
        error.code === "BODY_TOO_LARGE" ? 413 : 400,
        "Invalid administration request."
      );
    }

    const target = db.prepare(`
      SELECT id, username, role, status
      FROM users
      WHERE id = ?
    `).get(Number(match[1]));

    if (!target) {
      return sendError(res, 404, "Account not found.");
    }

    if (!adminCanManage(actor, target)) {
      return sendError(
        res,
        403,
        "You cannot manage this account."
      );
    }


    // ------------------------------------------------
    // UPDATE ACCOUNT STATUS
    // ------------------------------------------------

    if (match[2] === "status") {
      if (!["active", "suspended"].includes(data.status)) {
        return sendError(res, 400, "Invalid account status.");
      }

      db.prepare(`
        UPDATE users
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(data.status, target.id);

      if (data.status === "suspended") {
        db.prepare(
          "DELETE FROM sessions WHERE user_id = ?"
        ).run(target.id);
      }

      writeAudit(
        actor,
        data.status === "suspended"
          ? "user.suspended"
          : "user.restored",
        target.username,
        {
          previousStatus: target.status,
          status: data.status
        },
        req
      );

      return sendJson(res, 200, {
        message: "Account status updated.",
        status: data.status
      });
    }


    // ------------------------------------------------
    // UPDATE ACCOUNT ROLE
    // ------------------------------------------------

    const allowedRoles = actor.role === "creator"
      ? ["user", "admin", "super_admin"]
      : actor.role === "super_admin"
        ? ["user", "admin"]
        : [];

    if (!allowedRoles.includes(data.role)) {
      return sendError(
        res,
        403,
        "You cannot assign that role."
      );
    }

    db.prepare(`
      UPDATE users
      SET role = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(data.role, target.id);

    db.prepare(`
      UPDATE sessions
      SET role = ?
      WHERE user_id = ?
    `).run(data.role, target.id);

    writeAudit(
      actor,
      "user.role_changed",
      target.username,
      {
        previousRole: target.role,
        role: data.role
      },
      req
    );

    return sendJson(res, 200, {
      message: "Account role updated.",
      role: data.role
    });
  }

  return sendError(
    res,
    404,
    "Administration endpoint not found."
  );
}
// ======================================================
// HTTP SERVER & ROUTING
// ======================================================

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    const pathname = requestUrl.pathname;

    // --------------------------------------------------
    // SECURITY HEADERS
    // --------------------------------------------------

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // --------------------------------------------------
    // BASIC HEALTH CHECK
    // --------------------------------------------------

    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, {
        status: "ok",
        app: "VYTRON AI",
        version: "1.0.0",
        aiConfigured: Boolean(ai),
        emailConfigured: Boolean(emailTransporter)
      });
    }

    // --------------------------------------------------
    // AUTHENTICATION ROUTES
    // --------------------------------------------------

    if (pathname === "/api/auth/signup" && req.method === "POST") {
      return await handleSignup(req, res);
    }

    if (pathname === "/api/auth/verify" && req.method === "POST") {
      return await handleVerify(req, res);
    }

    if (pathname === "/api/auth/resend-code" && req.method === "POST") {
      return await handleResendCode(req, res);
    }

    if (pathname === "/api/auth/login" && req.method === "POST") {
      return await handleLogin(req, res);
    }

    if (pathname === "/api/auth/logout" && req.method === "POST") {
      return handleLogout(req, res);
    }

    if (pathname === "/api/auth/me" && req.method === "GET") {
      const session = requireAuth(req, res);

      if (!session) return;

      return sendJson(res, 200, {
        authenticated: true,
        user: {
          id: session.user_id,
          name: session.name,
          username: session.username,
          email: session.email,
          role: session.role
        }
      });
    }

    // --------------------------------------------------
    // AI CHAT ROUTE
    // --------------------------------------------------

    if (pathname === "/api/chat" && req.method === "POST") {
      return await handleChat(req, res);
    }

    // --------------------------------------------------
    // ADMINISTRATION ROUTES
    // --------------------------------------------------

    if (pathname.startsWith("/api/admin/")) {
      return await handleAdminRequest(req, res, requestUrl);
    }

    // --------------------------------------------------
    // API NOT FOUND
    // --------------------------------------------------

    if (pathname.startsWith("/api/")) {
      return sendError(res, 404, "API endpoint not found.");
    }

    // --------------------------------------------------
// --------------------------------------------------
// ROLE-AWARE DASHBOARD ROUTING
// --------------------------------------------------

if (pathname === "/" || pathname === "/index.html") {
  const session = getCurrentSession(req);

  console.log("DASHBOARD CHECK:", {
    pathname,
    username: session?.username || "Guest",
    role: session?.role || "Guest"
  });

  // Not signed in: redirect to login
  if (!session) {
    return redirect(res, "/auth.html");
  }

  // Admin, super admin, or creator: redirect to admin dashboard
  if (ADMIN_ROLES.includes(session.role)) {
    return redirect(res, "/admin.html");
  }

  // Normal users continue to index.html
}

    // --------------------------------------------------
    // PROTECTED ADMIN PAGE
    // --------------------------------------------------

    if (pathname === "/admin.html" || pathname === "/admin") {
      const session = requireAuth(req, res);

      if (!session) return;

      if (!ADMIN_ROLES.includes(session.role)) {
        return sendError(res, 403, "You do not have permission to access this page.");
      }

      return serveStatic(req, res, "/admin.html");
    }

    // --------------------------------------------------
    // STATIC FILES
    // --------------------------------------------------

    if (["GET", "HEAD"].includes(req.method)) {
      return serveStatic(req, res, pathname);
    }

    return sendError(res, 405, "Method not allowed.");

  } catch (error) {
    console.error("VYTRON server error:", error);

    if (!res.headersSent) {
      return sendError(res, 500, "An unexpected server error occurred.");
    }

    if (!res.destroyed) {
      res.destroy(error);
    }
  }
});


// ======================================================
// SERVER STARTUP
// ======================================================

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("========================================");
  console.log("          VYTRON AI SERVER");
  console.log("========================================");
  console.log(`Server: http://${HOST}:${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Gemini: ${ai ? "Configured" : "Not configured"}`);
 console.log(`Email: ${emailTransporter ? "Configured" : "Not configured"}`);
  console.log(`Database: Connected`);
  console.log("========================================");
  console.log("");
});


// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down VYTRON AI...`);

  server.close(() => {
    try {
      db.close();
      console.log("Database connection closed.");
    } catch (error) {
      console.error("Database shutdown error:", error.message);
    }

    console.log("VYTRON AI server stopped.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
  shutdown("UNCAUGHT_EXCEPTION");
});