/* ============================================================
   Grok Gallery Manager — Background Service Worker
   ============================================================ */

// ── Detected media URLs from network requests ──────────────────
const networkMedia = new Map(); // tabId → Set<url>

// ── Listen for media network requests ──────────────────────────
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const url = details.url;

    const isMedia =
      /\.(jpg|jpeg|png|gif|webp|mp4|m3u8)(\?|$)/i.test(url) ||
      /pbs\.twimg\.com\/media/i.test(url) ||
      /video\.twimg\.com/i.test(url) ||
      /ton\.twimg\.com/i.test(url);

    if (!isMedia) return;

    if (!networkMedia.has(details.tabId)) {
      networkMedia.set(details.tabId, new Set());
    }
    networkMedia.get(details.tabId).add(url);
  },
  {
    urls: [
      "https://*.twimg.com/*",
      "https://*.xai.com/*",
      "https://grok.com/*",
    ],
    types: ["image", "media", "xmlhttprequest", "other"],
  }
);

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  networkMedia.delete(tabId);
});

// ── Message handler ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "GET_NETWORK_MEDIA":
      handleGetNetworkMedia(sender, sendResponse);
      return true;

    case "DOWNLOAD_SINGLE":
      handleDownloadSingle(msg, sendResponse);
      return true;

    case "GET_STATUS":
      handleGetStatus(sendResponse);
      return true;

    case "TOGGLE_SIDECAR":
      handleToggleSidecar(sender, msg, sendResponse);
      return true;
  }
});

// ── Get network-detected media for the requesting tab ──────────
function handleGetNetworkMedia(sender, sendResponse) {
  const tabId = sender.tab?.id;
  const urls = tabId && networkMedia.has(tabId)
    ? Array.from(networkMedia.get(tabId))
    : [];
  sendResponse({ urls });
}

// ── Download a single file ─────────────────────────────────────
// msg: { url, filename, folder, mediaType, prompt }
// folder: base folder path e.g. "GrokGallery/2026-02-24"
// mediaType: "image" or "video" — used to put in images/ or videos/ subfolder
async function handleDownloadSingle(msg, sendResponse) {
  try {
    const { url, filename, folder, mediaType, prompt } = msg;

    const subfolder = mediaType === "video" ? "videos" : "images";
    const fullPath = `${folder}/${subfolder}/${filename}`;

    const dlId = await startDownload(url, fullPath);

    if (prompt) {
      const baseName = filename.replace(/\.[^.]+$/, "");
      const promptDataUri =
        "data:text/plain;charset=utf-8," + encodeURIComponent(prompt);
      await startDownload(promptDataUri, `${folder}/${subfolder}/${baseName}_prompt.txt`);
    }

    await markDownloaded(url);

    sendResponse({ success: true, downloadId: dlId });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Get status for popup ───────────────────────────────────────
async function handleGetStatus(sendResponse) {
  const data = await chrome.storage.local.get(["downloadedUrls"]);
  const downloadCount = data.downloadedUrls
    ? Object.keys(data.downloadedUrls).length
    : 0;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  const isGrokPage =
    activeTab &&
    (activeTab.url?.includes("grok.com") ||
      activeTab.url?.match(/x\.com\/i\/grok/) ||
      activeTab.url?.match(/x\.com\/grok/));

  sendResponse({ downloadCount, isGrokPage, tabId: activeTab?.id });
}

// ── Toggle sidecar from popup ──────────────────────────────────
async function handleToggleSidecar(sender, msg, sendResponse) {
  const tabId = msg.tabId;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: "TOGGLE_SIDECAR" });
    sendResponse({ success: true });
  } else {
    sendResponse({ success: false });
  }
}

// ── Helpers ────────────────────────────────────────────────────
function startDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify" },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

async function markDownloaded(url) {
  const data = await chrome.storage.local.get(["downloadedUrls"]);
  const downloaded = data.downloadedUrls || {};
  downloaded[url] = Date.now();
  await chrome.storage.local.set({ downloadedUrls: downloaded });
}
