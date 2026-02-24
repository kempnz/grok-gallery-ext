# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
