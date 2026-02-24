# Grok Gallery Manager

A Chrome extension that provides a file-manager-style gallery for AI-generated images and videos from Grok Imagine.

## Features

- **Gallery View**: Browse all your generated images and videos in a grid layout
- **API Integration**: Fetches your favorites directly from Grok's REST APIs
- **Bulk Actions**: Download, upscale, or delete multiple items at once
- **Resolution Detection**: Shows HD badge for upscaled images
- **Lightbox Viewer**: Full-screen view with keyboard navigation
- **Download Tracking**: Tracks downloaded items and shows badges

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `grok-gallery-ext` folder

## Usage

1. Navigate to [grok.com](https://grok.com) or [x.com/grok](https://x.com/grok)
2. Click the grid icon (FAB) in the bottom-right corner to open the gallery
3. Click the refresh button to fetch your favorites from the API

### Controls

- **Filters**: All / Images / Videos / New (not downloaded)
- **Grid Size**: 2, 3, or 4 columns
- **Keyboard**: Arrow keys to navigate lightbox, Escape to close

## Permissions

- `activeTab` - Access current tab
- `downloads` - Download media files
- `history` - Manage browsing history
- `storage` - Store settings and download history

## Host Permissions

- `grok.com/*`
- `x.com/grok*`

## Files

- `manifest.json` - Extension configuration
- `content.js` - Main gallery functionality
- `background.js` - Service worker for downloads
- `popup.js` / `popup.html` - Browser action popup
- `sidecar.css` - Gallery styling
- `icons/` - Extension icons
