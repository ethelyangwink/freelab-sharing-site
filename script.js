const EDIT_PASSWORD_HASH =
  "071994fef2777c29ed99ac8814073493c4fdd81ebbf0d36024862184f1cadb51";
const EDIT_STORAGE_KEY = "freelab-text-edits-v1";
const EDIT_SESSION_KEY = "freelab-owner-unlocked";
const EDIT_BACKUP_ENDPOINT = "/api/text-edits";
const EDIT_FILE_DB_NAME = "freelab-text-edit-files";
const EDIT_FILE_STORE_NAME = "handles";
const EDIT_FILE_HANDLE_KEY = "text-edits-backup";
const EDIT_FILE_BOUND_KEY = "freelab-text-backup-bound";
const EDITABLE_SELECTOR = [
  ".brand span:not(.brand-mark)",
  ".top-nav a",
  ".hero-note",
  ".chapter-kicker",
  "h1",
  "h3",
  "h4",
  "h5",
  "p",
  "strong",
  ".key-grid span",
  ".launch-plan span",
  ".pattern-copy span",
  ".button",
].join(",");

let tocObserver = null;

function initializeToc() {
  const tocTree = document.querySelector(".toc-tree");
  const toggleAll = document.querySelector(".toc-toggle-all");
  const headings = Array.from(document.querySelectorAll(".content h1, .content h3, .content h4, .content h5"));
  const levels = { H1: 1, H3: 2, H4: 3, H5: 4 };
  const roots = [];
  const stack = [];

  headings.forEach((heading, index) => {
    if (!heading.id) heading.id = `heading-${index + 1}`;
    const node = { heading, level: levels[heading.tagName], children: [] };
    while (stack.length && stack.at(-1).level >= node.level) stack.pop();
    (stack.length ? stack.at(-1).children : roots).push(node);
    stack.push(node);
  });

  function renderNodes(nodes) {
    const list = document.createElement("ul");
    nodes.forEach((node) => {
      const item = document.createElement("li");
      const row = document.createElement("div");
      const link = document.createElement("a");
      row.className = "toc-row";
      link.href = `#${node.heading.id}`;
      link.textContent = node.heading.textContent.trim();
      row.append(link);

      if (node.children.length) {
        const button = document.createElement("button");
        const childList = renderNodes(node.children);
        button.type = "button";
        button.className = "toc-branch-toggle";
        button.setAttribute("aria-label", `收起${link.textContent}的子标题`);
        button.setAttribute("aria-expanded", "true");
        button.textContent = "−";
        button.addEventListener("click", () => {
          const expanded = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!expanded));
          button.setAttribute("aria-label", `${expanded ? "展开" : "收起"}${link.textContent}的子标题`);
          button.textContent = expanded ? "+" : "−";
          childList.hidden = expanded;
          updateToggleAllLabel();
        });
        row.prepend(button);
        item.append(row, childList);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "toc-branch-spacer";
        spacer.setAttribute("aria-hidden", "true");
        row.prepend(spacer);
        item.append(row);
      }
      list.append(item);
    });
    return list;
  }

  function updateToggleAllLabel() {
    const buttons = Array.from(tocTree.querySelectorAll(".toc-branch-toggle"));
    const allExpanded = buttons.every((button) => button.getAttribute("aria-expanded") === "true");
    toggleAll.textContent = allExpanded ? "全部收起" : "全部展开";
  }

  tocTree.replaceChildren(renderNodes(roots));
  toggleAll.onclick = () => {
    const expand = toggleAll.textContent === "全部展开";
    tocTree.querySelectorAll(".toc-branch-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", String(expand));
      button.textContent = expand ? "−" : "+";
      button.closest("li").querySelector(":scope > ul").hidden = !expand;
    });
    updateToggleAllLabel();
  };

  if (tocObserver) tocObserver.disconnect();
  const tocLinks = Array.from(tocTree.querySelectorAll("a"));
  tocObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    tocLinks.forEach((link) => link.classList.toggle("active", link.hash === `#${visible.target.id}`));
  }, { rootMargin: "-18% 0px -68% 0px", threshold: [0.1, 0.25, 0.5] });
  headings.forEach((heading) => tocObserver.observe(heading));
}

const editToolbar = document.querySelector(".edit-toolbar");
const editLock = document.querySelector(".edit-lock");
const editLockForm = document.querySelector(".edit-lock-panel");
const editLockInput = editLock.querySelector("input");
const editLockError = editLock.querySelector(".edit-lock-error");
const editSaveStatus = editToolbar.querySelector(".edit-save-status");
const editableElements = Array.from(document.querySelectorAll(EDITABLE_SELECTOR))
  .filter((element) => !element.closest(".edit-toolbar, .edit-lock, .lightbox"))
  .filter((element) => !element.querySelector(EDITABLE_SELECTOR));
let isEditingText = false;
let hasRemoteBackupServer = false;
let fileBackupHandlePromise = null;
let hasUnsavedTextChanges = false;
const PEN_FADE_MS = 620;
const PEN_LINE_WIDTH = 5;
let isPresentationPenActive = false;
let penCanvas = null;
let penContext = null;
let penAnimationFrame = null;
let isDrawingWithPen = false;
let penCurrentStroke = null;
let penStrokes = [];

function getStoredEdits() {
  try {
    return JSON.parse(localStorage.getItem(EDIT_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function setStoredEdits(edits) {
  localStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(edits));
}

function canUseRemoteBackup() {
  return window.location.protocol !== "file:";
}

function canUseFileBackup() {
  return "showSaveFilePicker" in window && "indexedDB" in window;
}

function isLocalPreview() {
  return ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
}

function getElementPath(element) {
  const parts = [];
  let current = element;

  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement.children)
      .filter((sibling) => sibling.tagName === current.tagName);
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = current.parentElement;
  }

  return parts.join(">");
}

function getEditableText(element) {
  // contenteditable represents Enter with <div> or <br>; textContent drops those breaks.
  return element.innerText.replace(/\r\n?/g, "\n");
}

function saveElementText(element) {
  const edits = getStoredEdits();
  const editPath = element.dataset.editPath || getElementPath(element);
  element.dataset.editPath = editPath;
  edits[editPath] = getEditableText(element);
  setStoredEdits(edits);
}

function collectAllTextEdits() {
  const edits = {};

  editableElements.forEach((element) => {
    const editPath = element.dataset.editPath || getElementPath(element);
    element.dataset.editPath = editPath;
    edits[editPath] = getEditableText(element);
  });

  return edits;
}

function showSaveStatus(message) {
  editSaveStatus.textContent = message;
  window.setTimeout(() => {
    if (editSaveStatus.textContent === message) {
      editSaveStatus.textContent = "";
    }
  }, 1600);
}

function markTextChangesSaved() {
  hasUnsavedTextChanges = false;
}

function temporarilySaveTextEdits() {
  setStoredEdits(collectAllTextEdits());
  markTextChangesSaved();
  showSaveStatus("已暂存到浏览器");
}

function getBackupPayload() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: window.location.href,
    edits: collectAllTextEdits(),
  };
}

function getSaveStatusMessage(synced, wroteFile) {
  if (synced && wroteFile) return "已保存到源码和本地文件";
  if (synced) return "已保存到源码";
  if (wroteFile) return "已保存到本地文件";
  return "已保存到浏览器";
}

async function backupTextEditsToServer() {
  if (!canUseRemoteBackup()) return false;

  try {
    const response = await fetch(EDIT_BACKUP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits: collectAllTextEdits() }),
      keepalive: true,
    });

    if (!response.ok) return false;

    hasRemoteBackupServer = true;
    return true;
  } catch {
    return false;
  }
}

async function saveAndBackupTextEdits() {
  setStoredEdits(collectAllTextEdits());
  showSaveStatus("正在保存并备份...");

  let wroteFile = false;
  if (
    !isLocalPreview() &&
    canUseFileBackup() &&
    localStorage.getItem(EDIT_FILE_BOUND_KEY) !== "true"
  ) {
    wroteFile = await bindLocalBackupFile({ showStatus: false });
  }

  const synced = await backupTextEditsToServer();
  if (!wroteFile) {
    wroteFile = await writeBoundBackupFile();
  }

  if (!synced && !wroteFile) {
    exportLocalBackupFile({ showStatus: false });
    wroteFile = true;
  }

  markTextChangesSaved();
  showSaveStatus(getSaveStatusMessage(synced, wroteFile));
  disableTextEditing();
}

async function bindLocalBackupFile({ showStatus = true } = {}) {
  if (!canUseFileBackup()) {
    exportLocalBackupFile({ showStatus });
    if (showStatus) showSaveStatus("浏览器不支持绑定，已导出备份");
    return true;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "text-edits.json",
      types: [
        {
          description: "Text edit backup",
          accept: { "application/json": [".json"] },
        },
      ],
    });

    await saveFileHandle(handle);
    localStorage.setItem(EDIT_FILE_BOUND_KEY, "true");
    fileBackupHandlePromise = Promise.resolve(handle);
    await writeBackupFile(handle);
    if (showStatus) showSaveStatus("已保存并备份");
    return true;
  } catch (error) {
    if (error.name !== "AbortError") {
      if (showStatus) showSaveStatus("备份失败");
    }
    return false;
  }
}

async function writeBoundBackupFile() {
  if (!canUseFileBackup()) return false;

  try {
    const handle = await getSavedFileHandle();
    if (!handle) return false;

    await writeBackupFile(handle);
    return true;
  } catch {
    return false;
  }
}

async function writeBackupFile(handle) {
  const permission = await verifyFilePermission(handle);
  if (!permission) {
    throw new Error("No permission to write backup file.");
  }

  const writable = await handle.createWritable();
  await writable.write(`${JSON.stringify(getBackupPayload(), null, 2)}\n`);
  await writable.close();
}

async function verifyFilePermission(handle) {
  const options = { mode: "readwrite" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

async function getSavedFileHandle() {
  if (!fileBackupHandlePromise) {
    fileBackupHandlePromise = readFileHandle();
  }

  return fileBackupHandlePromise;
}

function openFileHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EDIT_FILE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(EDIT_FILE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveFileHandle(handle) {
  const db = await openFileHandleDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EDIT_FILE_STORE_NAME, "readwrite");
    transaction.objectStore(EDIT_FILE_STORE_NAME).put(handle, EDIT_FILE_HANDLE_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function readFileHandle() {
  const db = await openFileHandleDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EDIT_FILE_STORE_NAME, "readonly");
    const request = transaction.objectStore(EDIT_FILE_STORE_NAME).get(EDIT_FILE_HANDLE_KEY);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

function exportLocalBackupFile({ showStatus = true } = {}) {
  const blob = new Blob([`${JSON.stringify(getBackupPayload(), null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "text-edits.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  markTextChangesSaved();
  if (showStatus) showSaveStatus("已导出备份");
}

async function hydrateEditsFromServer() {
  if (!canUseRemoteBackup()) return;

  try {
    const response = await fetch(EDIT_BACKUP_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return;

    const payload = await response.json();
    const serverEdits = payload?.edits;
    if (!serverEdits || typeof serverEdits !== "object") return;

    hasRemoteBackupServer = true;
    setStoredEdits({ ...getStoredEdits(), ...serverEdits });
    applyStoredEdits();
    initializeToc();
  } catch {
    hasRemoteBackupServer = false;
  }
}

function applyStoredEdits() {
  const edits = getStoredEdits();

  editableElements.forEach((element) => {
    const editPath = getElementPath(element);
    element.dataset.editableText = "true";
    element.dataset.editPath = editPath;

    if (Object.prototype.hasOwnProperty.call(edits, editPath)) {
      element.textContent = edits[editPath];
    }
  });
}

function isOwnerUnlocked() {
  return sessionStorage.getItem(EDIT_SESSION_KEY) === "true";
}

async function hashText(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function openEditLock() {
  editLock.classList.add("open");
  editLock.setAttribute("aria-hidden", "false");
  editLockError.hidden = true;
  editLockInput.value = "";
  window.setTimeout(() => editLockInput.focus(), 0);
}

function closeEditLock() {
  editLock.classList.remove("open");
  editLock.setAttribute("aria-hidden", "true");
  editLockError.hidden = true;
}

function enableTextEditing() {
  isEditingText = true;
  hasUnsavedTextChanges = false;
  document.body.classList.add("text-editing");
  editToolbar.hidden = false;

  editableElements.forEach((element) => {
    element.setAttribute("contenteditable", "true");
    element.setAttribute("spellcheck", "false");
  });
}

function disableTextEditing() {
  isEditingText = false;
  document.body.classList.remove("text-editing");
  editToolbar.hidden = true;

  editableElements.forEach((element) => {
    element.removeAttribute("contenteditable");
    element.removeAttribute("spellcheck");
  });
}

function toggleTextEditing() {
  if (!isOwnerUnlocked()) {
    openEditLock();
    return;
  }

  if (isEditingText) {
    requestExitTextEditing();
  } else {
    enableTextEditing();
  }
}

function requestExitTextEditing() {
  if (
    hasUnsavedTextChanges &&
    !window.confirm("你有修改还没有点暂存或保存并备份，确定要退出编辑模式吗？")
  ) {
    return false;
  }

  disableTextEditing();
  return true;
}

function setupPresentationPen() {
  if (penCanvas) return;

  penCanvas = document.createElement("canvas");
  penCanvas.className = "presentation-pen-canvas";
  penCanvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(penCanvas);
  penContext = penCanvas.getContext("2d");

  resizePresentationPen();
  window.addEventListener("resize", resizePresentationPen);
  penCanvas.addEventListener("pointerdown", startPresentationLine);
  penCanvas.addEventListener("pointermove", continuePresentationLine);
  penCanvas.addEventListener("pointerup", stopPresentationLine);
  penCanvas.addEventListener("pointercancel", stopPresentationLine);
}

function resizePresentationPen() {
  if (!penCanvas) return;

  const scale = window.devicePixelRatio || 1;
  penCanvas.width = Math.round(window.innerWidth * scale);
  penCanvas.height = Math.round(window.innerHeight * scale);
  penCanvas.style.width = `${window.innerWidth}px`;
  penCanvas.style.height = `${window.innerHeight}px`;
  penContext.setTransform(scale, 0, 0, scale, 0, 0);
  renderPresentationPen();
}

function getPresentationPoint(event) {
  return {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  };
}

function startPresentationLine(event) {
  if (!isPresentationPenActive || event.button !== 0) return;

  event.preventDefault();
  penCanvas.setPointerCapture(event.pointerId);
  isDrawingWithPen = true;

  const startPoint = getPresentationPoint(event);
  penCurrentStroke = {
    points: [startPoint],
    updatedAt: startPoint.time,
  };
  penStrokes.push(penCurrentStroke);
  requestPresentationPenFrame();
}

function appendPresentationPoint(point) {
  if (!penCurrentStroke) return;

  const points = penCurrentStroke.points;
  const lastPoint = points[points.length - 1];
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);

  if (distance < 0.5) return;

  points.push(point);
  penCurrentStroke.updatedAt = point.time;
}

function continuePresentationLine(event) {
  if (!isDrawingWithPen || !penCurrentStroke) return;

  event.preventDefault();
  const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
  events.forEach((pointerEvent) => {
    appendPresentationPoint(getPresentationPoint(pointerEvent));
  });
  requestPresentationPenFrame();
}

function stopPresentationLine(event) {
  if (!isDrawingWithPen) return;

  isDrawingWithPen = false;
  penCurrentStroke = null;

  if (penCanvas.hasPointerCapture(event.pointerId)) {
    penCanvas.releasePointerCapture(event.pointerId);
  }
}

function drawPresentationStroke(stroke) {
  const { points } = stroke;

  if (points.length === 1) {
    penContext.beginPath();
    penContext.arc(points[0].x, points[0].y, PEN_LINE_WIDTH / 2, 0, Math.PI * 2);
    penContext.fill();
    return;
  }

  penContext.beginPath();
  penContext.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    penContext.lineTo(points[1].x, points[1].y);
  } else {
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midPoint = {
        x: (current.x + next.x) / 2,
        y: (current.y + next.y) / 2,
      };
      penContext.quadraticCurveTo(current.x, current.y, midPoint.x, midPoint.y);
    }

    const lastPoint = points[points.length - 1];
    penContext.lineTo(lastPoint.x, lastPoint.y);
  }

  penContext.stroke();
}

function renderPresentationPen() {
  if (!penContext || !penCanvas) return;

  penAnimationFrame = null;
  const now = performance.now();
  penContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  penStrokes = penStrokes.filter((stroke) => now - stroke.updatedAt < PEN_FADE_MS);

  penStrokes.forEach((stroke) => {
    const age = now - stroke.updatedAt;
    const opacity = Math.max(0, 1 - age / PEN_FADE_MS);

    penContext.save();
    penContext.globalAlpha = opacity;
    penContext.lineWidth = PEN_LINE_WIDTH;
    penContext.lineCap = "round";
    penContext.lineJoin = "round";
    penContext.shadowColor = "rgba(233, 71, 43, 0.42)";
    penContext.shadowBlur = 10;
    penContext.strokeStyle = "#e9472b";
    penContext.fillStyle = "#e9472b";
    drawPresentationStroke(stroke);
    penContext.restore();
  });

  if (penStrokes.length) {
    requestPresentationPenFrame();
  }
}

function requestPresentationPenFrame() {
  if (penAnimationFrame) return;
  penAnimationFrame = window.requestAnimationFrame(renderPresentationPen);
}

function enablePresentationPen() {
  if (isEditingText && !requestExitTextEditing()) return;
  setupPresentationPen();
  isPresentationPenActive = true;
  document.body.classList.add("presentation-pen-active");
}

function disablePresentationPen() {
  isPresentationPenActive = false;
  isDrawingWithPen = false;
  penCurrentStroke = null;
  document.body.classList.remove("presentation-pen-active");
}

function togglePresentationPen() {
  if (isPresentationPenActive) {
    disablePresentationPen();
  } else {
    enablePresentationPen();
  }
}

async function resetTextEdits() {
  if (!window.confirm("确定要清除本机保存的所有文本修改，并以当前 HTML 文件内容为准吗？")) {
    return;
  }

  localStorage.removeItem(EDIT_STORAGE_KEY);
  await clearRemoteBackup();
  window.location.reload();
}

async function clearRemoteBackup() {
  if (!canUseRemoteBackup()) return false;

  try {
    const response = await fetch(EDIT_BACKUP_ENDPOINT, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}

applyStoredEdits();
initializeToc();
hydrateEditsFromServer();

editableElements.forEach((element) => {
  element.addEventListener("input", () => {
    hasUnsavedTextChanges = true;
    saveElementText(element);
  });
  element.addEventListener("blur", () => saveElementText(element));
  element.addEventListener("click", (event) => {
    if (isEditingText && element.closest("a")) {
      event.preventDefault();
    }
  });
});

editLockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const typedHash = await hashText(editLockInput.value);

  if (typedHash !== EDIT_PASSWORD_HASH) {
    editLockError.hidden = false;
    editLockInput.select();
    return;
  }

  sessionStorage.setItem(EDIT_SESSION_KEY, "true");
  closeEditLock();
  enableTextEditing();
});

editLock.addEventListener("click", (event) => {
  if (event.target === editLock) closeEditLock();
});

editLock.querySelector("[data-edit-action='cancel']").addEventListener("click", closeEditLock);

editToolbar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-action]");
  const action = button?.dataset.editAction;
  if (!action) return;

  if (action === "save") {
    temporarilySaveTextEdits();
  }

  if (action === "bind-backup") {
    saveAndBackupTextEdits();
  }

  if (action === "export-backup") {
    exportLocalBackupFile();
  }

  if (action === "reset") {
    resetTextEdits();
  }

  if (action === "exit") {
    requestExitTextEditing();
  }
});

const lightbox = document.querySelector(".lightbox");
const lightboxImage = lightbox.querySelector("img");
const lightboxCaption = lightbox.querySelector("p");
const closeButton = lightbox.querySelector(".lightbox-close");

document.querySelectorAll(".phone-gallery figure, .topic-gallery figure, .wide-shot").forEach((figure) => {
  figure.addEventListener("click", () => {
    if (figure.querySelector("a")) return;

    const image = figure.querySelector("img");
    if (!image) return;

    lightboxImage.src = image.src;
    lightboxImage.alt = image.alt;
    lightboxCaption.textContent = image.alt;
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
  });
});

function closeLightbox() {
  lightbox.classList.remove("open");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImage.removeAttribute("src");
}

closeButton.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (event) => {
  const isTyping = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
  const isEditableTarget = event.target.isContentEditable;

  if (
    event.key.toLowerCase() === "p" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isTyping &&
    !isEditableTarget
  ) {
    event.preventDefault();
    togglePresentationPen();
    return;
  }

  if (
    event.key.toLowerCase() === "a" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isTyping &&
    !isEditableTarget &&
    isPresentationPenActive
  ) {
    event.preventDefault();
    disablePresentationPen();
    return;
  }

  if (
    event.key.toLowerCase() === "e" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isTyping &&
    !isEditableTarget
  ) {
    event.preventDefault();
    toggleTextEditing();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && isEditingText) {
    event.preventDefault();
    temporarilySaveTextEdits();
  }

  if (event.key === "Escape" && lightbox.classList.contains("open")) {
    closeLightbox();
    return;
  }

  if (event.key === "Escape" && editLock.classList.contains("open")) {
    closeEditLock();
    return;
  }

  if (event.key === "Escape" && isEditingText) {
    requestExitTextEditing();
    return;
  }

  if (event.key === "Escape" && isPresentationPenActive) {
    disablePresentationPen();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (hasUnsavedTextChanges) {
    event.preventDefault();
    event.returnValue = "";
    return "";
  }
});
