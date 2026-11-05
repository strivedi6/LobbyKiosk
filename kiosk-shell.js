/* Long-running kiosk helpers: offline cache, screen stays awake, full screen, nightly refresh. */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.has("preview") || window.self !== window.top) return; // not inside the admin preview

  // 1. Offline cache (service worker)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // 2. Keep the screen awake
  let lock = null;
  async function wake() {
    try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } } catch (e) {}
  }
  wake();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });

  // 3. Full screen: the installed app opens full screen by itself.
  //    In a normal Chrome tab, the first touch switches to full screen.
  const installed = matchMedia("(display-mode: fullscreen)").matches || matchMedia("(display-mode: standalone)").matches;
  function goFull() {
    wake();
    if (!installed && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }
  }
  document.addEventListener("pointerdown", goFull, { capture: true });

  // 4. Fresh start every night (around 4 AM) to keep memory clean over weeks of running.
  let lastTouch = Date.now();
  document.addEventListener("pointerdown", () => { lastTouch = Date.now(); }, { capture: true });
  const started = Date.now();
  setInterval(() => {
    const h = new Date().getHours();
    if (h === 4 && Date.now() - started > 2 * 3600e3 && Date.now() - lastTouch > 5 * 60e3 && navigator.onLine) location.reload();
  }, 60e3);
})();
