if ('serviceWorker' in navigator && !window.location.pathname.includes('iframe')) {
  navigator.serviceWorker.register('/LobbyKiosk/sw.js').catch(() => {});
}

if ('wakeLock' in navigator) {
  let wakeLock = null;
  async function acquire() {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {}
  }
  acquire();
  document.addEventListener('visibilitychange', () => !document.hidden && acquire());
}

document.addEventListener('pointerdown', async () => {
  if (document.fullscreenElement || navigator.standalone) return;
  try {
    await document.documentElement.requestFullscreen();
  } catch (e) {}
}, {once: true});

if (navigator.serviceWorker?.controller) {
  let lastActive = Date.now();
  document.addEventListener('pointerdown', () => {lastActive = Date.now();});
  document.addEventListener('keydown', () => {lastActive = Date.now();});
  setInterval(() => {
    if (Date.now() - lastActive > 2*60*60*1000 && Date.now() % 86400000 > 4*60*60*1000) {
      location.reload();
    }
  }, 5*60*1000);
}
