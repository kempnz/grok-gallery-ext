# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-04-13

### Added
- Parallel bulk downloads (3-wide worker pool) for faster batch saving
- Parallel bulk deletes (3-wide worker pool) with per-card live removal
- Serialization gate for DOM-fallback deletes so parallel workers never race the global confirm modal

### Changed
- `downloadItem` no longer triggers a full `renderGallery()` — updates the single affected card in place
- Background service worker caches `downloadedUrls` in memory with a 250 ms debounced flush instead of reading/writing the full map per download
- `bulkDelete` / `deleteAllByFilter` share one `deleteItemsParallel` helper

### Fixed
- Stale `data-index` on surviving cards when `filter="new"` removed items in place — card clicks now resolve the index live from the item id
- Cache-load race in the background worker where parallel `markDownloaded` calls could stomp each other's in-memory mutations (shared in-flight load promise)

## [1.1.8] - 2026-02-27

### Fixed
- `childPosts` are now parsed — edits/variations of a favourite were nested inside the parent post's `childPosts` array but were being skipped (incorrect assumption that childPosts were other users' remixes). This was the root cause of favourites only showing 1 item
- Favourite filtering uses direct ID matching (`apiId`, `originalPostId`, `postIds`) to collect the group
- Resolution detection now reads nested `resolution.width`/`resolution.height` from API (was looking for flat `width`/`height` fields that don't exist, so all images showed as 720p)
- Added `originalPostId` field to all parsed items

## [1.1.7] - 2026-02-27

### Fixed
- Post filtering now understands favorite grouping — each image is its own API "post", grouped by prompt under a "favorite". Finds the anchor item by ID match, then returns all items sharing the same prompt (generation batch)

## [1.1.6] - 2026-02-27

### Fixed
- Post view was showing homepage images — speculative API filter attempts returned all favorites because server ignored unknown filter params. Replaced with fetch-all + client-side filter approach

## [1.1.5] - 2026-02-27

### Fixed
- Fixed post URL parsing — now correctly handles `/imagine/post/<uuid>` (was extracting "post" as the ID)
- Post mode now matches by all ID-like fields from API responses, not just `post.id`
- Added verbose ID field logging in `parseMediaPost` and favorites fallback to aid debugging
- Removed DOM scan fallback retries in post mode (API-only approach, DOM scan was grabbing wrong images)

## [1.1.4] - 2026-02-27

### Fixed
- `fetchSinglePost()` now tries 6 API endpoint patterns with full response logging to discover what works

## [1.1.3] - 2026-02-27

### Fixed
- Post media now loads via API instead of relying on DOM scanning (Grok doesn't render images until clicked)
- Added `fetchSinglePost()` with 3-tier strategy: direct post API, filtered list API, favorites filter fallback
- DOM scan retries (4 attempts with delay) as final fallback if all API methods fail

## [1.1.2] - 2026-02-27

### Fixed
- Post images now appear immediately as they load — mutation observer actively scans for new media in post mode instead of being blocked by the `apiLoaded` flag

## [1.1.1] - 2026-02-27

### Fixed
- SPA navigation detection now works — replaced broken `history.pushState` interception with `location.href` polling (content scripts run in an isolated world and can't intercept the page's history calls)

## [1.1.0] - 2026-02-27

### Added
- Post-specific media filtering: viewing `/imagine/<post-id>` now shows only that post's media
- "Download Post" button: appears in post view to download all media from the current post
- Context bar in sidecar panel showing current view mode ("All Favorites" vs "Viewing post")
- SPA URL watcher: detects navigation between posts and favorites without page reload

### Changed
- Extension now loads on all `/imagine` pages (previously blocked on `/imagine` root)
- `fetchAllMedia()` uses DOM-only scanning in post mode, API fetch in all-favorites mode
- Gallery auto-clears and re-fetches when navigating between different pages

## [1.0.0] - 2026-02-24

### Added
- Gallery View: Browse all generated images and videos in a grid layout
- API Integration: Fetches favorites directly from Grok's REST APIs
- Bulk Actions: Download, upscale, or delete multiple items at once
- Resolution Detection: Shows HD badge for upscaled images
- Lightbox Viewer: Full-screen view with keyboard navigation
- Download Tracking: Tracks downloaded items and shows badges
- Grid Size Toggle: Switch between 2, 3, or 4 column layouts
- Filters: All / Images / Videos / New (not downloaded)
- Delete All: Bulk delete all items or just downloaded items
- Cleanup Button: Clear all Grok Imagine history (downloads + browser history)
- Settings: Toggle download badges, clear download history, debug log

### Fixed
- Null safety issues throughout content.js and background.js
- Off-by-one error in pagination for "Load More" button
- Undefined prompt handling in filename generation

### Security
- Proper null checks for all DOM element access
- Safe handling of potentially undefined API responses
