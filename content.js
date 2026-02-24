/* ============================================================
   Grok Gallery Manager — Content Script
   Injected on grok.com and x.com/grok

   Primary data source: Grok REST APIs (fetches all favorites)
   Fallback: DOM scanning for visible media
   ============================================================ */

(() => {
  "use strict";

  // Prevent double-injection
  if (window.__grokGalleryLoaded) return;
  window.__grokGalleryLoaded = true;

  // Preserve console methods before Grok overrides them
  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _error = console.error.bind(console);

  // Debug log that also writes to a visible debug panel in the sidecar
  const debugLines = [];
  function dbg(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    debugLines.push(line);
    _log("[GrokGallery]", msg);
    // Update debug panel if it exists
    const el = document.getElementById("gg-debug-log");
    if (el) el.textContent = debugLines.slice(-30).join("\n");
  }

  // ── State ──────────────────────────────────────────────────
  const state = {
    items: [],            // [{id, url, thumbUrl, type, prompt, downloaded, element, apiId}]
    selected: new Set(),
    filter: "all",        // all | images | videos | new
    gridCols: 3,
    sidecarOpen: false,
    lightboxIndex: -1,
    settingsOpen: false,
    showBadges: true,
    showDebug: false,
    downloadedUrls: {},
    scanning: false,
    apiLoaded: false,     // true once we've fetched from API
  };

  // Minimum dimensions to filter out icons/avatars/emojis (DOM scan only)
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
    api: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  };

  // ── Initialization ─────────────────────────────────────────
  async function init() {
    await loadSettings();
    injectUI();
    setupMutationObserver();
    setupMessageListener();
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
     API-BASED MEDIA FETCHING
     Calls Grok's internal REST APIs to pull all favorites,
     images, and videos without needing to scroll.

     Endpoints discovered:
       POST /rest/media/post/list   — favorited/liked media posts
       GET  /rest/assets            — user's generated assets

     The content script runs same-origin on grok.com, so
     session cookies are sent automatically.
     ============================================================ */

  /**
   * Fetch all media from Grok APIs. This is the primary data source.
   * Falls back to DOM scanning if the API calls fail.
   */
  async function fetchAllMedia() {
    if (state.scanning) return;
    state.scanning = true;
    updateScanButton();
    flashMessage("Fetching from Grok API...");
    dbg("Starting API fetch...");

    const existingUrls = new Set(state.items.map((i) => i.url));
    let totalNew = 0;

    try {
      // Fetch favorites only (assets API doesn't provide direct URLs)
      const favResults = await fetchMediaPosts("MEDIA_POST_SOURCE_LIKED");
      const newItems = favResults.filter((i) => !existingUrls.has(i.url));
      newItems.forEach((i) => existingUrls.add(i.url));
      state.items.push(...newItems);
      totalNew += newItems.length;
      dbg(`Favorites: ${favResults.length} total, ${newItems.length} new`);

      state.apiLoaded = totalNew > 0 || state.apiLoaded;

    } catch (err) {
      dbg(`API fetch error: ${err.message}`);
    }

    // Only do DOM scan if API returned nothing (fallback)
    if (!state.apiLoaded) {
      const domNew = scanDOM(existingUrls);
      totalNew += domNew;
      dbg(`DOM scan (fallback): ${domNew} new items`);
    } else {
      dbg("Skipping DOM scan — API data loaded");
    }

    if (totalNew > 0) {
      flashMessage(`Found ${totalNew} new item${totalNew > 1 ? "s" : ""}`);
    } else if (state.items.length === 0) {
      flashMessage("No media found. Try generating some images first.");
    } else {
      flashMessage("Up to date");
    }

    dbg(`Total items in gallery: ${state.items.length}`);
    renderGallery();
    state.scanning = false;
    updateScanButton();
    updateStatusBar();
  }

  /**
   * Fetch liked/favorited media posts.
   * POST /rest/media/post/list
   *
   * Response structure is logged for debugging — field names may need
   * adjustment after seeing the real response.
   */
  async function fetchMediaPosts(source) {
    const label = source === "MEDIA_POST_SOURCE_LIKED" ? "Favorites" : "UserPosts";
    const allItems = [];
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 10; // safety limit

    while (page < MAX_PAGES) {
      const body = { limit: 40 };
      if (source) body.filter = { source };
      if (cursor) body.cursor = cursor;

      dbg(`${label} page ${page}, cursor: ${cursor || "none"}`);

      const res = await fetch("/rest/media/post/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });

      if (!res.ok) {
        dbg(`${label} API HTTP ${res.status}`);
        throw new Error(`${label} API returned ${res.status}`);
      }

      const data = await res.json();

      // Log response structure
      if (page === 0) {
        const keys = Object.keys(data);
        dbg(`${label} response keys: ${keys.join(", ")}`);
        for (const key of keys) {
          const val = data[key];
          if (Array.isArray(val)) {
            dbg(`  "${key}": Array[${val.length}]${val.length > 0 ? " first item keys: " + Object.keys(val[0]).join(", ") : ""}`);
          } else if (typeof val === "object" && val !== null) {
            dbg(`  "${key}": Object { ${Object.keys(val).join(", ")} }`);
          } else {
            dbg(`  "${key}": ${typeof val} = ${String(val).slice(0, 100)}`);
          }
        }
      }

      // Parse the response — try multiple possible field name patterns
      const posts = extractPostsFromResponse(data);
      dbg(`${label} page ${page}: found ${posts.length} posts in response`);
      if (posts.length === 0) break;

      for (const post of posts) {
        const parsed = parseMediaPost(post);
        allItems.push(...parsed);
      }
      dbg(`${label} page ${page}: parsed ${allItems.length} media items so far`);

      // Look for pagination cursor
      cursor = data.nextCursor || data.cursor || data.next_cursor || data.paginationToken || null;
      dbg(`${label} cursor for next page: ${cursor || "NONE (last page)"}`);
      if (!cursor) break;

      page++;
    }

    dbg(`${label} fetch complete: ${allItems.length} total items`);
    return allItems;
  }

  /**
   * Fetch user assets (generated images).
   * GET /rest/assets
   */
  async function fetchAssets() {
    const allItems = [];
    let cursor = null;
    let page = 0;
    const MAX_PAGES = 50;

    while (page < MAX_PAGES) {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      params.append("mimeTypes", "image/jpeg");
      params.append("mimeTypes", "image/jpg");
      params.append("mimeTypes", "image/png");
      params.append("mimeTypes", "image/webp");
      params.append("mimeTypes", "video/mp4");
      params.set("orderBy", "ORDER_BY_LAST_USE_TIME");
      if (cursor) params.set("pageToken", cursor);

      dbg(`Assets page ${page}, cursor: ${cursor || "none"}`);

      const res = await fetch(`/rest/assets?${params.toString()}`, {
        credentials: "same-origin",
      });

      if (!res.ok) {
        dbg(`Assets API HTTP ${res.status}`);
        throw new Error(`Assets API returned ${res.status}`);
      }

      const data = await res.json();

      if (page === 0) {
        const keys = Object.keys(data);
        dbg(`Assets response keys: ${keys.join(", ")}`);
        for (const key of keys) {
          const val = data[key];
          if (Array.isArray(val)) {
            dbg(`  "${key}": Array[${val.length}]${val.length > 0 ? " first item keys: " + Object.keys(val[0]).join(", ") : ""}`);
          } else if (typeof val === "object" && val !== null) {
            dbg(`  "${key}": Object { ${Object.keys(val).join(", ")} }`);
          } else {
            dbg(`  "${key}": ${typeof val} = ${String(val).slice(0, 100)}`);
          }
        }
      }

      const assets = extractAssetsFromResponse(data);
      dbg(`Assets page ${page}: found ${assets.length} assets in response`);
      if (assets.length === 0) break;

      for (const asset of assets) {
        const parsed = parseAsset(asset);
        if (parsed) allItems.push(parsed);
      }

      cursor = data.nextPageToken || data.cursor || data.nextCursor || data.paginationToken || null;
      dbg(`Assets cursor for next page: ${cursor || "NONE (last page)"}`);
      if (!cursor) break;

      page++;
    }

    dbg(`Assets fetch complete: ${allItems.length} total items`);
    return allItems;
  }

  /* ============================================================
     API RESPONSE PARSERS

     These functions try multiple field name patterns to handle
     unknown response shapes. They log what they find so we can
     refine the parsing.

     TUNING POINT: Update these once we see real responses.
     ============================================================ */

  /**
   * Extract the array of posts from the favorites API response.
   * Tries common field names for the list.
   */
  function extractPostsFromResponse(data) {
    // The response might wrap posts in various field names
    const candidates = [
      data.mediaPosts,
      data.media_posts,
      data.posts,
      data.items,
      data.results,
      data.data,
      data.images,
      data.media,
      data.list,
    ];

    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }

    // Maybe it's a top-level array
    if (Array.isArray(data)) return data;

    // Try to find any array in the top-level keys
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        dbg(`Found posts array in field: "${key}" (${data[key].length} items)`);
        return data[key];
      }
    }

    return [];
  }

  /**
   * Parse a single media post into our item format.
   * A post can have a main mediaUrl AND arrays of images/videos.
   * We return ALL media from the post.
   */
  let _postLogCount = 0;
  function parseMediaPost(post) {
    const results = [];
    const prompt = post.prompt || post.originalPrompt || "";
    const apiId = post.id || null;

    // Log first 3 posts so we can see the actual data
    if (_postLogCount < 3) {
      dbg(`Post #${_postLogCount} mediaUrl: ${post.mediaUrl || "NONE"}`);
      dbg(`Post #${_postLogCount} mediaType: ${post.mediaType || "?"} mimeType: ${post.mimeType || "?"}`);
      dbg(`Post #${_postLogCount} images: ${Array.isArray(post.images) ? JSON.stringify(post.images).slice(0, 300) : "NONE"}`);
      dbg(`Post #${_postLogCount} videos: ${Array.isArray(post.videos) ? JSON.stringify(post.videos).slice(0, 300) : "NONE"}`);
      dbg(`Post #${_postLogCount} prompt: ${(prompt || "").slice(0, 80)}`);
      _postLogCount++;
    }

    // Main mediaUrl
    if (post.mediaUrl) {
      const isVideo = /video/i.test(post.mimeType || post.mediaType || "") ||
        /\.(mp4|m3u8|mov|webm)/i.test(post.mediaUrl);
      const url = upgradeImageUrl(post.mediaUrl);
      results.push({
        id: generateId(),
        apiId,
        url,
        thumbUrl: url,
        type: isVideo ? "video" : "image",
        prompt,
        downloaded: !!state.downloadedUrls[url],
        element: null,
      });
    }

    // images array — grab mediaUrl from each (flat, no recursion)
    if (Array.isArray(post.images)) {
      for (const img of post.images) {
        const imgUrl = typeof img === "string" ? img : (img.mediaUrl || null);
        if (imgUrl) {
          const url = upgradeImageUrl(imgUrl);
          if (!results.some((r) => r.url === url)) {
            results.push({
              id: generateId(),
              apiId: img.id || apiId,
              url,
              thumbUrl: url,
              type: "image",
              prompt: img.prompt || img.originalPrompt || prompt,
              downloaded: !!state.downloadedUrls[url],
              element: null,
            });
          }
        }
      }
    }

    // videos array — grab mediaUrl from each (flat, no recursion)
    if (Array.isArray(post.videos)) {
      for (const vid of post.videos) {
        const vidUrl = typeof vid === "string" ? vid : (vid.mediaUrl || null);
        if (vidUrl) {
          if (!results.some((r) => r.url === vidUrl)) {
            results.push({
              id: generateId(),
              apiId: vid.id || apiId,
              url: vidUrl,
              thumbUrl: vidUrl,
              type: "video",
              prompt: vid.prompt || vid.originalPrompt || prompt,
              downloaded: !!state.downloadedUrls[vidUrl],
              element: null,
            });
          }
        }
      }
    }

    // Skip childPosts — those are other users' remixes, not our content

    return results;
  }

  /**
   * Extract the array of assets from the assets API response.
   */
  function extractAssetsFromResponse(data) {
    const candidates = [
      data.assets,
      data.items,
      data.results,
      data.data,
      data.images,
      data.media,
    ];

    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }

    if (Array.isArray(data)) return data;

    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        dbg(`Found assets array in field: "${key}" (${data[key].length} items)`);
        return data[key];
      }
    }

    return [];
  }

  /**
   * Parse a single asset into our item format.
   * Assets use `key` and `previewImageKey` fields instead of direct URLs.
   * The actual media is served from /rest/assets/content/{key}
   */
  function parseAsset(asset) {
    // Construct URL from key fields — these are storage keys, not direct URLs
    const assetKey = asset.key || asset.previewImageKey;
    const assetId = asset.assetId;

    let url = null;
    if (assetKey) {
      // Try the content endpoint with the storage key
      url = `/rest/assets/content/${encodeURIComponent(assetKey)}`;
    } else if (assetId) {
      url = `/rest/assets/${encodeURIComponent(assetId)}/content`;
    }

    // Also check for any direct URL fields as fallback
    if (!url) {
      url = findMediaUrl(asset);
    }

    if (!url) {
      dbg("Could not find URL in asset. Keys: " + Object.keys(asset).join(", "));
      return null;
    }

    // Make relative URLs absolute
    if (url.startsWith("/")) {
      url = `${location.origin}${url}`;
    }

    const mime = asset.mimeType || "";
    const isVideo = /video/i.test(mime);

    // Use previewImageKey for thumbnail if different from main key
    let thumbUrl = url;
    if (asset.previewImageKey && asset.previewImageKey !== asset.key) {
      thumbUrl = `${location.origin}/rest/assets/content/${encodeURIComponent(asset.previewImageKey)}`;
    }

    const prompt = asset.summary || asset.name || "";

    return {
      id: generateId(),
      apiId: assetId || null,
      url: upgradeImageUrl(url),
      thumbUrl,
      type: isVideo ? "video" : "image",
      prompt,
      downloaded: !!state.downloadedUrls[upgradeImageUrl(url)],
      element: null,
    };
  }

  /**
   * Try to find the media URL in an API object.
   * Handles various possible field names.
   */
  function findMediaUrl(obj) {
    // Direct URL fields
    const urlFields = [
      "url", "imageUrl", "image_url", "mediaUrl", "media_url",
      "src", "source", "downloadUrl", "download_url",
      "originalUrl", "original_url", "fullUrl", "full_url",
      "highResUrl", "high_res_url", "contentUrl", "content_url",
      "fileUrl", "file_url", "uri",
    ];

    for (const field of urlFields) {
      if (obj[field] && typeof obj[field] === "string" && obj[field].startsWith("http")) {
        return obj[field];
      }
    }

    // Nested media object
    const mediaObjects = [obj.media, obj.image, obj.video, obj.file, obj.content, obj.asset];
    for (const nested of mediaObjects) {
      if (nested && typeof nested === "object") {
        for (const field of urlFields) {
          if (nested[field] && typeof nested[field] === "string" && nested[field].startsWith("http")) {
            return nested[field];
          }
        }
      }
    }

    // Array of media (take first)
    const arrayFields = ["media", "images", "urls", "files", "attachments", "mediaUrls", "media_urls"];
    for (const field of arrayFields) {
      if (Array.isArray(obj[field]) && obj[field].length > 0) {
        const first = obj[field][0];
        if (typeof first === "string" && first.startsWith("http")) return first;
        if (typeof first === "object") return findMediaUrl(first);
      }
    }

    // Deep search: look for any string value that looks like a media URL
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string" && /^https?:.*\.(jpg|jpeg|png|webp|gif|mp4|m3u8)/i.test(val)) {
        return val;
      }
    }

    return null;
  }

  /**
   * Try to find a thumbnail URL (lower-res version).
   */
  function findThumbUrl(obj) {
    const thumbFields = [
      "thumbnailUrl", "thumbnail_url", "thumbUrl", "thumb_url",
      "previewUrl", "preview_url", "smallUrl", "small_url",
    ];

    for (const field of thumbFields) {
      if (obj[field] && typeof obj[field] === "string") return obj[field];
    }

    // Check nested objects
    const nested = obj.thumbnail || obj.preview || obj.thumb;
    if (nested) {
      if (typeof nested === "string") return nested;
      if (typeof nested === "object") return nested.url || nested.src || null;
    }

    return null;
  }

  /**
   * Try to find the prompt text in an API object.
   */
  function findPromptInPost(obj) {
    const promptFields = [
      "prompt", "text", "title", "caption", "description",
      "userPrompt", "user_prompt", "query", "input",
      "message", "content",
    ];

    for (const field of promptFields) {
      if (obj[field] && typeof obj[field] === "string" && obj[field].length > 3) {
        return obj[field];
      }
    }

    // Check nested objects
    const nestedObjects = [obj.post, obj.message, obj.conversation, obj.metadata, obj.info];
    for (const nested of nestedObjects) {
      if (nested && typeof nested === "object") {
        for (const field of promptFields) {
          if (nested[field] && typeof nested[field] === "string" && nested[field].length > 3) {
            return nested[field];
          }
        }
      }
    }

    return "";
  }

  /* ============================================================
     DOM-BASED MEDIA SCANNING (fallback / supplement)
     ============================================================ */

  /**
   * Scan the visible DOM for images and videos.
   * Returns the count of new items found.
   */
  function scanDOM(existingUrls) {
    const newItems = [];

    // Scan <img> elements
    document.querySelectorAll("img").forEach((img) => {
      const url = upgradeImageUrl(img.src);
      if (!url || existingUrls.has(url)) return;
      if (isSmallOrFiltered(img)) return;
      if (!isLikelyGeneratedMedia(img, url)) return;

      existingUrls.add(url);
      newItems.push({
        id: generateId(),
        url,
        thumbUrl: img.src,
        type: "image",
        prompt: extractPromptFromDOM(img),
        downloaded: !!state.downloadedUrls[url],
        element: img,
      });
    });

    // Scan <video> elements
    document.querySelectorAll("video").forEach((video) => {
      const url = video.src || video.querySelector("source")?.src;
      if (!url || existingUrls.has(url)) return;

      existingUrls.add(url);
      newItems.push({
        id: generateId(),
        url,
        thumbUrl: video.poster || url,
        type: "video",
        prompt: extractPromptFromDOM(video),
        downloaded: !!state.downloadedUrls[url],
        element: video,
      });
    });

    // Background images in containers
    document.querySelectorAll('[style*="background-image"]').forEach((el) => {
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
        prompt: extractPromptFromDOM(el),
        downloaded: !!state.downloadedUrls[url],
        element: el,
      });
    });

    if (newItems.length > 0) {
      state.items.push(...newItems);
    }

    return newItems.length;
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

  function isSmallOrFiltered(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_DIMENSION || rect.height < MIN_DIMENSION) return true;
    if (el.tagName === "IMG" && el.naturalWidth && el.naturalHeight) {
      if (el.naturalWidth < MIN_DIMENSION || el.naturalHeight < MIN_DIMENSION) return true;
    }
    return false;
  }

  /**
   * TUNING POINT: Heuristics for identifying generated media in the DOM.
   */
  function isLikelyGeneratedMedia(el, url) {
    if (/pbs\.twimg\.com\/media/i.test(url)) return true;
    if (/video\.twimg\.com/i.test(url)) return true;
    if (/\.xai\.com/i.test(url)) return true;
    if (/grok\.com.*\/(image|media|generate)/i.test(url)) return true;

    const container = el.closest(
      [
        '[class*="message"]', '[class*="response"]', '[class*="answer"]',
        '[class*="conversation"]', '[class*="chat"]',
        '[data-testid*="message"]', '[data-testid*="response"]',
        '[role="article"]', "article",
      ].join(",")
    );
    if (container) {
      const rect = el.getBoundingClientRect();
      if (rect.width >= 200 && rect.height >= 200) return true;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width >= 300 && rect.height >= 300) return true;
    if ((url.startsWith("data:") || url.startsWith("blob:")) && rect.width >= 200) return true;

    return false;
  }

  /* ============================================================
     DOM-BASED PROMPT EXTRACTION (for DOM-scanned items)

     TUNING POINT: Selectors need adjustment against live site.
     ============================================================ */

  function extractPromptFromDOM(mediaElement) {
    const alt = mediaElement.getAttribute("alt") || mediaElement.getAttribute("title");
    if (alt && alt.length > 10 && !isGenericAlt(alt)) return alt;

    const prompt = findPrecedingUserMessage(mediaElement);
    if (prompt) return prompt;

    let parent = mediaElement.parentElement;
    for (let i = 0; i < 10 && parent; i++) {
      const label = parent.getAttribute("aria-label");
      if (label && label.length > 10) return label;
      parent = parent.parentElement;
    }

    const nearbyText = findNearbyText(mediaElement);
    if (nearbyText) return nearbyText;

    return "";
  }

  function isGenericAlt(text) {
    const lower = text.toLowerCase();
    return (
      lower === "image" || lower === "photo" || lower === "picture" ||
      lower === "media" || lower === "uploaded image" || /^img_?\d+/i.test(text)
    );
  }

  function findPrecedingUserMessage(el) {
    const messageSelectors = [
      '[class*="message"]', '[class*="response"]', '[class*="turn"]',
      '[class*="bubble"]', '[data-testid*="message"]', '[data-testid*="turn"]',
      '[role="article"]', '[role="row"]', '[role="listitem"]', "article",
    ];

    let messageContainer = null;
    for (const sel of messageSelectors) {
      messageContainer = el.closest(sel);
      if (messageContainer) break;
    }

    if (!messageContainer) {
      messageContainer = el;
      for (let i = 0; i < 15; i++) {
        if (messageContainer.parentElement && messageContainer.parentElement.children.length > 1) break;
        messageContainer = messageContainer.parentElement;
        if (!messageContainer) return null;
      }
    }

    let prev = messageContainer.previousElementSibling;
    for (let i = 0; i < 5 && prev; i++) {
      const text = extractTextFromElement(prev);
      if (text && text.length > 5) return text;
      prev = prev.previousElementSibling;
    }

    return null;
  }

  function extractTextFromElement(el) {
    const textEls = el.querySelectorAll("p, span, div, h1, h2, h3, h4");
    let longestText = "";
    const directText = el.textContent?.trim();
    if (directText && directText.length > longestText.length && directText.length < 2000) {
      longestText = directText;
    }
    for (const te of textEls) {
      const t = te.textContent?.trim();
      if (t && t.length > 10 && t.length < 1000) {
        if (t.length > longestText.length || longestText.length > 500) longestText = t;
      }
    }
    return longestText.replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function findNearbyText(el) {
    let parent = el.parentElement;
    for (let depth = 0; depth < 5 && parent; depth++) {
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

     TUNING POINT: Delete button detection needs live site tuning.
     ============================================================ */

  async function deleteItem(item) {
    // Try API-based delete first (unlike the post)
    if (item.apiId) {
      const apiOk = await apiDeletePost(item.apiId);
      if (apiOk) {
        removeItemFromState(item.id);
        return true;
      }
      dbg(`API delete failed for ${item.apiId}, trying DOM fallback...`);
    }

    // For API-sourced items without a DOM element and no API delete
    if (!item.element || !item.element.isConnected) {
      // Just remove from gallery state — can't delete from Grok without DOM or API
      removeItemFromState(item.id);
      return true;
    }

    const el = item.element;

    const deleteBtn = findDeleteButton(el);
    if (deleteBtn) {
      deleteBtn.click();
      await sleep(500);
      const confirmBtn = findConfirmButton();
      if (confirmBtn) {
        confirmBtn.click();
        await sleep(300);
      }
      removeItemFromState(item.id);
      return true;
    }

    const menuBtn = findMenuButton(el);
    if (menuBtn) {
      menuBtn.click();
      await sleep(400);
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

    // Last resort: just remove from gallery
    removeItemFromState(item.id);
    return true;
  }

  /**
   * Try to unlike/delete a post via the Grok API.
   * Attempts multiple known endpoint patterns.
   */
  async function apiDeletePost(postId) {
    const endpoints = [
      { url: `/rest/media/post/${postId}/like`, method: "DELETE" },
      { url: `/rest/media/post/unlike`, method: "POST", body: { postId } },
      { url: `/rest/media/post/${postId}`, method: "DELETE" },
    ];

    for (const ep of endpoints) {
      try {
        const opts = {
          method: ep.method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        };
        if (ep.body) opts.body = JSON.stringify(ep.body);

        const res = await fetch(ep.url, opts);
        if (res.ok || res.status === 204) {
          dbg(`API delete success: ${ep.method} ${ep.url}`);
          return true;
        }
        dbg(`API delete ${ep.method} ${ep.url} → ${res.status}`);
      } catch (err) {
        dbg(`API delete error: ${ep.url} — ${err.message}`);
      }
    }
    return false;
  }

  function findDeleteButton(el) {
    let container = el;
    for (let i = 0; i < 10 && container; i++) {
      const buttons = container.querySelectorAll("button, [role='button']");
      for (const btn of buttons) {
        const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || btn.textContent || "").toLowerCase();
        if (label.includes("delete") || label.includes("remove") || label.includes("trash")) return btn;
        const svg = btn.querySelector("svg");
        if (svg) {
          const path = svg.innerHTML.toLowerCase();
          if (path.includes("m19 6") || path.includes("delete") || path.includes("trash")) return btn;
        }
      }
      container = container.parentElement;
    }
    return null;
  }

  function findMenuButton(el) {
    let container = el;
    for (let i = 0; i < 10 && container; i++) {
      const buttons = container.querySelectorAll("button, [role='button']");
      for (const btn of buttons) {
        const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || btn.textContent || "").toLowerCase();
        if (label.includes("more") || label.includes("menu") || label.includes("option") || label.includes("...") || label === "\u22EE" || label === "\u22EF") return btn;
        const svg = btn.querySelector("svg");
        if (svg && svg.querySelectorAll("circle").length === 3) return btn;
      }
      container = container.parentElement;
    }
    return null;
  }

  function findDeleteInMenu() {
    const menuSelectors = ['[role="menu"]', '[role="listbox"]', '[class*="dropdown"]', '[class*="popover"]', '[class*="menu"]', '[data-testid*="menu"]'];
    for (const sel of menuSelectors) {
      for (const menu of document.querySelectorAll(sel)) {
        for (const item of menu.querySelectorAll('[role="menuitem"], button, [role="option"], div[tabindex], li')) {
          const text = (item.textContent || item.getAttribute("aria-label") || "").toLowerCase();
          if (text.includes("delete") || text.includes("remove")) return item;
        }
      }
    }
    return null;
  }

  function findConfirmButton() {
    for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="dialog"]')) {
      for (const btn of dialog.querySelectorAll("button")) {
        const text = (btn.textContent || "").toLowerCase();
        if (text.includes("delete") || text.includes("confirm") || text.includes("yes") || text.includes("ok")) return btn;
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
    // FAB Button
    const fab = document.createElement("button");
    fab.className = "gg-fab";
    fab.innerHTML = ICONS.grid;
    fab.title = "Toggle Grok Gallery";
    fab.addEventListener("click", toggleSidecar);
    document.body.appendChild(fab);

    // Sidecar Panel
    const sidecar = document.createElement("div");
    sidecar.className = "gg-sidecar";
    sidecar.innerHTML = buildSidecarHTML();
    document.body.appendChild(sidecar);

    // Lightbox
    const lightbox = document.createElement("div");
    lightbox.className = "gg-lightbox";
    lightbox.id = "gg-lightbox";
    lightbox.innerHTML = buildLightboxHTML();
    document.body.appendChild(lightbox);

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
          <button class="gg-icon-btn gg-scan-btn" id="gg-scan-btn" title="Fetch all media">
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
          <button class="gg-grid-btn" data-cols="2" title="Large grid"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/></svg></button>
          <button class="gg-grid-btn gg-active" data-cols="3" title="Medium grid"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="0.5" y="0.5" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="6" y="0.5" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="11.5" y="0.5" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="0.5" y="6" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="6" y="6" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="11.5" y="6" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="0.5" y="11.5" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="6" y="11.5" width="4" height="4" rx="0.5" fill="currentColor"/><rect x="11.5" y="11.5" width="4" height="4" rx="0.5" fill="currentColor"/></svg></button>
          <button class="gg-grid-btn" data-cols="4" title="Small grid"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="0.5" y="0.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="4.5" y="0.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="8.5" y="0.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="12.5" y="0.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="0.5" y="4.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="4.5" y="4.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="8.5" y="4.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="12.5" y="4.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="0.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="4.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="8.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="12.5" y="8.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="0.5" y="12.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="4.5" y="12.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="8.5" y="12.5" width="3" height="3" rx="0.5" fill="currentColor"/><rect x="12.5" y="12.5" width="3" height="3" rx="0.5" fill="currentColor"/></svg></button>
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

      <div class="gg-download-bar" id="gg-download-bar">
        <button class="gg-dl-all-btn" id="gg-dl-all-images">${ICONS.download} All Images</button>
        <button class="gg-dl-all-btn" id="gg-dl-all-videos">${ICONS.download} All Videos</button>
        <button class="gg-dl-all-btn" id="gg-dl-all">${ICONS.download} All</button>
      </div>
      <div class="gg-download-bar" id="gg-delete-bar">
        <button class="gg-dl-all-btn gg-del-all-btn" id="gg-del-downloaded">${ICONS.trash} Downloaded</button>
        <button class="gg-dl-all-btn gg-del-all-btn" id="gg-del-all">${ICONS.trash} Delete All</button>
      </div>
      <div class="gg-progress-bar" id="gg-progress-bar" style="display:none;">
        <div class="gg-progress-text" id="gg-progress-text">Downloading...</div>
        <div class="gg-progress-track"><div class="gg-progress-fill" id="gg-progress-fill"></div></div>
        <button class="gg-bulk-btn" id="gg-cancel-download">Cancel</button>
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
        <button class="gg-settings-btn" id="gg-toggle-debug" style="margin-top:8px;">
          Show Debug Log
        </button>
        <pre id="gg-debug-log" style="display:none; margin-top:8px; padding:8px; background:#0a0a14; border:1px solid #1e1e2e; border-radius:6px; font-size:10px; color:#0f0; max-height:300px; overflow-y:auto; white-space:pre-wrap; word-break:break-all; font-family:monospace;"></pre>
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
          <div class="gg-lightbox-prompt-text" id="gg-lb-prompt">&mdash;</div>
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
    document.getElementById("gg-close-btn").addEventListener("click", toggleSidecar);
    document.getElementById("gg-scan-btn").addEventListener("click", fetchAllMedia);

    document.getElementById("gg-settings-btn").addEventListener("click", () => {
      state.settingsOpen = !state.settingsOpen;
      document.getElementById("gg-settings").classList.toggle("gg-open", state.settingsOpen);
      document.getElementById("gg-gallery").style.display = state.settingsOpen ? "none" : "";
    });

    document.querySelectorAll(".gg-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.dataset.filter;
        document.querySelectorAll(".gg-filter-btn").forEach((b) => b.classList.remove("gg-active"));
        btn.classList.add("gg-active");
        renderGallery();
      });
    });

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

    document.getElementById("gg-select-all").addEventListener("click", selectAll);
    document.getElementById("gg-deselect-all").addEventListener("click", deselectAll);
    document.getElementById("gg-bulk-download").addEventListener("click", bulkDownload);
    document.getElementById("gg-bulk-delete").addEventListener("click", bulkDelete);

    // Download all buttons
    document.getElementById("gg-dl-all-images").addEventListener("click", () => downloadAllByType("images"));
    document.getElementById("gg-dl-all-videos").addEventListener("click", () => downloadAllByType("videos"));
    document.getElementById("gg-dl-all").addEventListener("click", () => downloadAllByType("all"));
    document.getElementById("gg-cancel-download").addEventListener("click", () => { _downloadCancelled = true; });

    // Delete buttons
    document.getElementById("gg-del-downloaded").addEventListener("click", () => deleteAllByFilter("downloaded"));
    document.getElementById("gg-del-all").addEventListener("click", () => deleteAllByFilter("all"));

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

    document.getElementById("gg-toggle-debug").addEventListener("click", () => {
      const log = document.getElementById("gg-debug-log");
      const visible = log.style.display !== "none";
      log.style.display = visible ? "none" : "block";
      log.textContent = debugLines.slice(-30).join("\n");
      document.getElementById("gg-toggle-debug").textContent = visible ? "Show Debug Log" : "Hide Debug Log";
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

    document.getElementById("gg-lightbox").addEventListener("click", (e) => {
      if (e.target.id === "gg-lightbox") closeLightbox();
    });
  }

  function bindKeyboardEvents() {
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      const lightboxOpen = document.getElementById("gg-lightbox").classList.contains("gg-open");

      if (e.key === "Escape") {
        if (lightboxOpen) closeLightbox();
        else if (state.sidecarOpen) toggleSidecar();
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

  const RENDER_BATCH = 30; // render this many at a time

  function renderGallery() {
    const gallery = document.getElementById("gg-gallery");
    if (!gallery) return;

    state._renderPage = 0;
    const items = getFilteredItems();

    if (items.length === 0) {
      gallery.innerHTML = `
        <div class="gg-empty">
          <div class="gg-empty-icon">${ICONS.grid}</div>
          <div class="gg-empty-text">
            ${state.items.length === 0
              ? "No media found yet.<br>Open the panel and click refresh to fetch your favorites."
              : "No items match this filter."
            }
          </div>
        </div>
      `;
      return;
    }

    // Render first batch
    const batch = items.slice(0, RENDER_BATCH);
    gallery.innerHTML = batch.map((item, index) => buildCardHTML(item, index)).join("");
    if (items.length > RENDER_BATCH) {
      gallery.insertAdjacentHTML("beforeend",
        `<button class="gg-load-more" id="gg-load-more">Load more (${items.length - RENDER_BATCH} remaining)</button>`
      );
      document.getElementById("gg-load-more").addEventListener("click", () => loadMoreCards());
    }

    bindCardEvents(gallery);
  }

  function loadMoreCards() {
    const gallery = document.getElementById("gg-gallery");
    if (!gallery) return;
    state._renderPage = (state._renderPage || 0) + 1;
    const items = getFilteredItems();
    const start = (state._renderPage + 1) * RENDER_BATCH;

    // Remove old load-more button
    document.getElementById("gg-load-more")?.remove();

    // No items left? Bail.
    if (start >= items.length) return;

    const batch = items.slice(start, start + RENDER_BATCH);
    const html = batch.map((item, index) => buildCardHTML(item, start + index)).join("");
    gallery.insertAdjacentHTML("beforeend", html);

    if (start + RENDER_BATCH < items.length) {
      gallery.insertAdjacentHTML("beforeend",
        `<button class="gg-load-more" id="gg-load-more">Load more (${items.length - start - RENDER_BATCH} remaining)</button>`
      );
      document.getElementById("gg-load-more").addEventListener("click", () => loadMoreCards());
    }

    bindCardEvents(gallery);
  }

  function bindCardEvents(gallery) {
    gallery.querySelectorAll(".gg-card:not([data-bound])").forEach((card) => {
      card.setAttribute("data-bound", "1");
      const id = card.dataset.id;
      const idx = parseInt(card.dataset.index);

      card.addEventListener("click", (e) => {
        if (e.target.closest(".gg-card-action") || e.target.closest(".gg-card-check")) return;
        openLightbox(idx);
      });

      card.querySelector(".gg-card-check")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSelection(id);
      });

      card.querySelector(".gg-action-dl")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = state.items.find((i) => i.id === id);
        if (item) downloadItem(item);
      });

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
      ? `<div class="gg-card-thumb gg-video-thumb"><video src="${escapeAttr(item.thumbUrl)}" muted preload="metadata" style="width:100%!important;height:100%!important;position:absolute!important;top:0!important;left:0!important;object-fit:cover!important;"></video></div>`
      : `<div class="gg-card-thumb" style="background-image: url('${escapeAttr(item.thumbUrl)}')"></div>`;

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
        ${state.showBadges && item.downloaded ? '<div class="gg-downloaded-badge">\u2713</div>' : ""}
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

    const contentArea = document.getElementById("gg-lb-content");
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
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
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
    document.getElementById("gg-bulk-count").textContent = `${count} selected`;
  }

  async function bulkDownload() {
    const selectedItems = state.items.filter((i) => state.selected.has(i.id));
    if (selectedItems.length === 0) return;
    await downloadItemsStaggered(selectedItems);
    deselectAll();
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

  async function deleteAllByFilter(filter) {
    // Ensure all items are fetched from API first
    if (!state.apiLoaded) {
      flashMessage("Fetching all items from Grok first...");
      await fetchAllMedia();
    }

    let items;
    if (filter === "downloaded") {
      items = state.items.filter((i) => i.downloaded);
    } else {
      items = [...state.items];
    }

    if (items.length === 0) {
      flashMessage("Nothing to delete");
      return;
    }

    // Confirm with the user
    const label = filter === "downloaded" ? `${items.length} downloaded items` : `all ${items.length} items`;
    if (!confirm(`Delete ${label} from Grok? This cannot be undone.`)) return;

    _downloadCancelled = false;
    const progressBar = document.getElementById("gg-progress-bar");
    const progressText = document.getElementById("gg-progress-text");
    const progressFill = document.getElementById("gg-progress-fill");
    if (progressBar) progressBar.style.display = "flex";

    let deleted = 0;
    const total = items.length;

    for (let i = 0; i < items.length; i++) {
      if (_downloadCancelled) break;
      const pct = Math.round(((i + 1) / total) * 100);
      if (progressText) progressText.textContent = `Deleting ${i + 1}/${total}...`;
      if (progressFill) progressFill.style.width = `${pct}%`;

      const success = await deleteItem(items[i]);
      if (success) deleted++;

      await sleep(50);
    }

    if (progressBar) progressBar.style.display = "none";
    flashMessage(_downloadCancelled
      ? `Cancelled. Deleted ${deleted} of ${total}`
      : `Deleted ${deleted} items`);
    renderGallery();
  }

  /* ============================================================
     DOWNLOAD — non-blocking, staggered with progress
     ============================================================ */

  let _downloadCancelled = false;

  /**
   * Generate a folder name for downloads.
   * Batch: "GrokGallery/batch_2026-02-24_143052"
   * Single: "GrokGallery/2026-02-24"
   */
  function makeBatchFolder() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
    return `GrokGallery/batch_${date}_${time}`;
  }

  function makeDateFolder() {
    return `GrokGallery/${new Date().toISOString().slice(0, 10)}`;
  }

  async function downloadItem(item) {
    const folder = makeDateFolder();
    const filename = generateFilename(item, 0);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_SINGLE",
        url: item.url,
        filename,
        folder,
        mediaType: item.type,
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

  /**
   * Download items one at a time with progress UI.
   * Yields to the event loop between each to keep the UI responsive.
   * Uses a shared batch folder for all items.
   */
  async function downloadItemsStaggered(items) {
    if (items.length === 0) return;
    _downloadCancelled = false;

    const folder = makeBatchFolder();
    const progressBar = document.getElementById("gg-progress-bar");
    const progressText = document.getElementById("gg-progress-text");
    const progressFill = document.getElementById("gg-progress-fill");
    if (progressBar) progressBar.style.display = "flex";

    let completed = 0;
    let failed = 0;

    for (const item of items) {
      if (_downloadCancelled) break;

      completed++;
      const pct = Math.round((completed / items.length) * 100);
      if (progressText) progressText.textContent = `Downloading ${completed}/${items.length}...`;
      if (progressFill) progressFill.style.width = `${pct}%`;

      try {
        const filename = generateFilename(item, completed);
        const response = await chrome.runtime.sendMessage({
          type: "DOWNLOAD_SINGLE",
          url: item.url,
          filename,
          folder,
          mediaType: item.type,
          prompt: item.prompt,
        });
        if (response.success) {
          item.downloaded = true;
          state.downloadedUrls[item.url] = Date.now();
        } else {
          failed++;
        }
      } catch {
        failed++;
      }

      // Yield to event loop every item to keep UI responsive
      await sleep(50);
    }

    if (progressBar) progressBar.style.display = "none";

    const msg = _downloadCancelled
      ? `Cancelled. Downloaded ${completed - 1} of ${items.length}`
      : failed > 0
        ? `Done. ${completed - failed} downloaded, ${failed} failed`
        : `Downloaded ${completed} items`;
    flashMessage(msg);
    updateStatusBar();
    renderGallery();
  }

  async function downloadAllByType(type) {
    // Ensure all items are fetched from API first
    if (!state.apiLoaded) {
      flashMessage("Fetching all items from Grok first...");
      await fetchAllMedia();
    }

    let items;
    if (type === "images") items = state.items.filter((i) => i.type === "image");
    else if (type === "videos") items = state.items.filter((i) => i.type === "video");
    else items = [...state.items];

    // Skip already downloaded
    const toDownload = items.filter((i) => !i.downloaded);
    if (toDownload.length === 0) {
      flashMessage("All items already downloaded");
      return;
    }
    flashMessage(`Starting download of ${toDownload.length} items...`);
    downloadItemsStaggered(toDownload);
  }

  function generateFilename(item, index) {
    const ext = item.type === "video" ? "mp4" : guessExtension(item.url);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const promptSlug = item.prompt
      ? "_" + item.prompt.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, "_").replace(/_+$/, "")
      : "";
    return `grok_${timestamp}${promptSlug}.${ext}`;
  }

  function guessExtension(url) {
    try {
      const match = new URL(url).pathname.match(/\.(jpg|jpeg|png|gif|webp|mp4)$/i);
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

    if (state.sidecarOpen && !state.apiLoaded) {
      // Auto-fetch from API on first open
      fetchAllMedia();
    }
  }

  /* ============================================================
     MUTATION OBSERVER
     ============================================================ */

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let hasNewMedia = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IMG" || node.tagName === "VIDEO" || node.querySelector?.("img, video")) {
            hasNewMedia = true;
            break;
          }
        }
        if (hasNewMedia) break;
      }

      // Only do DOM scanning when API hasn't loaded (fallback mode)
      if (hasNewMedia && state.sidecarOpen && !state.apiLoaded) {
        clearTimeout(state._scanTimeout);
        state._scanTimeout = setTimeout(() => {
          const existingUrls = new Set(state.items.map((i) => i.url));
          const newCount = scanDOM(existingUrls);
          if (newCount > 0) {
            renderGallery();
            updateStatusBar();
            flashMessage(`Found ${newCount} new item${newCount > 1 ? "s" : ""}`);
          }
        }, 800);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ============================================================
     STATUS & HELPERS
     ============================================================ */

  function updateStatusBar() {
    const text = document.getElementById("gg-status-text");
    if (!text) return;
    const filtered = getFilteredItems();
    const dlCount = state.items.filter((i) => i.downloaded).length;
    text.textContent = `${filtered.length} item${filtered.length !== 1 ? "s" : ""} \u00B7 ${dlCount} downloaded`;
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
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Start ──────────────────────────────────────────────────
  init();
})();
