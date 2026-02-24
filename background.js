/* ============================================================
   Grok Gallery Manager — Background Service Worker
   ============================================================ */

// ── Message handler ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "DOWNLOAD_SINGLE":
      handleDownloadSingle(msg, sendResponse);
      return true;

    case "GET_STATUS":
      handleGetStatus(sendResponse);
      return true;

    case "TOGGLE_SIDECAR":
      handleToggleSidecar(sender, msg, sendResponse);
      return true;

    case "CLEAR_DOWNLOAD_HISTORY":
      handleClearDownloadHistory(sendResponse);
      return true;

    case "CLEAR_ALL_HISTORY":
      handleClearAllHistory(sendResponse);
      return true;

    default:
      return false;
  }
});

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
      const promptText = prompt.length > 4000 ? prompt.slice(0, 4000) : prompt;
      const promptDataUri =
        "data:text/plain;charset=utf-8," + encodeURIComponent(promptText);
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
  const activeTab = tabs?.[0];
  const isGrokPage =
    activeTab?.url && (
      activeTab.url.includes("grok.com") ||
      activeTab.url.match(/x\.com\/i\/grok/) ||
      activeTab.url.match(/x\.com\/grok/)
    );

  sendResponse({ downloadCount, isGrokPage, tabId: activeTab?.id });
}

// ── Toggle sidecar from popup ──────────────────────────────────
async function handleToggleSidecar(sender, msg, sendResponse) {
  const tabId = msg.tabId;
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "TOGGLE_SIDECAR" });
      sendResponse({ success: true });
    } catch {
      sendResponse({ success: false, error: "Content script not ready" });
    }
  } else {
    sendResponse({ success: false });
  }
}

// ── Clear GrokGallery entries from Chrome download history ─────
async function handleClearDownloadHistory(sendResponse) {
  try {
    const items = await chrome.downloads.search({ filenameRegex: "GrokGallery" });
    for (const item of items) {
      await chrome.downloads.erase({ id: item.id });
    }
    sendResponse({ success: true, count: items.length });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// ── Clear ALL Grok Imagine history (downloads + browser history) ──
async function handleClearAllHistory(sendResponse) {
  try {
    // 1. Clear Chrome download entries matching GrokGallery
    const dlItems = await chrome.downloads.search({ filenameRegex: "GrokGallery" });
    for (const item of dlItems) {
      await chrome.downloads.erase({ id: item.id });
    }

    // 2. Clear browser history for grok.com/imagine URLs
    let historyCount = 0;
    const grokHistory = await chrome.history.search({
      text: "grok.com/imagine",
      startTime: 0,
      maxResults: 10000,
    });
    for (const entry of grokHistory) {
      if (entry.url && entry.url.includes("grok.com/imagine")) {
        await chrome.history.deleteUrl({ url: entry.url });
        historyCount++;
      }
    }

    // 3. Also clear x.com/grok history
    const xHistory = await chrome.history.search({
      text: "x.com/grok",
      startTime: 0,
      maxResults: 10000,
    });
    for (const entry of xHistory) {
      if (entry.url && (entry.url.includes("x.com/i/grok") || entry.url.includes("x.com/grok"))) {
        await chrome.history.deleteUrl({ url: entry.url });
        historyCount++;
      }
    }

    sendResponse({
      success: true,
      downloadCount: dlItems.length,
      historyCount,
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
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
          // Erase from download list once complete so it doesn't pollute history
          eraseWhenComplete(downloadId);
          resolve(downloadId);
        }
      }
    );
  });
}

function eraseWhenComplete(downloadId) {
  function onChanged(delta) {
    if (delta.id !== downloadId) return;
    if (delta.state?.current === "complete" || delta.state?.current === "interrupted") {
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.downloads.erase({ id: downloadId });
    }
  }
  chrome.downloads.onChanged.addListener(onChanged);
}

async function markDownloaded(url) {
  const data = await chrome.storage.local.get(["downloadedUrls"]);
  const downloaded = data.downloadedUrls || {};
  downloaded[url] = Date.now();

  // Prune oldest entries if exceeding 5000 to prevent storage bloat
  const keys = Object.keys(downloaded);
  if (keys.length > 5000) {
    const sorted = keys.sort((a, b) => downloaded[a] - downloaded[b]);
    const toRemove = sorted.slice(0, keys.length - 5000);
    for (const k of toRemove) delete downloaded[k];
  }

  await chrome.storage.local.set({ downloadedUrls: downloaded });
}
