# DXBAI Lobby Kiosk

Embassy Suites Dubai Business Bay Lobby Information Kiosk - Bilingual (English & Arabic)

## Live Demo

🌐 **Visit:** https://strivedi6.github.io/LobbyKiosk/

📱 **Admin Dashboard:** https://strivedi6.github.io/LobbyKiosk/admin.html

## Features

- ✅ Bilingual Interface (English & Arabic)
- ✅ Responsive Design (Portrait 1080×1920)
- ✅ Progressive Web App (PWA)
- ✅ Service Worker for Offline Support
- ✅ Smooth Animations & Transitions
- ✅ Google Sheets Integration
- ✅ Admin Dashboard with Autosave
- ✅ Meeting Room Information
- ✅ Dining & Recreation Pages
- ✅ Contact & WhatsApp Support

## Setup

### 1. Configure Google Sheets Connection

1. Open your Google Sheet
2. Go to **Extensions › Apps Script**
3. Paste the code from `google-apps-script/Code.gs`
4. Change `ADMIN_PIN: '1234'` to your own PIN
5. Click **Deploy › New Deployment › Web app**
6. Set "Who has access" to **"Anyone"**
7. Copy the deployment URL

### 2. Update Config

Edit `config.js` and replace the deployment URL:

```javascript
window.KIOSK_CONFIG = {
  scriptUrl: "https://script.google.com/macros/s/YOUR_URL_HERE/exec"
};
```

### 3. Access Admin Dashboard

- **URL:** https://strivedi6.github.io/LobbyKiosk/admin.html
- **PIN:** The one you set in Code.gs (default: 1234)

## File Structure

```
├── index.html           # Main app page
├── admin.html           # Admin dashboard
├── app.js              # App logic
├── app.css             # Styling
├── admin.js            # Admin logic
├── icons.js            # SVG icons
├── config.js           # Configuration (Apps Script URL)
├── content.json        # Page content & strings
├── manifest.webmanifest # PWA manifest
├── sw.js               # Service worker
├── kiosk-shell.js      # PWA setup
├── assets/
│   ├── images/         # Room & dining photos
│   ├── fonts/          # Custom fonts
│   └── app-icons/      # PWA icons
└── google-apps-script/
    └── Code.gs         # Apps Script backend
```

## Customization

### Update Content

Edit `content.json` to change:
- Page titles and descriptions
- Contact information
- Room details
- Menu items
- Bilingual strings

### Update Images

Replace images in `assets/images/` with your own photos

### Update Styling

Edit `app.css` to customize:
- Colors (navy #0f2340, gold #C4A575)
- Fonts
- Spacing
- Animations

## Admin Features

- ✅ Autosave changes to Google Sheet
- ✅ Real-time preview
- ✅ Upload images to Google Drive
- ✅ Bilingual content management
- ✅ Pin-protected login

## PWA Installation

### Chrome on Android

1. Open https://strivedi6.github.io/LobbyKiosk/
2. Tap **Menu › Add to Home Screen**
3. App runs fullscreen on kiosk display

### Windows/Mac

1. Open https://strivedi6.github.io/LobbyKiosk/
2. Click **Install App** in address bar
3. Launches fullscreen when opened

## Offline Support

The service worker caches:
- All HTML, CSS, JS files
- Images and fonts
- Continues working without internet

## Support

For issues or feature requests, check the setup documentation or contact your administrator.

---

**Last Updated:** November 2026
**Version:** 2.0
**License:** Private
