/* ============================================================
   Grok Gallery Manager — Content Script
   Injected on grok.com and x.com/grok
   ============================================================ */

(() => {
  "use strict";

  // Prevent double-injection
  if (window.__grokGalleryLoaded) return;
  window.__grokGalleryLoaded = true;

  // ── State ──────────────────────────────────────────────────
  const state = {
    items: [],            // [{id, url, thumbUrl, type, prompt, downloaded, element}]
    selected: new Set(),
    filter: "all",        // all | images | videos | new
    gridCols: 3,
    sidecarOpen: false,
    lightboxIndex: -1,
    settingsOpen: false,
    showBadges: true,
    downloadedUrls: {},
    scanning: false,
  };

  // Minimum dimensions to filter out icons/avatars/emojis
  const MIN_DIMENSION = 100;

  // ── SVG Icons ──────────────────────────────────────────────
  const ICONS = {
    grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
    open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    chevLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
    chevRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
    selectAll: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>`,
  };

  // ── Initialization ─────────────────────────────────────────
  async function init() {
    await loadSettings();
    injectUI();
    setupMutationObserver();
    setupMessageListener();
    // Initial scan after a brief delay for page to load
    setTimeout(() => scanForMedia(), 1500);
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get([
      "downloadedUrls",
      "showBadges",
      "gridCols",
    ]);
    state.downloadedUrls = data.downloadedUrls || {};
    if (data.showBadges !== undefined) state.showBadges = data.showBadges;
    if (data.gridCols !== undefined) state.gridCols = data.gridCols;
  }

  // ── Message Listener ───────────────────────────────────────
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "TOGGLE_SIDECAR") {
        toggleSidecar();
      }
    });
  }

  /* ============================================================
     MEDIA DETECTION
     ============================================================ */

  /**
   * Scan the DOM for images and videos.
   * Uses broad, resilient selectors.
   */
  function scanForMedia() {
    if (state.scanning) return;
    state.scanning = true;
    updateScanButton();

    const existingUrls = new Set(state.items.map((i) => i.url));
    const newItems = [];

    // ── Scan <img> elements ──────────────────────────────────
    document.querySelectorAll("img").forEach((img) => {
      const url = upgradeImageUrl(img.src);
      if (!url || existingUrls.has(url)) return;
      if (isSmallOrFiltered(img)) return;

      // Check for generated image patterns:
      // - Images from twimg.com media endpoints
      // - Images in message/response containers
      // - Large images that aren't UI elements
      if (!isLikelyGeneratedMedia(img, url)) return;

      existingUrls.add(url);
      newItems.push({
        id: generateId(),
        url,
        thumbUrl: img.src,
        type: "image",
        prompt: extractPrompt(img),
        downloaded: !!state.downloadedUrls[url],
        element: img,
      });
    });

    // ── Scan <video> elements ────────────────────────────────
    document.querySelectorAll("video").forEach((video) => {
      const url = video.src || video.querySelector("source")?.src;
      if (!url || existingUrls.has(url)) return;

      existingUrls.add(url);
      newItems.push({
        id: generateId(),
        url,
        thumbUrl: video.poster || url,
        type: "video",
        prompt: extractPrompt(video),
        downloaded: !!state.downloadedUrls[url],
        element: video,
      });
    });

    // ── Also check for background images in likely containers ─
    document
      .querySelectorAll('[style*="background-image"]')
      .forEach((el) => {
        const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        if (!match) return;
        const url = upgradeImageUrl(match[1]);
        if (!url || existingUrls.has(url)) return;
        if (!isLikelyGeneratedMedia(el, url)) return;

        existingUrls.add(url);
        newItems.push({
          id: generateId(),
          url,
          thumbUrl: match[1],
          type: "image",
          prompt: extractPrompt(el),
          downloaded: !!state.downloadedUrls[url],
          element: el,
        });
      });

    if (newItems.length > 0) {
      state.items.push(...newItems);
      renderGallery();
      flashMessage(`Found ${newItems.length} new item${newItems.length > 1 ? "s" : ""}`);
    }

    state.scanning = false;
    updateScanButton();
    updateStatusBar();
  }

  /**
   * Upgrade Twitter/X image URLs to highest resolution.
   */
  function upgradeImageUrl(src) {
    if (!src) return null;
    try {
      const url = new URL(src);
      if (url.hostname.includes("twimg.com") && url.pathname.includes("/media")) {
        url.searchParams.set("name", "orig");
        return url.href;
      }
      return src;
    } catch {
      return src;
    }
  }

  /**
   * Check if an element is too small (icons, avatars, emojis).
   */
  function isSmallOrFiltered(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_DIMENSION || rect.height < MIN_DIMENSION) return true;

    // Also filter by natural dimensions for images
    if (el.tagName === "IMG" && el.naturalWidth && el.naturalHeight) {
      if (el.naturalWidth < MIN_DIMENSION || el.naturalHeight < MIN_DIMENSION) return true;
    }

    return false;
  }

  /**
   * Determine if an image is likely AI-generated content vs UI chrome.
   * Uses multiple heuristics — intentionally broad to catch most generated media.
   *
   * TUNING POINT: This function will need adjustment against the live DOM.
   */
  function isLikelyGeneratedMedia(el, url) {
    // Strong signals: twimg.com media URLs (generated images are served from here)
    if (/pbs\.twimg\.com\/media/i.test(url)) return true;
    if (/video\.twimg\.com/i.test(url)) return true;

    // xAI CDN images
    if (/\.xai\.com/i.test(url)) return true;

    // Grok-hosted images
    if (/grok\.com.*\/(image|media|generate)/i.test(url)) return true;

    // Check if the image is inside a message/response container
    // Grok uses various container patterns — try several
    const container = el.closest(
      [
        '[class*="message"]',
        '[class*="response"]',
        '[class*="answer"]',
        '[class*="conversation"]',
        '[class*="chat"]',
        '[data-testid*="message"]',
        '[data-testid*="response"]',
        '[role="article"]',
        "article",
      ].join(",")
    );
    if (container) {
      // Further confirm: is this a large image in a message?
      const rect = el.getBoundingClientRect();
      if (rect.width >= 200 && rect.height >= 200) return true;
    }

    // Large standalone images on the page (likely gallery/preview)
    const rect = el.getBoundingClientRect();
    if (rect.width >= 300 && rect.height >= 300) return true;

    // Data URLs and blob URLs that are large enough
    if ((url.startsWith("data:") || url.startsWith("blob:")) && rect.width >= 200) return true;

    return false;
  }

  /* ============================================================
     PROMPT EXTRACTION
     Walk backwards through the DOM to find the user's prompt.

     TUNING POINT: These selectors target Grok's conversation
     structure. They use broad matching and will need adjustment
     against the live site.
     ============================================================ */

  function extractPrompt(mediaElement) {
    // Strategy 1: Check alt text / title attributes
    const alt = mediaElement.getAttribute("alt") || mediaElement.getAttribute("title");
    if (alt && alt.length > 10 && !isGenericAlt(alt)) return alt;

    // Strategy 2: Walk up to the message container, then find the preceding user message
    const prompt = findPrecedingUserMessage(mediaElement);
    if (prompt) return prompt;

    // Strategy 3: Check aria-label on ancestors
    let parent = mediaElement.parentElement;
    for (let i = 0; i < 10 && parent; i++) {
      const label = parent.getAttribute("aria-label");
      if (label && label.length > 10) return label;
      parent = parent.parentElement;
    }

    // Strategy 4: Check nearby text content within the same container
    const nearbyText = findNearbyText(mediaElement);
    if (nearbyText) return nearbyText;

    return "";
  }

  function isGenericAlt(text) {
    const lower = text.toLowerCase();
    return (
      lower === "image" ||
      lower === "photo" ||
      lower === "picture" ||
      lower === "media" ||
      lower === "uploaded image" ||
      /^img_?\d+/i.test(text)
    );
  }

  /**
   * Find the assistant response container, then look for the preceding user message.
   *
   * Grok's conversation is typically structured as:
   *   [user message container]
   *   [assistant message container (contains the image)]
   *
   * We walk up from the media element to find the response boundary,
   * then look at the previous sibling or previous element for user text.
   */
  function findPrecedingUserMessage(el) {
    // Try to find a message-level container
    const messageSelectors = [
      '[class*="message"]',
      '[class*="response"]',
      '[class*="turn"]',
      '[class*="bubble"]',
      '[data-testid*="message"]',
      '[data-testid*="turn"]',
      '[role="article"]',
      '[role="row"]',
      '[role="listitem"]',
      "article",
    ];

    let messageContainer = null;
    for (const sel of messageSelectors) {
      messageContainer = el.closest(sel);
      if (messageContainer) break;
    }

    if (!messageContainer) {
      // Fallback: walk up until we find a container with siblings
      messageContainer = el;
      for (let i = 0; i < 15; i++) {
        if (
          messageContainer.parentElement &&
          messageContainer.parentElement.children.length > 1
        ) {
          break;
        }
        messageContainer = messageContainer.parentElement;
        if (!messageContainer) return null;
      }
    }

    // Now look at the previous sibling(s) for user text
    let prev = messageContainer.previousElementSibling;
    for (let i = 0; i < 5 && prev; i++) {
      const text = extractTextFromElement(prev);
      if (text && text.length > 5) return text;
      prev = prev.previousElementSibling;
    }

    return null;
  }

  /**
   * Extract meaningful text from an element, cleaning up whitespace.
   */
  function extractTextFromElement(el) {
    // Look for text in common text containers
    const textEls = el.querySelectorAll("p, span, div, h1, h2, h3, h4");
    let longestText = "";

    // First try the direct text content of the element
    const directText = el.textContent?.trim();
    if (directText && directText.length > longestText.length && directText.length < 2000) {
      longestText = directText;
    }

    // Then look in child elements for a more precise match
    for (const te of textEls) {
      const t = te.textContent?.trim();
      if (t && t.length > 10 && t.length < 1000) {
        // Prefer longer, more descriptive text
        if (t.length > longestText.length || longestText.length > 500) {
          longestText = t;
        }
      }
    }

    return longestText
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500); // Cap at 500 chars
  }

  /**
   * Find nearby text in the same container as the media element.
   */
  function findNearbyText(el) {
    let parent = el.parentElement;
    for (let depth = 0; depth < 5 && parent; depth++) {
      // Look for text nodes or text elements near the media
      for (const child of parent.children) {
        if (child === el || child.contains(el)) continue;
        const text = child.textContent?.trim();
        if (text && text.length > 10 && text.length < 500) {
          return text.replace(/\s+/g, " ").trim();
        }
      }
      parent = parent.parentElement;
    }
    return null;
  }

  /* ============================================================
     DELETE SUPPORT
     Find and click Grok's native delete buttons.

     TUNING POINT: Delete button detection will need adjustment
     against the live site.
     ============================================================ */

  /**
   * Attempt to delete a media item using Grok's native UI.
   */
  async function deleteItem(item) {
    const el = item.element;
    if (!el || !el.isConnected) {
      flashMessage("Element no longer in DOM. Try scrolling to make it visible.");
      return false;
    }

    // Strategy 1: Look for a delete/trash button near the media element
    const deleteBtn = findDeleteButton(el);
    if (deleteBtn) {
      deleteBtn.click();
      // Wait for confirmation dialog
      await sleep(500);
      const confirmBtn = findConfirmButton();
      if (confirmBtn) {
        confirmBtn.click();
        await sleep(300);
      }
      removeItemFromState(item.id);
      return true;
    }

    // Strategy 2: Look for a three-dot menu near the element
    const menuBtn = findMenuButton(el);
    if (menuBtn) {
      menuBtn.click();
      await sleep(400);
      // Now look for delete option in the opened menu
      const deleteOption = findDeleteInMenu();
      if (deleteOption) {
        deleteOption.click();
        await sleep(500);
        const confirmBtn = findConfirmButton();
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(300);
        }
        removeItemFromState(item.id);
        return true;
      }
    }

    flashMessage("Delete button not found. Scroll to make the item visible and try again.");
    return false;
  }

  /**
   * Search for a delete/trash button near a media element.
   */
  function findDeleteButton(el) {
    // Walk up the DOM looking for buttons with delete-related attributes
    let container = el;
    for (let i = 0; i < 10 && container; i++) {
      // Check all buttons within this container
      const buttons = container.querySelectorAll("button, [role='button']");
      for (const btn of buttons) {
        const label = (
          btn.getAttribute("aria-label") ||
          btn.getAttribute("title") ||
          btn.textContent ||
          ""
        ).toLowerCase();

        if (
          label.includes("delete") ||
          label.includes("remove") ||
          label.includes("trash")
        ) {
          return btn;
        }

        // Check for trash SVG icons
        const svg = btn.querySelector("svg");
        if (svg) {
          const path = svg.innerHTML.toLowerCase();
          // Common trash icon path patterns
          if (
            path.includes("m19 6") || // Standard trash icon
            path.includes("delete") ||
            path.includes("trash")
          ) {
            return btn;
          }
        }
      }
      container = container.parentElement;
    }
    return null;
  }

  /**
   * Search for a three-dot / more options menu button near a media element.
   */
  function findMenuButton(el) {
    let container = el;
    for (let i = 0; i < 10 && container; i++) {
      const buttons = container.querySelectorAll("button, [role='button']");
      for (const btn of buttons) {
        const label = (
          btn.getAttribute("aria-label") ||
          btn.getAttribute("title") ||
          btn.textContent ||
          ""
        ).toLowerCase();

        if (
          label.includes("more") ||
          label.includes("menu") ||
          label.includes("option") ||
          label.includes("...") ||
          label === "⋮" ||
          label === "⋯"
        ) {
          return btn;
        }

        // Check for three-dot SVG (circles or ellipsis pattern)
        const svg = btn.querySelector("svg");
        if (svg) {
          const circles = svg.querySelectorAll("circle");
          if (circles.length === 3) return btn; // three-dot menu
        }
      }
      container = container.parentElement;
    }
    return null;
  }

  /**
   * Find a delete option in an opened dropdown/popover menu.
   */
  function findDeleteInMenu() {
    // Look for recently-appeared menus/popovers
    const menuSelectors = [
      '[role="menu"]',
      '[role="listbox"]',
      '[class*="dropdown"]',
      '[class*="popover"]',
      '[class*="menu"]',
      '[data-testid*="menu"]',
    ];

    for (const sel of menuSelectors) {
      const menus = document.querySelectorAll(sel);
      for (const menu of menus) {
        const items = menu.querySelectorAll(
          '[role="menuitem"], button, [role="option"], div[tabindex], li'
        );
        for (const item of items) {
          const text = (
            item.textContent ||
            item.getAttribute("aria-label") ||
            ""
          ).toLowerCase();
          if (text.includes("delete") || text.includes("remove")) {
            return item;
          }
        }
      }
    }
    return null;
  }

  /**
   * Find a confirmation button in a dialog.
   */
  function findConfirmButton() {
    const dialogs = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="dialog"]'
    );
    for (const dialog of dialogs) {
      const buttons = dialog.querySelectorAll("button");
      for (const btn of buttons) {
        const text = (btn.textContent || "").toLowerCase();
        if (
          text.includes("delete") ||
          text.includes("confirm") ||
          text.includes("yes") ||
          text.includes("ok")
        ) {
          return btn;
        }
      }
    }
    return null;
  }

  function removeItemFromState(id) {
    state.items = state.items.filter((i) => i.id !== id);
    state.selected.delete(id);
    renderGallery();
    updateStatusBar();
  }

  /* ============================================================
     UI INJECTION
     ============================================================ */

  function injectUI() {
    // ── FAB Button ───────────────────────────────────────────
    const fab = document.createElement("button");
    fab.className = "gg-fab";
    fab.innerHTML = ICONS.grid;
    fab.title = "Toggle Grok Gallery";
    fab.addEventListener("click", toggleSidecar);
    document.body.appendChild(fab);

    // ── Sidecar Panel ────────────────────────────────────────
    const sidecar = document.createElement("div");
    sidecar.className = "gg-sidecar";
    sidecar.innerHTML = buildSidecarHTML();
    document.body.appendChild(sidecar);

    // ── Lightbox ─────────────────────────────────────────────
    const lightbox = document.createElement("div");
    lightbox.className = "gg-lightbox";
    lightbox.id = "gg-lightbox";
    lightbox.innerHTML = buildLightboxHTML();
    document.body.appendChild(lightbox);

    // Bind events
    bindSidecarEvents();
    bindLightboxEvents();
    bindKeyboardEvents();
  }

  function buildSidecarHTML() {
    return `
      <div class="gg-header">
        <div class="gg-header-left">
          <div class="gg-header-logo">G</div>
          <span class="gg-header-title">Grok Gallery</span>
        </div>
        <div class="gg-header-actions">
          <button class="gg-icon-btn gg-scan-btn" id="gg-scan-btn" title="Rescan page">
            ${ICONS.refresh}
          </button>
          <button class="gg-icon-btn" id="gg-settings-btn" title="Settings">
            ${ICONS.settings}
          </button>
          <button class="gg-icon-btn" id="gg-close-btn" title="Close">
            ${ICONS.close}
          </button>
        </div>
      </div>

      <div class="gg-toolbar">
        <div class="gg-filters">
          <button class="gg-filter-btn gg-active" data-filter="all">All</button>
          <button class="gg-filter-btn" data-filter="images">Images</button>
          <button class="gg-filter-btn" data-filter="videos">Videos</button>
          <button class="gg-filter-btn" data-filter="new">New</button>
        </div>
        <div class="gg-grid-sizes">
          <button class="gg-grid-btn" data-cols="2">2</button>
          <button class="gg-grid-btn gg-active" data-cols="3">3</button>
          <button class="gg-grid-btn" data-cols="4">4</button>
        </div>
      </div>

      <div class="gg-bulk-bar" id="gg-bulk-bar">
        <span class="gg-bulk-count" id="gg-bulk-count">0 selected</span>
        <div class="gg-bulk-actions">
          <button class="gg-bulk-btn" id="gg-select-all">Select All</button>
          <button class="gg-bulk-btn" id="gg-deselect-all">Deselect</button>
          <button class="gg-bulk-btn" id="gg-bulk-download">${ICONS.download} DL</button>
          <button class="gg-bulk-btn gg-danger" id="gg-bulk-delete">${ICONS.trash} Del</button>
        </div>
      </div>

      <div class="gg-gallery gg-cols-${state.gridCols}" id="gg-gallery"></div>

      <div class="gg-settings" id="gg-settings">
        <h3>Settings</h3>
        <div class="gg-setting-row">
          <div>
            <div class="gg-setting-label">Download badges</div>
            <div class="gg-setting-desc">Show green checkmarks on downloaded items</div>
          </div>
          <label class="gg-toggle">
            <input type="checkbox" id="gg-toggle-badges" ${state.showBadges ? "checked" : ""}>
            <span class="gg-toggle-slider"></span>
          </label>
        </div>
        <button class="gg-settings-btn gg-danger" id="gg-clear-history">
          Clear Download History
        </button>
        <button class="gg-settings-btn" id="gg-back-to-gallery" style="margin-top:8px;">
          &larr; Back to Gallery
        </button>
      </div>

      <div class="gg-status-bar" id="gg-status-bar">
        <span id="gg-status-text">0 items</span>
        <span id="gg-flash"></span>
      </div>
    `;
  }

  function buildLightboxHTML() {
    return `
      <button class="gg-lightbox-close" id="gg-lb-close">${ICONS.close}</button>
      <button class="gg-lightbox-nav gg-lightbox-prev" id="gg-lb-prev">${ICONS.chevLeft}</button>
      <button class="gg-lightbox-nav gg-lightbox-next" id="gg-lb-next">${ICONS.chevRight}</button>
      <div class="gg-lightbox-content" id="gg-lb-content">
        <img class="gg-lightbox-media" id="gg-lb-media" src="" alt="">
        <div class="gg-lightbox-info">
          <div class="gg-lightbox-prompt-label">Prompt</div>
          <div class="gg-lightbox-prompt-text" id="gg-lb-prompt">—</div>
          <div class="gg-lightbox-actions">
            <button class="gg-lb-btn" id="gg-lb-download">${ICONS.download} Download</button>
            <button class="gg-lb-btn" id="gg-lb-copy">${ICONS.copy} Copy Prompt</button>
            <button class="gg-lb-btn" id="gg-lb-open">${ICONS.open} Open</button>
            <button class="gg-lb-btn gg-danger" id="gg-lb-delete">${ICONS.trash} Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  /* ============================================================
     EVENT BINDING
     ============================================================ */

  function bindSidecarEvents() {
    // Close button
    document.getElementById("gg-close-btn").addEventListener("click", toggleSidecar);

    // Scan button
    document.getElementById("gg-scan-btn").addEventListener("click", scanForMedia);

    // Settings button
    document.getElementById("gg-settings-btn").addEventListener("click", () => {
      state.settingsOpen = !state.settingsOpen;
      document.getElementById("gg-settings").classList.toggle("gg-open", state.settingsOpen);
      document.getElementById("gg-gallery").style.display = state.settingsOpen ? "none" : "";
    });

    // Filter buttons
    document.querySelectorAll(".gg-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.dataset.filter;
        document.querySelectorAll(".gg-filter-btn").forEach((b) => b.classList.remove("gg-active"));
        btn.classList.add("gg-active");
        renderGallery();
      });
    });

    // Grid size buttons
    document.querySelectorAll(".gg-grid-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.gridCols = parseInt(btn.dataset.cols);
        document.querySelectorAll(".gg-grid-btn").forEach((b) => b.classList.remove("gg-active"));
        btn.classList.add("gg-active");
        const gallery = document.getElementById("gg-gallery");
        gallery.className = `gg-gallery gg-cols-${state.gridCols}`;
        chrome.storage.local.set({ gridCols: state.gridCols });
      });
    });

    // Bulk actions
    document.getElementById("gg-select-all").addEventListener("click", selectAll);
    document.getElementById("gg-deselect-all").addEventListener("click", deselectAll);
    document.getElementById("gg-bulk-download").addEventListener("click", bulkDownload);
    document.getElementById("gg-bulk-delete").addEventListener("click", bulkDelete);

    // Settings toggles
    document.getElementById("gg-toggle-badges").addEventListener("change", (e) => {
      state.showBadges = e.target.checked;
      chrome.storage.local.set({ showBadges: state.showBadges });
      renderGallery();
    });

    document.getElementById("gg-clear-history").addEventListener("click", async () => {
      await chrome.storage.local.set({ downloadedUrls: {} });
      state.downloadedUrls = {};
      state.items.forEach((i) => (i.downloaded = false));
      renderGallery();
      flashMessage("Download history cleared");
    });

    document.getElementById("gg-back-to-gallery").addEventListener("click", () => {
      state.settingsOpen = false;
      document.getElementById("gg-settings").classList.remove("gg-open");
      document.getElementById("gg-gallery").style.display = "";
    });
  }

  function bindLightboxEvents() {
    document.getElementById("gg-lb-close").addEventListener("click", closeLightbox);
    document.getElementById("gg-lb-prev").addEventListener("click", () => navigateLightbox(-1));
    document.getElementById("gg-lb-next").addEventListener("click", () => navigateLightbox(1));
    document.getElementById("gg-lb-download").addEventListener("click", () => {
      const item = getFilteredItems()[state.lightboxIndex];
      if (item) downloadItem(item);
    });
    document.getElementById("gg-lb-copy").addEventListener("click", () => {
      const item = getFilteredItems()[state.lightboxIndex];
      if (item?.prompt) {
        navigator.clipboard.writeText(item.prompt);
        flashMessage("Prompt copied!");
      }
    });
    document.getElementById("gg-lb-open").addEventListener("click", () => {
      const item = getFilteredItems()[state.lightboxIndex];
      if (item) window.open(item.url, "_blank");
    });
    document.getElementById("gg-lb-delete").addEventListener("click", async () => {
      const item = getFilteredItems()[state.lightboxIndex];
      if (item) {
        await deleteItem(item);
        closeLightbox();
      }
    });

    // Click outside to close lightbox
    document.getElementById("gg-lightbox").addEventListener("click", (e) => {
      if (e.target.id === "gg-lightbox") closeLightbox();
    });
  }

  function bindKeyboardEvents() {
    document.addEventListener("keydown", (e) => {
      // Don't intercept when typing in input fields
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

      const lightboxOpen = document.getElementById("gg-lightbox").classList.contains("gg-open");

      if (e.key === "Escape") {
        if (lightboxOpen) {
          closeLightbox();
        } else if (state.sidecarOpen) {
          toggleSidecar();
        }
        return;
      }

      if (lightboxOpen) {
        if (e.key === "ArrowLeft") navigateLightbox(-1);
        if (e.key === "ArrowRight") navigateLightbox(1);
      }
    });
  }

  /* ============================================================
     GALLERY RENDERING
     ============================================================ */

  function getFilteredItems() {
    return state.items.filter((item) => {
      if (state.filter === "images" && item.type !== "image") return false;
      if (state.filter === "videos" && item.type !== "video") return false;
      if (state.filter === "new" && item.downloaded) return false;
      return true;
    });
  }

  function renderGallery() {
    const gallery = document.getElementById("gg-gallery");
    if (!gallery) return;

    const items = getFilteredItems();

    if (items.length === 0) {
      gallery.innerHTML = `
        <div class="gg-empty">
          <div class="gg-empty-icon">${ICONS.grid}</div>
          <div class="gg-empty-text">
            ${state.items.length === 0
              ? "No media detected yet.<br>Generate some images on Grok and click Rescan."
              : "No items match this filter."
            }
          </div>
        </div>
      `;
      return;
    }

    gallery.innerHTML = items.map((item, index) => buildCardHTML(item, index)).join("");

    // Bind card events
    gallery.querySelectorAll(".gg-card").forEach((card) => {
      const id = card.dataset.id;
      const idx = parseInt(card.dataset.index);

      // Click to open lightbox
      card.addEventListener("click", (e) => {
        if (e.target.closest(".gg-card-action") || e.target.closest(".gg-card-check")) return;
        openLightbox(idx);
      });

      // Checkbox toggle
      card.querySelector(".gg-card-check")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSelection(id);
      });

      // Download button
      card.querySelector(".gg-action-dl")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = state.items.find((i) => i.id === id);
        if (item) downloadItem(item);
      });

      // Delete button
      card.querySelector(".gg-action-del")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = state.items.find((i) => i.id === id);
        if (item) deleteItem(item);
      });
    });

    updateBulkBar();
    updateStatusBar();
  }

  function buildCardHTML(item, index) {
    const isSelected = state.selected.has(item.id);
    const promptSnippet = item.prompt
      ? item.prompt.slice(0, 80) + (item.prompt.length > 80 ? "..." : "")
      : "";

    const thumbContent = item.type === "video"
      ? `<video class="gg-card-thumb" src="${escapeAttr(item.thumbUrl)}" muted preload="metadata"></video>`
      : `<img class="gg-card-thumb" src="${escapeAttr(item.thumbUrl)}" loading="lazy" alt="">`;

    return `
      <div class="gg-card ${isSelected ? "gg-selected" : ""}" data-id="${item.id}" data-index="${index}">
        ${thumbContent}
        ${item.type === "video" ? '<span class="gg-card-video-badge">VIDEO</span>' : ""}
        <div class="gg-card-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="gg-card-overlay">
          <button class="gg-card-action gg-action-dl" title="Download">${ICONS.download}</button>
          <button class="gg-card-action gg-action-del" title="Delete">${ICONS.trash}</button>
        </div>
        ${state.showBadges && item.downloaded ? '<div class="gg-downloaded-badge">✓</div>' : ""}
        ${promptSnippet ? `<div class="gg-card-prompt">${escapeHTML(promptSnippet)}</div>` : ""}
      </div>
    `;
  }

  /* ============================================================
     LIGHTBOX
     ============================================================ */

  function openLightbox(index) {
    state.lightboxIndex = index;
    updateLightboxContent();
    document.getElementById("gg-lightbox").classList.add("gg-open");
  }

  function closeLightbox() {
    state.lightboxIndex = -1;
    document.getElementById("gg-lightbox").classList.remove("gg-open");
  }

  function navigateLightbox(dir) {
    const items = getFilteredItems();
    if (items.length === 0) return;
    state.lightboxIndex = (state.lightboxIndex + dir + items.length) % items.length;
    updateLightboxContent();
  }

  function updateLightboxContent() {
    const items = getFilteredItems();
    const item = items[state.lightboxIndex];
    if (!item) return;

    const media = document.getElementById("gg-lb-media");
    const contentArea = document.getElementById("gg-lb-content");

    // Replace the media element based on type
    const oldMedia = contentArea.querySelector(".gg-lightbox-media");
    if (item.type === "video") {
      const video = document.createElement("video");
      video.className = "gg-lightbox-media";
      video.src = item.url;
      video.controls = true;
      video.autoplay = true;
      video.muted = true;
      oldMedia.replaceWith(video);
    } else {
      const img = document.createElement("img");
      img.className = "gg-lightbox-media";
      img.src = item.url;
      img.alt = item.prompt || "";
      oldMedia.replaceWith(img);
    }

    document.getElementById("gg-lb-prompt").textContent = item.prompt || "No prompt detected";
  }

  /* ============================================================
     SELECTION & BULK ACTIONS
     ============================================================ */

  function toggleSelection(id) {
    if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      state.selected.add(id);
    }
    renderGallery();
  }

  function selectAll() {
    getFilteredItems().forEach((item) => state.selected.add(item.id));
    renderGallery();
  }

  function deselectAll() {
    state.selected.clear();
    renderGallery();
  }

  function updateBulkBar() {
    const bar = document.getElementById("gg-bulk-bar");
    const count = state.selected.size;
    bar.classList.toggle("gg-visible", count > 0);
    document.getElementById("gg-bulk-count").textContent =
      `${count} selected`;
  }

  async function bulkDownload() {
    const selectedItems = state.items.filter((i) => state.selected.has(i.id));
    if (selectedItems.length === 0) return;

    const items = selectedItems.map((item, idx) => ({
      url: item.url,
      filename: generateFilename(item, idx),
      prompt: item.prompt,
    }));

    try {
      const response = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_BATCH",
        items,
      });

      if (response.success) {
        selectedItems.forEach((item) => {
          item.downloaded = true;
          state.downloadedUrls[item.url] = Date.now();
        });
        flashMessage(`Downloaded ${response.count} items`);
        deselectAll();
      } else {
        flashMessage(`Download error: ${response.error}`);
      }
    } catch (err) {
      flashMessage(`Download failed: ${err.message}`);
    }
  }

  async function bulkDelete() {
    const selectedItems = state.items.filter((i) => state.selected.has(i.id));
    if (selectedItems.length === 0) return;

    let deleted = 0;
    for (const item of selectedItems) {
      const success = await deleteItem(item);
      if (success) deleted++;
    }
    state.selected.clear();
    flashMessage(`Deleted ${deleted} of ${selectedItems.length} items`);
    renderGallery();
  }

  /* ============================================================
     DOWNLOAD
     ============================================================ */

  async function downloadItem(item) {
    const filename = generateFilename(item, 0);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_SINGLE",
        url: item.url,
        filename,
        prompt: item.prompt,
      });

      if (response.success) {
        item.downloaded = true;
        state.downloadedUrls[item.url] = Date.now();
        renderGallery();
        flashMessage("Downloaded!");
      } else {
        flashMessage(`Download error: ${response.error}`);
      }
    } catch (err) {
      flashMessage(`Download failed: ${err.message}`);
    }
  }

  function generateFilename(item, index) {
    const ext = item.type === "video" ? "mp4" : guessExtension(item.url);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const promptSlug = item.prompt
      ? "_" +
        item.prompt
          .slice(0, 40)
          .replace(/[^a-zA-Z0-9]+/g, "_")
          .replace(/_+$/, "")
      : "";
    return `grok_${timestamp}${promptSlug}.${ext}`;
  }

  function guessExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|mp4)$/i);
      if (match) return match[1].toLowerCase();
    } catch {}
    return "jpg";
  }

  /* ============================================================
     SIDECAR TOGGLE
     ============================================================ */

  function toggleSidecar() {
    state.sidecarOpen = !state.sidecarOpen;
    document.querySelector(".gg-sidecar").classList.toggle("gg-open", state.sidecarOpen);
    document.querySelector(".gg-fab").classList.toggle("gg-open", state.sidecarOpen);

    if (state.sidecarOpen) {
      // Scan when opening
      scanForMedia();
    }
  }

  /* ============================================================
     MUTATION OBSERVER
     Watch for dynamically loaded content.
     ============================================================ */

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let hasNewMedia = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (
            node.tagName === "IMG" ||
            node.tagName === "VIDEO" ||
            node.querySelector?.("img, video")
          ) {
            hasNewMedia = true;
            break;
          }
        }
        if (hasNewMedia) break;
      }

      if (hasNewMedia && state.sidecarOpen) {
        // Debounce: wait for batch of mutations to settle
        clearTimeout(state._scanTimeout);
        state._scanTimeout = setTimeout(() => scanForMedia(), 800);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /* ============================================================
     STATUS & HELPERS
     ============================================================ */

  function updateStatusBar() {
    const text = document.getElementById("gg-status-text");
    if (!text) return;
    const filtered = getFilteredItems();
    const dlCount = state.items.filter((i) => i.downloaded).length;
    text.textContent = `${filtered.length} item${filtered.length !== 1 ? "s" : ""} · ${dlCount} downloaded`;
  }

  function updateScanButton() {
    const btn = document.getElementById("gg-scan-btn");
    if (btn) btn.classList.toggle("gg-scanning", state.scanning);
  }

  function flashMessage(msg) {
    const el = document.getElementById("gg-flash");
    if (!el) return;
    el.textContent = msg;
    el.className = "gg-flash";
    // Restart animation
    void el.offsetWidth;
    el.className = "gg-flash";
  }

  function generateId() {
    return "gg_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Start ──────────────────────────────────────────────────
  init();
})();
