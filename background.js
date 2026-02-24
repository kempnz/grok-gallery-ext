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

    case "DOWNLOAD_BATCH":
      handleDownloadBatch(msg, sendResponse);
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
async function handleDownloadSingle(msg, sendResponse) {
  try {
    const { url, filename, prompt } = msg;

    // Download the media file
    const dlId = await startDownload(url, `GrokGallery/${filename}`);

    // If a prompt is provided, save a sidecar _prompt.txt
    if (prompt) {
      const baseName = filename.replace(/\.[^.]+$/, "");
      const promptBlob = new Blob([prompt], { type: "text/plain" });
      const promptUrl = URL.createObjectURL(promptBlob);
      // We can't use blob URLs in MV3 service worker downloads easily,
      // so we encode as data URI instead
      const promptDataUri =
        "data:text/plain;charset=utf-8," + encodeURIComponent(prompt);
      await startDownload(promptDataUri, `GrokGallery/${baseName}_prompt.txt`);
    }

    // Track the download
    await markDownloaded(url);

    sendResponse({ success: true, downloadId: dlId });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Download a batch of files ──────────────────────────────────
async function handleDownloadBatch(msg, sendResponse) {
  try {
    const { items } = msg; // [{url, filename, prompt}]
    const prompts = [];

    for (const item of items) {
      await startDownload(item.url, `GrokGallery/${item.filename}`);

      if (item.prompt) {
        const baseName = item.filename.replace(/\.[^.]+$/, "");
        const promptDataUri =
          "data:text/plain;charset=utf-8," +
          encodeURIComponent(item.prompt);
        await startDownload(
          promptDataUri,
          `GrokGallery/${baseName}_prompt.txt`
        );
        prompts.push(`## ${item.filename}\n${item.prompt}`);
      }

      await markDownloaded(item.url);
    }

    // Generate combined prompts.txt manifest
    if (prompts.length > 0) {
      const manifest = prompts.join("\n\n---\n\n");
      const manifestUri =
        "data:text/plain;charset=utf-8," + encodeURIComponent(manifest);
      await startDownload(manifestUri, "GrokGallery/prompts.txt");
    }

    sendResponse({ success: true, count: items.length });
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

  // Find active Grok tab
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
