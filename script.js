const tocLinks = Array.from(document.querySelectorAll(".toc a"));
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

const sections = tocLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!visible) return;

    tocLinks.forEach((link) => {
      link.classList.toggle(
        "active",
        link.getAttribute("href") === `#${visible.target.id}`,
      );
    });
  },
  {
    rootMargin: "-18% 0px -68% 0px",
    threshold: [0.1, 0.25, 0.5],
  },
);

sections.forEach((section) => observer.observe(section));

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
const PEN_FADE_MS = 1180;
const PEN_SOLID_MS = 160;
const PEN_LINE_WIDTH = 3.2;
const PEN_MIN_POINT_DISTANCE = 2.4;
const PEN_COLOR = "#e52b1c";
let isPresentationPenActive = false;
let penCanvas = null;
let penContext = null;
let penAnimationFrame = null;
let isDrawingWithPen = false;
let penLastPoint = null;
let penStrokes = [];
let penCurrentStroke = null;

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

function saveElementText(element) {
  const edits = getStoredEdits();
  const editPath = element.dataset.editPath || getElementPath(element);
  element.dataset.editPath = editPath;
  edits[editPath] = element.textContent;
  setStoredEdits(edits);
}

function collectAllTextEdits() {
  const edits = {};

  editableElements.forEach((element) => {
    const editPath = element.dataset.editPath || getElementPath(element);
    element.dataset.editPath = editPath;
    edits[editPath] = element.textContent;
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
  penLastPoint = getPresentationPoint(event);
  penCurrentStroke = {
    points: [penLastPoint],
  };
  penStrokes.push(penCurrentStroke);
  requestPresentationPenFrame();
}

function continuePresentationLine(event) {
  if (!isDrawingWithPen || !penLastPoint || !penCurrentStroke) return;

  event.preventDefault();
  const nextPoint = getPresentationPoint(event);
  if (getPointDistance(penLastPoint, nextPoint) < PEN_MIN_POINT_DISTANCE) return;

  penCurrentStroke.points.push(nextPoint);
  penLastPoint = nextPoint;
  requestPresentationPenFrame();
}

function stopPresentationLine(event) {
  if (!isDrawingWithPen) return;

  const completedStroke = penCurrentStroke;
  isDrawingWithPen = false;
  penLastPoint = null;
  penCurrentStroke = null;
  schedulePenStrokeCleanup(completedStroke);

  if (penCanvas.hasPointerCapture(event.pointerId)) {
    penCanvas.releasePointerCapture(event.pointerId);
  }
}

function clearPresentationPenCanvas() {
  if (!penContext) return;
  penContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

function schedulePenStrokeCleanup(stroke) {
  if (!stroke) return;

  window.setTimeout(() => {
    if (penCurrentStroke === stroke) return;

    stroke.points = [];
    penStrokes = penStrokes.filter((item) => item.points.length);

    if (!penStrokes.length) {
      clearPresentationPenCanvas();
    }
  }, PEN_FADE_MS + 120);
}

function getPointDistance(pointA, pointB) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function getPointFade(point, now) {
  const age = now - point.time;
  if (age <= PEN_SOLID_MS) return 1;
  return Math.max(0, 1 - (age - PEN_SOLID_MS) / (PEN_FADE_MS - PEN_SOLID_MS));
}

function getPointOpacity(point, now) {
  return Math.pow(getPointFade(point, now), 0.82);
}

function getPointLineWidth(point, now) {
  return PEN_LINE_WIDTH * Math.pow(getPointFade(point, now), 1.35);
}

function addPenSegmentToPath(path, points, index) {
  const point0 = points[index - 1] || points[index];
  const point1 = points[index];
  const point2 = points[index + 1];
  const point3 = points[index + 2] || point2;
  const control1 = {
    x: point1.x + (point2.x - point0.x) / 6,
    y: point1.y + (point2.y - point0.y) / 6,
  };
  const control2 = {
    x: point2.x - (point3.x - point1.x) / 6,
    y: point2.y - (point3.y - point1.y) / 6,
  };

  path.bezierCurveTo(
    control1.x,
    control1.y,
    control2.x,
    control2.y,
    point2.x,
    point2.y,
  );
}

function drawPenSegment(points, index, now) {
  const targetPoint = points[index + 1];
  const opacity = getPointOpacity(targetPoint, now);
  const lineWidth = getPointLineWidth(targetPoint, now);
  if (opacity <= 0.02 || lineWidth <= 0.08) return;

  const path = new Path2D();
  path.moveTo(points[index].x, points[index].y);
  addPenSegmentToPath(path, points, index);

  penContext.save();
  penContext.globalAlpha = opacity;
  penContext.lineWidth = lineWidth;
  penContext.lineCap = "butt";
  penContext.lineJoin = "round";
  penContext.strokeStyle = PEN_COLOR;
  penContext.stroke(path);
  penContext.restore();
}

function drawPenEndCaps(points, now) {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  penContext.save();
  penContext.fillStyle = PEN_COLOR;
  [firstPoint, lastPoint].forEach((point) => {
    const radius = getPointLineWidth(point, now) / 2;
    if (radius <= 0.08) return;

    penContext.globalAlpha = getPointOpacity(point, now);
    penContext.beginPath();
    penContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
    penContext.fill();
  });
  penContext.restore();
}

function drawPenDot(point, now) {
  const radius = getPointLineWidth(point, now) / 2;
  if (radius <= 0.08) return;

  penContext.save();
  penContext.globalAlpha = getPointOpacity(point, now);
  penContext.fillStyle = PEN_COLOR;
  penContext.beginPath();
  penContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
  penContext.fill();
  penContext.restore();
}

function drawPenStroke(stroke, now) {
  const points = stroke.points.filter((point) => now - point.time < PEN_FADE_MS);
  stroke.points = points;

  if (points.length === 1) {
    drawPenDot(points[0], now);
    return;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    drawPenSegment(points, index, now);
  }
  drawPenEndCaps(points, now);
}

function renderPresentationPen() {
  if (!penContext || !penCanvas) return;

  penAnimationFrame = null;
  const now = performance.now();
  clearPresentationPenCanvas();
  penStrokes = penStrokes.filter((stroke) =>
    stroke.points.some((point) => now - point.time < PEN_FADE_MS),
  );
  penStrokes.forEach((stroke) => drawPenStroke(stroke, now));

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
  penLastPoint = null;
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

  if (!hasRemoteBackupServer || !navigator.sendBeacon) return;

  const payload = new Blob([JSON.stringify({ edits: collectAllTextEdits() })], {
    type: "application/json",
  });
  navigator.sendBeacon(EDIT_BACKUP_ENDPOINT, payload);
});
