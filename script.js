
"use strict";

// ========================================
// AI DOCUMENT AGENT - BROWSER DEMO
// ========================================

// Demo only: browser storage is not secure authentication.
const $ = (id) => document.getElementById(id);

const STORAGE_USERS = "docAgentUsers";
const STORAGE_SESSION = "docAgentSession";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_STORED_TEXT = 150000;

let currentUser = null;
let authMode = "login";
let uploadedFiles = [];
let chatHistory = [];
let currentChatId = null;
let selectedFileIds = new Set();

const fileInput = $("fileInput");
const dropZone = $("dropZone");
const authForm = $("authForm");
const questionForm = $("questionForm");

// ========================================
// STORAGE
// ========================================

function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveUserData() {
  if (!currentUser) return;

  try {
    localStorage.setItem(userKey("files"), JSON.stringify(uploadedFiles));
    localStorage.setItem(userKey("chats"), JSON.stringify(chatHistory));
  } catch (error) {
    console.error(error);
    alert("Browser storage is full. Delete some files or chats and try again.");
  }
}

function userKey(type) {
  return `docAgent_${type}_${currentUser.email}`;
}

function loadUserData() {
  uploadedFiles = readJSON(userKey("files"), []);
  chatHistory = readJSON(userKey("chats"), []);

  // Remove any malformed stored entries.
  if (!Array.isArray(uploadedFiles)) uploadedFiles = [];
  if (!Array.isArray(chatHistory)) chatHistory = [];

  uploadedFiles = uploadedFiles.filter(
    (file) =>
      file &&
      typeof file.id === "string" &&
      typeof file.name === "string" &&
      typeof file.text === "string"
  );

  chatHistory = chatHistory.filter(
    (chat) =>
      chat &&
      typeof chat.id === "string" &&
      Array.isArray(chat.messages)
  );
}

// ========================================
// LOGIN AND SIGNUP DEMO
// ========================================

function setAuthMode(mode) {
  authMode = mode;

  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");

  const signingUp = mode === "signup";

  $("authName").hidden = !signingUp;
  $("nameLabel").hidden = !signingUp;
  $("authName").required = signingUp;
  $("authName").autocomplete = "name";
  $("authPassword").autocomplete = signingUp
    ? "new-password"
    : "current-password";

  $("authSubmit").textContent = signingUp ? "Create account" : "Login";
  $("authMessage").textContent = "";
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("signupTab").addEventListener("click", () => setAuthMode("signup"));

authForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPassword").value;
  const name = $("authName").value.trim();

  if (!email || !password) return;

  const users = readJSON(STORAGE_USERS, {});

  if (authMode === "signup") {
    if (!name) {
      showAuthMessage("Please enter your name.");
      return;
    }

    if (users[email]) {
      showAuthMessage("This email already has a demo account. Please log in.");
      return;
    }

    // DEMO ONLY: never store real passwords like this in production.
    users[email] = { name, password };

    try {
      localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    } catch {
      showAuthMessage("Browser storage is unavailable.");
      return;
    }

    loginUser(email, users[email]);
    return;
  }

  const user = users[email];

  if (!user || user.password !== password) {
    showAuthMessage("Incorrect email or password.");
    return;
  }

  loginUser(email, user);
});

function showAuthMessage(message) {
  $("authMessage").textContent = message;
  $("authMessage").classList.remove("success");
}

function loginUser(email, user) {
  currentUser = { email, name: user.name };

  try {
    sessionStorage.setItem(
      STORAGE_SESSION,
      JSON.stringify(currentUser)
    );
  } catch {
    // The current page can still work without session persistence.
  }

  loadUserData();

  $("loginPage").hidden = true;
  $("app").hidden = false;
  $("welcomeName").textContent = `Hello, ${currentUser.name}`;

  currentChatId = null;
  selectedFileIds.clear();

  renderAll();
  showPage("dashboardPage");
}

function logout() {
  sessionStorage.removeItem(STORAGE_SESSION);
  currentUser = null;
  uploadedFiles = [];
  chatHistory = [];
  currentChatId = null;
  selectedFileIds.clear();

  $("app").hidden = true;
  $("loginPage").hidden = false;
  authForm.reset();
  setAuthMode("login");
}

$("logoutBtn").addEventListener("click", logout);

function restoreSession() {
  const session = readJSON(STORAGE_SESSION, null);

  if (!session || !session.email) return;

  const users = readJSON(STORAGE_USERS, {});
  const user = users[session.email];

  if (user) {
    loginUser(session.email, user);
  }
}

// ========================================
// PAGE NAVIGATION
// ========================================

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav[data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  if (pageId === "chatPage") renderChat();
  if (pageId === "historyPage") renderHistory();
  if (pageId === "documentsPage") renderFiles();
}

document.querySelectorAll(".nav[data-page]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.go));
});

// ========================================
// FILE UPLOAD AND TEXT EXTRACTION
// ========================================

fileInput.addEventListener("change", async () => {
  await handleFiles(Array.from(fileInput.files || []));
  fileInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");

  await handleFiles(Array.from(event.dataTransfer.files || []));
});

async function handleFiles(files) {
  if (!files.length) return;

  let added = 0;

  for (const file of files) {
    try {
      if (file.size > MAX_FILE_SIZE) {
        setUploadStatus(`${file.name}: maximum file size is 5 MB.`);
        continue;
      }

      const extension = file.name.split(".").pop().toLowerCase();
      const supported = ["txt", "md", "csv", "json", "pdf", "docx"];

      if (!supported.includes(extension)) {
        setUploadStatus(`${file.name}: unsupported file type.`);
        continue;
      }

      setUploadStatus(`Reading ${file.name}...`);

      const text = await extractText(file, extension);

      if (!text.trim()) {
        setUploadStatus(
          `${file.name}: no readable text found. Scanned PDFs need OCR.`
        );
        continue;
      }

      const existing = uploadedFiles.find(
        (item) => item.name === file.name && item.size === file.size
      );

      if (existing) {
        setUploadStatus(`${file.name} is already uploaded.`);
        continue;
      }

      const document = {
        id: makeId(),
        name: file.name,
        size: file.size,
        type: extension.toUpperCase(),
        uploadedAt: new Date().toISOString(),
        text: text.slice(0, MAX_STORED_TEXT)
      };

      uploadedFiles.push(document);
      added++;
      saveUserData();
    } catch (error) {
      console.error(error);
      setUploadStatus(
        `Could not read ${file.name}. Check the file or try another one.`
      );
    }
  }

  renderAll();

  if (added > 0) {
    setUploadStatus(
      `${added} file(s) uploaded and read successfully.`
    );
  }
}

async function extractText(file, extension) {
  if (["txt", "md", "csv", "json"].includes(extension)) {
    return await file.text();
  }

  if (extension === "pdf") {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js library did not load.");
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer)
    }).promise;

    const pages = [];

    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();

      const pageText = content.items
        .map((item) => item.str || "")
        .join(" ");

      pages.push(`\n[Page ${number}]\n${pageText}`);
    }

    return pages.join("\n");
  }

  if (extension === "docx") {
    if (!window.mammoth) {
      throw new Error("DOCX reading library did not load.");
    }

    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  throw new Error("Unsupported file type.");
}

function setUploadStatus(message) {
  $("uploadStatus").textContent = message;
}

// ========================================
// FILE LIST AND DASHBOARD
// ========================================

function renderAll() {
  renderDashboard();
  renderFiles();
  renderChatFiles();
  renderHistory();
  renderChat();
}

function formatDate(dateString) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Render user-provided text safely using textContent.
function addFileRow(container, file, allowDelete = false) {
  const row = document.createElement("div");
  row.className = "file-row";

  const icon = document.createElement("div");
  icon.className = "file-icon";
  icon.textContent = file.type;

  const info = document.createElement("div");
  info.className = "row-info";

  const name = document.createElement("strong");
  name.textContent = file.name;

  const details = document.createElement("small");
  details.textContent =
    `${formatSize(file.size)} · ${formatDate(file.uploadedAt)}`;

  info.append(name, details);
  row.append(icon, info);

  if (allowDelete) {
    const button = document.createElement("button");
    button.className = "delete-btn";
    button.type = "button";
    button.textContent = "Delete";
    button.setAttribute("aria-label", `Delete ${file.name}`);

    button.addEventListener("click", () => {
      if (!confirm(`Delete "${file.name}"?`)) return;

      uploadedFiles = uploadedFiles.filter((item) => item.id !== file.id);
      selectedFileIds.delete(file.id);
      saveUserData();
      renderAll();
      setUploadStatus(`${file.name} deleted.`);
    });

    row.append(button);
  }

  container.append(row);
}

function renderDashboard() {
  $("totalFiles").textContent = uploadedFiles.length;
  $("totalChats").textContent = chatHistory.length;

  const recentFiles = $("recentFiles");
  recentFiles.replaceChildren();

  if (!uploadedFiles.length) {
    recentFiles.textContent = "No files uploaded yet.";
    recentFiles.className = "empty";
  } else {
    recentFiles.className = "";
    uploadedFiles.slice().reverse().slice(0, 5).forEach((file) => {
      addFileRow(recentFiles, file);
    });
  }

  const recentChats = $("recentChats");
  recentChats.replaceChildren();

  if (!chatHistory.length) {
    recentChats.textContent = "No conversations yet.";
    recentChats.className = "empty";
  } else {
    recentChats.className = "";

    chatHistory.slice().reverse().slice(0, 5).forEach((chat) => {
      addHistoryRow(recentChats, chat, true);
    });
  }
}

function renderFiles() {
  const container = $("fileList");
  container.replaceChildren();

  $("fileCount").textContent =
    `${uploadedFiles.length} file${uploadedFiles.length === 1 ? "" : "s"}`;

  if (!uploadedFiles.length) {
    container.className = "empty";
    container.textContent = "No documents uploaded yet.";
    return;
  }

  container.className = "";

  uploadedFiles.slice().reverse().forEach((file) => {
    addFileRow(container, file, true);
  });
}

// ========================================
// CHAT FILE SELECTION
// ========================================

function renderChatFiles() {
  const container = $("chatFileList");
  container.replaceChildren();

  if (!uploadedFiles.length) {
    container.className = "empty";
    container.textContent = "Upload a document first.";
    return;
  }

  container.className = "";

  const hint = document.createElement("p");
  hint.className = "small muted";
  hint.textContent = "Select files to search. None selected means all files.";
  container.append(hint);

  uploadedFiles.forEach((file) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-file-button";
    button.textContent = file.name;
    button.title = file.name;

    if (selectedFileIds.has(file.id)) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      if (selectedFileIds.has(file.id)) {
        selectedFileIds.delete(file.id);
      } else {
        selectedFileIds.add(file.id);
      }

      renderChatFiles();
    });

    container.append(button);
  });
}

// ========================================
// CHAT CREATION AND HISTORY
// ========================================

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createNewChat() {
  currentChatId = makeId();

  const chat = {
    id: currentChatId,
    title: "New conversation",
    createdAt: new Date().toISOString(),
    messages: []
  };

  chatHistory.push(chat);
  saveUserData();
  renderAll();
  showPage("chatPage");
  $("questionInput").focus();
}

$("newChatBtn").addEventListener("click", createNewChat);
$("historyNewChatBtn").addEventListener("click", createNewChat);

function getCurrentChat() {
  return chatHistory.find((chat) => chat.id === currentChatId) || null;
}

function openChat(id) {
  currentChatId = id;
  renderChat();
  showPage("chatPage");
}

function addHistoryRow(container, chat, compact = false) {
  const row = document.createElement("div");
  row.className = "history-row";

  const icon = document.createElement("div");
  icon.className = "file-icon";
  icon.textContent = "✉";

  const info = document.createElement("div");
  info.className = "row-info";

  const title = document.createElement("strong");
  title.textContent = chat.title || "New conversation";

  const details = document.createElement("small");
  details.textContent =
    `${chat.messages.length} messages · ${formatDate(chat.createdAt)}`;

  info.append(title, details);

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "history-open";
  openButton.textContent = "Open";
  openButton.addEventListener("click", () => openChat(chat.id));

  row.append(icon, info, openButton);

  if (!compact) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-btn";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", () => {
      if (!confirm("Delete this conversation?")) return;

      chatHistory = chatHistory.filter((item) => item.id !== chat.id);

      if (currentChatId === chat.id) currentChatId = null;

      saveUserData();
      renderAll();
    });

    row.append(deleteButton);
  }

  container.append(row);
}

function renderHistory() {
  const container = $("historyList");
  container.replaceChildren();

  if (!chatHistory.length) {
    container.className = "empty";
    container.textContent = "No saved conversations yet.";
    return;
  }

  container.className = "";

  chatHistory.slice().reverse().forEach((chat) => {
    addHistoryRow(container, chat, false);
  });
}

// ========================================
// RENDER MESSAGES
// ========================================

function renderChat() {
  const messages = $("messages");
  messages.replaceChildren();

  const chat = getCurrentChat();

  if (!chat) {
    $("chatTitle").textContent = "New conversation";

    const welcome = document.createElement("div");
    welcome.className = "welcome-message";

    const logo = document.createElement("div");
    logo.className = "logo";
    logo.textContent = "✦";

    const heading = document.createElement("h2");
    heading.textContent = "What would you like to know?";

    const description = document.createElement("p");
    description.textContent =
      "Upload a document, then ask a question about its contents.";

    welcome.append(logo, heading, description);
    messages.append(welcome);
    return;
  }

  $("chatTitle").textContent = chat.title;

  if (!chat.messages.length) {
    const welcome = document.createElement("div");
    welcome.className = "welcome-message";

    const heading = document.createElement("h2");
    heading.textContent = "Ask a question";

    const description = document.createElement("p");
    description.textContent =
      "Your answers will be matched against the uploaded documents.";

    welcome.append(heading, description);
    messages.append(welcome);
    return;
  }

  chat.messages.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${message.role}`;
    bubble.textContent = message.content;

    if (message.source) {
      const source = document.createElement("span");
      source.className = "source";
      source.textContent = `Source: ${message.source}`;
      bubble.append(source);
    }

    messages.append(bubble);
  });

  messages.scrollTop = messages.scrollHeight;
}

// ========================================
// DOCUMENT SEARCH
// ========================================

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "what", "when",
  "where", "which", "who", "why", "how", "does", "did", "can",
  "could", "would", "should", "this", "that", "these", "those",
  "with", "from", "into", "about", "have", "has", "had", "you",
  "your", "tell", "give", "please", "explain", "find", "show",
  "document", "file", "uploaded", "information", "according"
]);

function getSearchTerms(question) {
  return [...new Set(normalizeText(question))]
    .filter((word) => !STOP_WORDS.has(word));
}

function splitIntoChunks(text, size = 900, overlap = 150) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += size - overlap;
  }

  return chunks;
}

function retrieveRelevantPassages(question) {
  let docs = uploadedFiles;

  if (selectedFileIds.size > 0) {
    docs = docs.filter((file) => selectedFileIds.has(file.id));
  }

  const terms = getSearchTerms(question);

  if (!terms.length) return [];

  const results = [];

  docs.forEach((file) => {
    const chunks = splitIntoChunks(file.text);

    chunks.forEach((chunk, index) => {
      const normalizedChunk = normalizeText(chunk);
      const wordSet = new Set(normalizedChunk);

      let score = 0;

      terms.forEach((term) => {
        if (wordSet.has(term)) score += 2;
        else if (normalizedChunk.some((word) => word.includes(term))) {
          score += 1;
        }
      });

      if (score > 0) {
        results.push({
          fileName: file.name,
          text: chunk.trim(),
          score,
          index
        });
      }
    });
  });

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

// ========================================
// ANSWER QUESTIONS
// ========================================

questionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = $("questionInput").value.trim();

  if (!question) return;

  if (!uploadedFiles.length) {
    alert("Please upload a document before asking a question.");
    showPage("documentsPage");
    return;
  }

  if (!currentChatId || !getCurrentChat()) {
    createNewChat();
  }

  const chat = getCurrentChat();

  if (!chat.messages.length) {
    chat.title = question.length > 48
      ? question.slice(0, 48) + "..."
      : question;
  }

  chat.messages.push({
    role: "user",
    content: question,
    time: new Date().toISOString()
  });

  $("questionInput").value = "";
  saveUserData();
  renderAll();

  const results = retrieveRelevantPassages(question);
  let answer;
  let source = "";

  if (!results.length) {
    answer =
      "I couldn't find a relevant answer in the selected documents. " +
      "Try using different words, selecting more files, or checking that " +
      "the document contains readable text.";
  } else {
    const bestScore = results[0].score;

    const strongResults = results.filter(
      (result) => result.score >= Math.max(2, bestScore * 0.4)
    );

    const chosen = strongResults.length ? strongResults : results.slice(0, 1);

    answer =
      "Here is the information I found in your documents:\n\n" +
      chosen.map((result) => result.text).join("\n\n---\n\n") +
      "\n\nThis is a keyword-based result, not an AI-generated summary. " +
      "Check the source passage to make sure it answers your question.";

    source = [...new Set(chosen.map((result) => result.fileName))].join(", ");
  }

  chat.messages.push({
    role: "assistant",
    content: answer,
    source,
    time: new Date().toISOString()
  });

  saveUserData();
  renderAll();
});

// ========================================
// STARTUP
// ========================================

document.addEventListener("DOMContentLoaded", () => {
  setAuthMode("login");
  restoreSession();
});
