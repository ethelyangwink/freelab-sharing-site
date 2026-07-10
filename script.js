const tocLinks = Array.from(document.querySelectorAll(".toc a"));
const EDIT_PASSWORD_HASH =
  "071994fef2777c29ed99ac8814073493c4fdd81ebbf0d36024862184f1cadb51";
const EDIT_STORAGE_KEY = "freelab-text-edits-v1";
const EDIT_SESSION_KEY = "freelab-owner-unlocked";
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
const editableElements = Array.from(document.querySelectorAll(EDITABLE_SELECTOR))
  .filter((element) => !element.closest(".edit-toolbar, .edit-lock, .lightbox"))
  .filter((element) => !element.querySelector(EDITABLE_SELECTOR));
let isEditingText = false;

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
  edits[element.dataset.editPath] = element.textContent;
  setStoredEdits(edits);
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
    disableTextEditing();
  } else {
    enableTextEditing();
  }
}

function resetTextEdits() {
  if (!window.confirm("确定要清除本机保存的所有文本修改，并恢复 HTML 原文吗？")) {
    return;
  }

  localStorage.removeItem(EDIT_STORAGE_KEY);
  window.location.reload();
}

applyStoredEdits();

editableElements.forEach((element) => {
  element.addEventListener("input", () => saveElementText(element));
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
  const action = event.target.dataset.editAction;
  if (!action) return;

  if (action === "save") {
    editableElements.forEach(saveElementText);
  }

  if (action === "reset") {
    resetTextEdits();
  }

  if (action === "exit") {
    disableTextEditing();
  }
});

const lightbox = document.querySelector(".lightbox");
const lightboxImage = lightbox.querySelector("img");
const lightboxCaption = lightbox.querySelector("p");
const closeButton = lightbox.querySelector(".lightbox-close");

document.querySelectorAll(".phone-gallery figure, .wide-shot").forEach((figure) => {
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
    editableElements.forEach(saveElementText);
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
    disableTextEditing();
  }
});
