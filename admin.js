/* DXBAI Lobby Kiosk – Admin
   Edits the content stored in the Google Sheet (through the Apps Script web app),
   uploads media to Drive, and autosaves every change. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const ICONS = window.KIOSK_ICONS || {};
  const DEFAULT_SCRIPT = "https://script.google.com/macros/s/AKfycbxVfaRSW7Wlb4vMeZsx_cZ5C97b6_0bWdx7b8op9JfBTU0hhtetqKVMcEPajHuON1RXYg/exec";
  const SCRIPT = (window.KIOSK_CONFIG && window.KIOSK_CONFIG.scriptUrl) || DEFAULT_SCRIPT;

  // Sheet tabs and the content sections stored on each (must match Code.gs)
  const TABS = [["_about", "settings", "brand"], ["labels", "home"], ["ads"], ["menu"], ["pages"], ["contacts"], ["offers"]];

  const EXTRA = {
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>',
    cards: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    text: '<path d="M4 6h16M4 12h16M4 18h10"/>'
  };
  const ic = (n, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24">${EXTRA[n] || ICONS[n] || ""}</svg>`;
  const icEl = (n) => { const t = document.createElement("template"); t.innerHTML = ic(n); return t.content.firstChild; };
  function groupIcon(t) {
    t = t.toLowerCase();
    return /home/.test(t) ? "home" : /eat|din|food/.test(t) ? "cutlery" : /stay|room|suite/.test(t) ? "bed" : /recre|pool|well|explore|leisure/.test(t) ? "swim"
      : /meet|event|memor/.test(t) ? "meeting" : /famil|kid/.test(t) ? "family" : /near|attract/.test(t) ? "pin" : /pop/.test(t) ? "star" : /general|setting/.test(t) ? "gear" : "layout";
  }

  let content = null;
  let lastSync = 0;
  let pin = sessionStorage.getItem("kiosk-pin") || "";
  let current = null;
  let previewLang = "en";
  let saved = {};                 // last saved JSON per tab
  let saveTimer = null, saving = false, again = false, retryMs = 4000;

  /* ================= network ================= */
  async function fetchT(url, opts = {}, ms = 25000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, Object.assign({ signal: ctl.signal }, opts)); }
    finally { clearTimeout(t); }
  }
  async function gas(action, payload = {}, ms) {
    const r = await fetchT(SCRIPT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action, pin }, payload))
    }, ms);
    const j = await r.json();
    if (j.code === 401) { lock("Your PIN was not accepted. Please sign in again."); throw new Error("Wrong PIN"); }
    if (j.error) throw new Error(j.error);
    return j;
  }
  async function getContent() {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetchT(SCRIPT + "?action=content&t=" + Date.now());
        return await r.json();
      } catch (e) { if (i === 2) throw e; await sleep(1500 * (i + 1)); }
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Turn a failed request into a plain-language reason
  async function diagnose() {
    try {
      const r = await fetchT(SCRIPT + "?action=ping&t=" + Date.now(), {}, 15000);
      const txt = await r.text();
      try { const j = JSON.parse(txt); if (j.ok) return null; } catch (e) {}
      if (/Script function not found|doGet/i.test(txt)) return "The Apps Script is published without the code. Paste Code.gs, Save, then Deploy › Manage deployments › Edit › New version.";
      return "The Apps Script answered with an error page. Open the script, check Code.gs is saved, and deploy a New version.";
    } catch (e) {
      if (e.name === "AbortError") return "Google is taking too long to answer. Try again in a minute.";
      if (!navigator.onLine) return "This computer is offline.";
      return "Google blocked the request. In Apps Script: Deploy › Manage deployments › Edit, set “Who has access” to Anyone, choose New version, Deploy.";
    }
  }

  /* ================= connection light ================= */
  let online = null;
  function setConn(state, text) {
    online = state === "ok";
    [$("#conn"), $("#loginConn")].forEach((c) => {
      if (!c) return;
      const short = c.id === "conn" ? (state === "ok" ? "Online" : state === "bad" ? "Offline · retrying" : "Connecting…") : text;
      c.innerHTML = `<span class="dot ${state}"></span><span>${short}</span>`;
      c.title = text;
    });
    const pd = $("#pdot"); if (pd) pd.className = "dot " + state;
  }
  async function ping() {
    try {
      const r = await fetchT(SCRIPT + "?action=ping&t=" + Date.now(), {}, 12000);
      const j = await r.json();
      if (!j.ok) throw new Error();
      setConn("ok", "Connected to Lobby Screen");
      if (!lastSync) lastSync = Date.now();
      showSynced();
      if (pendingSave()) queueSave(200);
    } catch (e) {
      setConn("bad", "Disconnected. Retrying…");
      const why = await diagnose();
      if (why && $("#login").style.display !== "none") $("#loginMsg").textContent = why;
    }
  }
  setInterval(ping, 30000);
  function showSynced() {
    const e = $("#synced"); if (!e) return;
    if (!lastSync) { e.textContent = "Not synced yet"; return; }
    const m = Math.floor((Date.now() - lastSync) / 60000);
    e.textContent = "Last synced " + (m < 1 ? "just now" : m === 1 ? "1 min ago" : m < 60 ? m + " mins ago" : new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }
  setInterval(showSynced, 20000);
  $("#pingBtn").innerHTML = ic("refresh");
  $("#pingBtn").onclick = async () => { const b = $("#pingBtn"); b.classList.add("spin"); await ping(); if (pendingSave()) await flushSave(); setTimeout(() => b.classList.remove("spin"), 400); };
  $("#historyBtn").innerHTML = ic("history") + "Previous versions";
  $("#lockBtn").innerHTML = ic("lock") + "Lock";
  $("#reloadPreview").innerHTML = ic("refresh");
  addEventListener("online", ping);
  addEventListener("offline", () => setConn("bad", "No internet connection"));

  /* ================= login ================= */
  async function unlock() {
    const v = $("#pin").value.trim();
    if (!v) return;
    $("#loginBtn").disabled = true; $("#loginMsg").textContent = "";
    pin = v;
    try {
      await gas("check", {}, 20000);
      sessionStorage.setItem("kiosk-pin", pin);
      await start();
    } catch (e) {
      $("#loginMsg").textContent = e.message === "Wrong PIN" ? "Wrong PIN. Try again." : ((await diagnose()) || "Can't reach the Lobby Screen. Try again.");
      pin = "";
    } finally { $("#loginBtn").disabled = false; }
  }
  function lock(msg) {
    sessionStorage.removeItem("kiosk-pin"); pin = "";
    $("#app").classList.remove("on"); $("#login").style.display = "flex";
    $("#pin").value = ""; $("#loginMsg").textContent = msg || ""; setTimeout(() => $("#pin").focus(), 50);
  }
  $("#loginBtn").onclick = unlock;
  $("#pin").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
  $("#lockBtn").onclick = async () => { if (pendingSave()) await flushSave(); lock(""); };

  /* ================= load ================= */
  async function start() {
    $("#login").style.display = "none";
    $("#app").classList.add("on");
    setSaved("Loading…", "saving");
    let c = await getContent();
    let seeded = false;
    if (!c || !c.pages) {
      c = await (await fetch("content.json?t=" + Date.now(), { cache: "no-store" })).json();
      seeded = true;
    }
    content = c;
    TABS.forEach((keys, i) => { saved[i] = seeded ? "" : tabJSON(i); });
    // unsaved work from an earlier session?
    try {
      const d = JSON.parse(localStorage.getItem("kiosk-draft") || "null");
      if (d && d.content && d.at && JSON.stringify(d.content) !== JSON.stringify(content) &&
          confirm("There are changes from " + new Date(d.at).toLocaleString() + " that never reached the Google Sheet. Restore them?")) {
        content = d.content;
      }
      localStorage.removeItem("kiosk-draft");
    } catch (e) {}
    renderNav();
    select(current && findSection(current.key) || firstSection());
    pushPreview();
    if (pendingSave()) { setSaved(seeded ? "Copying everything into the Google Sheet…" : "Saving…", "saving"); queueSave(100); }
    else setSaved("All changes saved", "ok");
    lastSync = Date.now();
    ping();
  }

  /* ================= autosave ================= */
  function tabJSON(i) { const o = {}; TABS[i].forEach((k) => { if (k in content) o[k] = content[k]; }); return JSON.stringify(o); }
  function changedTabs() { return TABS.map((_, i) => i).filter((i) => tabJSON(i) !== saved[i]); }
  function pendingSave() { return content && changedTabs().length > 0; }

  function markDirty() {
    pushPreview();
    refreshBadges();
    try { localStorage.setItem("kiosk-draft", JSON.stringify({ at: Date.now(), content })); } catch (e) {}
    setSaved("Unsaved changes…", "saving");
    queueSave(1500);
  }
  function queueSave(ms) { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, ms); }
  async function flushSave() { clearTimeout(saveTimer); await doSave(); }

  async function doSave() {
    if (saving) { again = true; return; }
    const tabs = changedTabs();
    if (!tabs.length) { setSaved("All changes saved", "ok"); return; }
    saving = true;
    const parts = {}, snap = {};
    tabs.forEach((i) => { snap[i] = tabJSON(i); TABS[i].forEach((k) => { if (k in content) parts[k] = JSON.parse(JSON.stringify(content[k])); }); });
    setSaved("Saving…", "saving");
    try {
      await gas("save", { parts }, 60000);
      tabs.forEach((i) => { saved[i] = snap[i]; });
      retryMs = 4000;
      lastSync = Date.now(); showSynced();
      if (!pendingSave()) {
        localStorage.removeItem("kiosk-draft");
        setSaved("All changes saved · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), "ok");
      }
      if (online === false) ping();
    } catch (e) {
      if (e.message === "Wrong PIN") { saving = false; return; }
      setSaved("Not saved yet: " + (e.name === "AbortError" ? "Google Sheet is slow" : "connection problem") + ". Retrying…", "err");
      setConn("bad", "Disconnected. Retrying…");
      saving = false;
      retryMs = Math.min(retryMs * 1.6, 60000);
      queueSave(retryMs);
      return;
    }
    saving = false;
    if (again || pendingSave()) { again = false; queueSave(300); }
  }
  addEventListener("beforeunload", (e) => { if (pendingSave()) { e.preventDefault(); e.returnValue = ""; } });

  function setSaved(text, cls) { const s = $("#saved"); s.textContent = text; s.className = "saved " + (cls || ""); }
  function toast(msg, ms = 2800) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); }

  /* ================= history ================= */
  $("#historyBtn").onclick = async () => {
    const ul = $("#historyList");
    ul.innerHTML = "<li>Loading…</li>";
    $("#history").classList.add("on");
    let files;
    try { files = (await gas("history")).files; } catch (e) { ul.innerHTML = "<li>Couldn't load: " + e.message + "</li>"; return; }
    ul.innerHTML = files.length ? "" : "<li>No backups yet.</li>";
    files.forEach((f) => {
      const m = f.name.match(/content-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
      const label = m ? `${m[3]}/${m[2]}/${m[1]}  ${m[4]}:${m[5]}` : f.name;
      const li = document.createElement("li");
      li.innerHTML = `<span>${label}</span>`;
      const b = document.createElement("button"); b.className = "sbtn"; b.textContent = "Restore";
      b.onclick = async () => {
        if (!confirm("Restore the version from " + label + "?")) return;
        b.disabled = true; b.textContent = "Restoring…";
        try { await flushSave(); await gas("restore", { id: f.id }, 90000); $("#history").classList.remove("on"); toast("Restored."); await start(); }
        catch (e) { toast("Restore failed: " + e.message); b.disabled = false; b.textContent = "Restore"; }
      };
      li.appendChild(b); ul.appendChild(li);
    });
  };
  $("#historyClose").onclick = () => $("#history").classList.remove("on");

  /* ================= preview ================= */
  const frame = $("#preview");
  let previewReady = false, pt;
  addEventListener("message", (e) => { if (e.data && e.data.type === "preview-ready") { previewReady = true; pushPreview(true); } });
  function pushPreview(andGo) {
    clearTimeout(pt);
    pt = setTimeout(() => {
      if (!previewReady || !content) return;
      frame.contentWindow.postMessage({ type: "content", content: JSON.parse(JSON.stringify(content)) }, "*");
      if (andGo) setTimeout(gotoPreview, 100);
    }, 200);
  }
  function gotoPreview() {
    if (!previewReady || !current) return;
    const p = current.preview || {};
    frame.contentWindow.postMessage({ type: "goto", page: p.page || "home", overlay: p.overlay || "", lang: previewLang }, "*");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (!b) return;
    previewLang = b.dataset.lang;
    document.querySelectorAll("[data-lang]").forEach((x) => x.classList.toggle("on", x.dataset.lang === previewLang));
    gotoPreview();
  });
  $("#reloadPreview").onclick = () => { previewReady = false; frame.src = "index.html?preview=1&t=" + Date.now(); };

  /* ================= labels ================= */
  const FRIENDLY = {
    src: "Image or video", image: "Image", hero: "Top photo", heroLogo: "Logo on top photo (white)", logo: "Logo",
    background: "Background photo", gallery: "Photo carousel", photos: "Photos (1 large + 2 small)", menuImages: "Menu pages",
    capacityImages: "Capacity chart", floorPlanImages: "Floor plan",
    headerImage: "Header photo", qrImage: "WhatsApp QR code", propertyLogo: "Hotel logo (top left)", propertyLogoOnWhite: "Hotel logo on white pages",
    footerLogo: "Footer logo", title: "Title", subtitle: "Subtitle", headline: "Headline", text: "Description", tagline: "Tagline", intro: "Intro",
    welcome: "Welcome line", explore: "Line above button", start: "Button text", tapText: "Line below button", name: "Name",
    pillars: "Four icons at the bottom", info: "Info strip", label: "Label", value: "Value", meta: "Details", buttons: "Buttons",
    features: "Feature cards", highlights: "Room highlights", usps: "Bottom strip", items: "Cards", sections: "Sections", tiles: "Menu tiles",
    target: "Opens", reservationContact: "“Make a reservation” opens", bookContact: "“Book now” opens", offers: "“View offers” opens",
    secondButton: "Middle button", banner: "Banner", callNote: "Text under phone number", phone: "Phone number", extension: "Extension", email: "Email",
    active: "Show on screen", type: "Type", seconds: "Seconds on screen", icon: "Icon",
    idleSeconds: "Back to home screen after (seconds without a touch)", adImageSeconds: "Seconds per photo slide",
    checkMinutes: "Screen checks for updates every (minutes)", defaultLanguage: "Default language", ads: "Slideshow (top 70% of the home screen)",
    home: "Touch area (bottom 30%)", labels: "Button & label text", settings: "Settings", brand: "Logos"
  };
  const HINTS = {
    target: "Where a tap goes: a page, a contact pop-up or an offers pop-up.",
    seconds: "0 = use the default. Videos play to the end when 0.",
    headline: "Line breaks are kept."
  };
  const RECO = {
    hero: "Recommended: 1080 × 900 px or larger", heroLogo: "Transparent PNG or SVG", logo: "Transparent PNG or SVG",
    background: "Recommended: 1080 × 1920 px", headerImage: "Recommended: 1080 × 600 px", qrImage: "Square PNG",
    propertyLogo: "Transparent PNG or SVG", propertyLogoOnWhite: "Transparent PNG or SVG", footerLogo: "Transparent PNG or SVG", image: "Recommended: 1200 px wide or larger"
  };
  const IMAGE_KEYS = /^(src|image|hero|heroLogo|logo|background|gallery|photos|menuImages|capacityImages|floorPlanImages|headerImage|qrImage|propertyLogo|propertyLogoOnWhite|footerLogo)$/;
  const SKIP = /^(_about|template|cardStyle)$/;
  const human = (k) => FRIENDLY[k] || String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
  const isBi = (v) => v && typeof v === "object" && !Array.isArray(v) && "en" in v && "ar" in v && Object.keys(v).length === 2;
  const textOf = (v) => (v == null ? "" : typeof v === "string" ? v : isBi(v) ? (v.en || v.ar || "") : "");
  const one = (s) => String(s || "").replace(/\n/g, " ");

  /* ================= navigation (accordion) ================= */
  function sections() {
    const groups = [];
    const g = (title) => { const o = { title, items: [] }; groups.push(o); return o; };
    const s1 = g("Home & menu");
    s1.items.push({ key: "home", title: "Home screen & slideshow", paths: [["ads"], ["home"]], preview: { page: "home" } });
    s1.items.push({ key: "menu", title: "Main menu", paths: [["menu"]], preview: { page: "menu" } });
    const seen = new Set();
    (content.menu.tiles || []).forEach((t) => {
      const id = t.target, page = content.pages[id];
      if (!page || seen.has(id)) return;
      seen.add(id);
      const grp = g(one(textOf(t.title)) || id);
      grp.items.push({ key: id, title: page.template === "list" ? "List page" : one(textOf(page.title) || textOf(page.name)), paths: [["pages", id]], preview: { page: id }, pageId: id });
      const names = {};
      (page.items || []).forEach((it) => {
        const tid = it.target;
        if (tid && content.pages[tid] && !seen.has(tid)) {
          seen.add(tid);
          const p = content.pages[tid];
          let name = one(textOf(p.name) || textOf(p.title) || tid);
          if (name === name.toUpperCase()) name = name.toLowerCase().replace(/\b(\w)/g, (m) => m.toUpperCase());
          if (names[name]) name += " (" + tid.split("-").slice(-2).join(" ") + ")";
          names[name] = 1;
          grp.items.push({ key: tid, title: name, paths: [["pages", tid]], preview: { page: tid }, pageId: tid, parent: id });
        }
      });
    });
    const orphans = Object.keys(content.pages).filter((k) => !seen.has(k));
    if (orphans.length) { const o = g("Other pages"); orphans.forEach((k) => o.items.push({ key: k, title: one(textOf(content.pages[k].title) || textOf(content.pages[k].name) || k), paths: [["pages", k]], preview: { page: k }, pageId: k })); }
    const pop = g("Pop-ups");
    Object.keys(content.contacts).forEach((k) => pop.items.push({ key: "contact:" + k, title: "Contact: " + k.replace(/-/g, " "), paths: [["contacts", k]], preview: { page: "menu", overlay: "contact:" + k } }));
    Object.keys(content.offers).forEach((k) => pop.items.push({ key: "offers:" + k, title: "Offers: " + k.replace(/-/g, " "), paths: [["offers", k]], preview: { page: "menu", overlay: "offers:" + k } }));
    const gen = g("General");
    gen.items.push({ key: "labels", title: "Button & label text", paths: [["labels"]], preview: { page: "menu" } });
    gen.items.push({ key: "brand", title: "Logos", paths: [["brand"]], preview: { page: "menu" } });
    gen.items.push({ key: "settings", title: "Settings", paths: [["settings"]], preview: { page: "home" } });
    return groups;
  }
  const allSections = () => sections().flatMap((g) => g.items.map((s) => Object.assign(s, { group: g.title })));
  const findSection = (key) => allSections().find((s) => s.key === key);
  const firstSection = () => allSections()[0];

  function getAt(path) { return path.reduce((o, k) => (o == null ? o : o[k]), content); }
  function setAt(path, val) { const last = path[path.length - 1]; getAt(path.slice(0, -1))[last] = val; }

  function missingArabic(node) {
    let n = 0;
    (function walk(v) {
      if (isBi(v)) { if (v.en && !v.ar && !/^(assets\/|https?:)/.test(v.en)) n++; return; }
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    })(node);
    return n;
  }
  const badge = (n) => n ? `<span class="badge" title="Arabic text missing (English shows instead)">AR ${n}</span>` : "";

  function thumbOf(s) {
    const p = s.pageId && content.pages[s.pageId];
    let v = p ? (p.hero || p.background || p.headerImage || p.image || (p.gallery || [])[0] || (p.photos || [])[0]) : null;
    if (!p && s.key === "home") v = ((content.ads || [])[0] || {}).src;
    v = textOf(v);
    return v && !/\.(mp4|webm|mov)$/i.test(v) ? v : "";
  }
  function renderNav() {
    const nav = $("#nav");
    const scroll = nav.scrollTop;
    nav.innerHTML = '<div class="nav-label">PAGES</div>';
    sections().forEach((g) => {
      const box = document.createElement("div");
      box.className = "grp";
      const miss = g.items.reduce((n, s) => n + s.paths.reduce((m, p) => m + missingArabic(getAt(p)), 0), 0);
      const h = document.createElement("button");
      h.className = "grp-h";
      h.innerHTML = `${ic(groupIcon(g.title))}<span>${g.title}</span>${badge(miss)}<span class="chev">${ic("chevronRight")}</span>`;
      h.onclick = () => openGroup(box, !box.classList.contains("open"));
      const list = document.createElement("div");
      list.className = "grp-items";
      g.items.forEach((s) => {
        const a = document.createElement("button");
        a.className = "nav-i" + (current && current.key === s.key ? " on" : "");
        a.dataset.key = s.key;
        const m = s.paths.reduce((n, p) => n + missingArabic(getAt(p)), 0);
        const t = thumbOf(s);
        a.innerHTML = `${t ? `<span class="tn" style="background-image:url('${t.replace(/'/g, "%27")}')"></span>` : ""}<span class="lbl">${s.title}</span>${badge(m)}`;
        a.onclick = () => select(Object.assign(s, { group: g.title }));
        list.appendChild(a);
      });
      box.append(h, list);
      if (current && g.items.some((s) => s.key === current.key)) box.classList.add("open");
      nav.appendChild(box);
    });
    nav.scrollTop = scroll;
  }
  function openGroup(box, open) {
    document.querySelectorAll("#nav .grp").forEach((g) => g.classList.toggle("open", open && g === box));
  }
  let badgeT;
  function refreshBadges() { clearTimeout(badgeT); badgeT = setTimeout(() => { const k = current && current.key; renderNav(); if (k) highlight(k); }, 600); }
  function highlight(key) { document.querySelectorAll(".nav-i").forEach((a) => a.classList.toggle("on", a.dataset.key === key)); }

  function select(s) {
    if (!s) return;
    current = s;
    highlight(s.key);
    const box = [...document.querySelectorAll(".nav-i")].find((a) => a.dataset.key === s.key);
    if (box) openGroup(box.closest(".grp"), true);
    renderForm();
    gotoPreview();
  }

  /* ================= form ================= */
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v; else if (k.startsWith("on")) e[k] = v; else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    kids.flat().forEach((k) => e.append(k instanceof Node ? k : document.createTextNode(k)));
    return e;
  }
  function field(label, control, hint) {
    return el("div", { class: "field" }, label ? el("label", {}, label) : "", control, hint ? el("div", { class: "hint" }, hint) : "");
  }
  // a top-level section becomes a tab (only one shows at a time)
  function section(title, body, count, open, icon) {
    return { title, body, count, icon };
  }

  const activeTab = {};
  function tabIcon(title) {
    const t = title.toLowerCase();
    return /main|detail|touch/.test(t) ? "edit" : /photo|image|gallery|slideshow|logo|menu pages|floor|capacity/.test(t) ? "image"
      : /setting/.test(t) ? "gear" : /button|label|text/.test(t) ? "text" : "cards";
  }
  function renderForm() {
    const f = $("#form");
    const scroll = f.scrollTop;
    f.innerHTML = "";
    const s = current;
    const page = s.pageId ? content.pages[s.pageId] : null;
    const title = s.title === "List page" ? s.group : s.title;
    const crumbs = el("div", { class: "crumbs" }, s.group, icEl("chevronRight"), el("b", {}, s.title));
    crumbs.querySelector("svg").style.cssText = "width:14px;height:14px";
    f.append(crumbs);
    const subs = { list: "List Page", venue: "Restaurant / Bar Page", facility: "Facility Page", room: "Room Page", guide: "Guide Page", meeting: "Meeting Room Page" };
    const lang = el("div", { class: "seg" }, el("button", { "data-lang": "en", class: previewLang === "en" ? "on" : "" }, "EN"), el("button", { "data-lang": "ar", class: previewLang === "ar" ? "on" : "" }, "AR"));
    const viewBtn = el("a", { class: "hbtn", href: "./", target: "_blank" }); viewBtn.innerHTML = ic("eye") + "View on Kiosk";
    const saveBtn = el("button", { class: "btn-gold" }); saveBtn.innerHTML = ic("check") + "Save Changes";
    saveBtn.onclick = async () => {
      saveBtn.disabled = true; saveBtn.innerHTML = ic("refresh") + "Saving…";
      await flushSave();
      saveBtn.disabled = false;
      saveBtn.innerHTML = ic("check") + (pendingSave() ? "Retrying…" : "Saved");
      setTimeout(() => { saveBtn.innerHTML = ic("check") + "Save Changes"; }, 2200);
    };
    f.append(el("div", { class: "page-head" },
      el("div", { class: "tt" }, el("h2", {}, title), el("p", { class: "sub" }, page ? subs[page.template] || "" : s.group === "Pop-ups" ? "Pop-up" : "Changes save automatically")),
      el("div", { class: "acts" }, lang, viewBtn, saveBtn)));
    if (page && s.parent) {
      f.append(el("div", { class: "tools" },
        el("button", { class: "sbtn", onclick: () => duplicatePage(s) }, "Duplicate this page"),
        el("button", { class: "sbtn danger", onclick: () => deletePage(s) }, "Delete this page")));
    }
    const tabs = [];
    s.paths.forEach((p) => {
      const v = getAt(p);
      const key = p[p.length - 1];
      if (p[0] === "offers") { tabs.push(section("Offer Images", arrayEditor(v, p, "gallery"), v.length)); return; }
      if (Array.isArray(v)) { tabs.push(section(human(key), arrayEditor(v, p, key), v.length)); return; }
      const simple = el("div"), media = el("div", { class: "media-grid" }), nested = [];
      Object.keys(v).forEach((k) => {
        if (SKIP.test(k)) return;
        const val = v[k], path = p.concat(k);
        if (val && typeof val === "object" && !isBi(val)) {
          if (Array.isArray(val)) nested.push(section(human(k), arrayEditor(val, path, k), val.length));
          else nested.push(section(human(k), objectFields(val, path)));
        } else if (IMAGE_KEYS.test(k)) {
          const fld = field(human(k), node(val, path, k), RECO[k]);
          if (isBi(val)) fld.classList.add("wide");
          media.append(fld);
        } else simple.append(field(human(k), node(val, path, k), HINTS[k]));
      });
      if (media.children.length) {
        if (!simple.children.length) simple.append(media);
        else simple.append(el("div", { class: "subcard" }, el("h4", {}, "Images & Branding"), media));
      }
      if (simple.children.length) tabs.push(section(s.paths.length > 1 ? human(key) : "Main Details", simple));
      nested.forEach((n) => tabs.push(n));
    });
    let idx = Math.min(activeTab[s.key] || 0, tabs.length - 1);
    const bar = el("div", { class: "tabs" });
    const panel = el("div", { class: "panel" });
    const show = (i) => {
      idx = i; activeTab[s.key] = i;
      [...bar.children].forEach((b, j) => b.classList.toggle("on", j === i));
      panel.innerHTML = ""; panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = "";
      panel.append(el("h3", {}, tabs[i].title), tabs[i].body);
    };
    tabs.forEach((t, i) => {
      const b = el("button", { class: "tab" });
      b.innerHTML = ic(tabIcon(t.title)) + `<span>${t.title.replace(/\b\w/g, (c) => c.toUpperCase())}</span>` + (t.count != null ? `<span class="count">${t.count}</span>` : "");
      b.onclick = () => { show(i); f.scrollTop = 0; };
      bar.append(b);
    });
    if (tabs.length > 1) f.append(bar);
    f.append(panel);
    if (tabs.length) show(idx);
    f.scrollTop = scroll;
  }

  function objectFields(obj, path) {
    const w = el("div");
    Object.keys(obj).forEach((k) => {
      if (SKIP.test(k)) return;
      const v = obj[k], p = path.concat(k);
      if (v && typeof v === "object" && !Array.isArray(v) && !isBi(v)) w.append(field(human(k), objectFields(v, p)));
      else if (Array.isArray(v) && v.length && typeof v[0] === "object" && !isBi(v[0])) w.append(field(human(k), arrayEditor(v, p, k)));
      else w.append(field(human(k), node(v, p, k), HINTS[k]));
    });
    return w;
  }

  function node(v, path, key) {
    if (key === "icon") return iconPicker(path);
    if (isBi(v)) return IMAGE_KEYS.test(key) ? biImage(path, key) : biText(v, path);
    if (Array.isArray(v)) return arrayEditor(v, path, key);
    if (typeof v === "boolean") { const c = el("input", { type: "checkbox" }); c.checked = v; c.onchange = () => { setAt(path, c.checked); markDirty(); }; return el("label", {}, c, " Yes"); }
    if (typeof v === "number") { const i = el("input", { type: "number", value: v, min: 0 }); i.oninput = () => { setAt(path, Number(i.value) || 0); markDirty(); }; return i; }
    if (typeof v === "string") {
      if (IMAGE_KEYS.test(key) || path[0] === "offers") return imagePicker(path, key);
      const opts = selectOptions(key, path);
      if (opts) return selectBox(opts, path);
      return textInput(path, v);
    }
    if (v && typeof v === "object") return objectFields(v, path);
    return el("span", {}, String(v));
  }

  function selectOptions(key, path) {
    const pages = Object.keys(content.pages), contacts = Object.keys(content.contacts), offers = Object.keys(content.offers);
    const views = [];
    pages.forEach((p) => ["capacityImages", "floorPlanImages"].forEach((f) => { if (content.pages[p][f]) views.push([`view:${p}:${f}`, `Image pop-up: ${p} ${f === "capacityImages" ? "capacities" : "floor plan"}`]); }));
    if (key === "target") return [["", "— nothing —"], ["menu", "Main menu"]].concat(pages.map((p) => [p, "Page: " + p]), contacts.map((c) => ["contact:" + c, "Contact pop-up: " + c]), offers.map((o) => ["offers:" + o, "Offers pop-up: " + o]), views);
    if (key === "reservationContact" || key === "bookContact") return [["", "— nothing —"]].concat(contacts.map((c) => [c, "Contact pop-up: " + c]));
    if (key === "offers" && path[0] === "pages") return [["", "— nothing —"]].concat(offers.map((o) => [o, "Offers pop-up: " + o]));
    if (key === "type" && path[0] === "ads") return [["image", "Photo"], ["video", "Video"]];
    if (key === "defaultLanguage") return [["en", "English"], ["ar", "Arabic"]];
    if (key === "secondButton") return [["", "Make a Reservation"], ["moreInfo", "More Information"]];
    return null;
  }
  function selectBox(opts, path) {
    const s = el("select");
    const cur = getAt(path);
    if (!opts.some((o) => o[0] === cur)) opts = opts.concat([[cur, cur + " (not found)"]]);
    opts.forEach(([v, l]) => { const o = el("option", { value: v }, l); if (v === cur) o.selected = true; s.append(o); });
    s.onchange = () => { setAt(path, s.value); markDirty(); };
    return s;
  }
  function textInput(path, v, rtl) {
    v = v || "";
    const long = v.length > 60 || /\n/.test(v);
    const i = long ? el("textarea", { rows: Math.min(10, Math.max(3, Math.ceil(v.length / 60) + (v.match(/\n/g) || []).length)) }) : el("input", { type: "text" });
    i.value = v;
    if (rtl) i.dir = "rtl";
    i.oninput = () => { setAt(path, i.value); markDirty(); };
    return i;
  }
  function biText(v, path) {
    const en = textInput(path.concat("en"), v.en);
    const ar = textInput(path.concat("ar"), v.ar, true);
    ar.placeholder = "Arabic (English shows if empty)";
    const flag = () => ar.classList.toggle("empty-ar", !!(getAt(path.concat("en")) && !ar.value));
    flag(); ar.addEventListener("input", flag); en.addEventListener("input", flag);
    return el("div", { class: "bi" }, el("div", {}, el("div", { class: "lang" }, "ENGLISH"), en), el("div", {}, el("div", { class: "lang" }, "ARABIC"), ar));
  }
  function biImage(path, key) {
    return el("div", { class: "bi" },
      el("div", {}, el("div", { class: "lang" }, "ENGLISH"), imagePicker(path.concat("en"), key)),
      el("div", {}, el("div", { class: "lang" }, "ARABIC (optional)"), imagePicker(path.concat("ar"), key)));
  }

  /* ---------- images & uploads ---------- */
  const isLocal = (s) => /^assets\//.test(s);
  function imagePicker(path, key) {
    const val = () => getAt(path) || "";
    const thumb = el("div", { class: "thumb" });
    const note = el("span", { class: "note" });
    const bar = el("span", { class: "bar" }, el("i"));
    const draw = () => {
      const s = val();
      thumb.innerHTML = ""; note.textContent = ""; note.className = "note";
      if (!s) { thumb.innerHTML = ic("image") + "<span>No image yet</span>"; return; }
      const isVid = /\.(mp4|webm|mov|m4v)$/i.test(s) || /export=download/.test(s);
      const m = isVid ? el("video", { src: s, muted: "", playsinline: "", preload: "metadata" }) : el("img", { src: s, loading: "lazy" });
      m.onerror = () => { thumb.innerHTML = ic("image") + "<span>Can't show preview</span>"; note.textContent = isLocal(s) ? "Not uploaded yet" : "Can't load this file"; note.className = "note warn"; };
      thumb.append(m);
    };
    draw();
    const file = el("input", { type: "file", accept: key === "src" ? "image/*,video/mp4,video/webm,video/quicktime" : "image/*", style: "display:none" });
    file.onchange = async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      up.disabled = true; bar.style.display = "inline-block"; note.className = "note"; note.textContent = "Preparing…";
      try {
        const ready = await prepareFile(f, (t) => (note.textContent = t));
        note.textContent = `Uploading ${(ready.size / 1048576).toFixed(1)} MB to Drive…`;
        const slideshow = path[0] === "ads" || path[0] === "offers";
        const r = await gas("upload", {
          name: ready.name, mime: ready.type, data: await toBase64(ready),
          folder: slideshow ? "slideshow" : "media", subfolder: slideshow ? "" : (path[0] === "pages" ? path[1] : path[0])
        }, 180000);
        setAt(path, r.url); draw(); markDirty();
        note.textContent = "Uploaded"; note.className = "note ok";
      } catch (e) {
        note.textContent = "Upload failed: " + (e.name === "AbortError" ? "took too long. Try a smaller file." : e.message); note.className = "note bad";
      } finally { up.disabled = false; bar.style.display = "none"; upLabel(); }
    };
    const up = el("button", { class: "sbtn primary", onclick: () => file.click() });
    const upLabel = () => { up.innerHTML = ic("upload") + (val() ? "Replace" : "Upload"); };
    upLabel();
    const clr = el("button", { class: "sbtn", onclick: () => { setAt(path, ""); draw(); markDirty(); upLabel(); } }, "Clear");
    const open = el("button", { class: "sbtn", title: "Open file", onclick: () => { const s = val(); if (s) window.open(isLocal(s) ? s : s, "_blank"); } }, "View");
    return el("div", { class: "img" }, thumb, el("div", { class: "meta" }, el("div", { class: "row", style: "margin-top:0" }, up, clr, open, bar, note, file)));
  }

  const toBase64 = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(new Error("Couldn't read the file")); fr.readAsDataURL(f); });

  // Shrink large photos before upload (max 2400 px, good quality) so uploads are fast and reliable.
  async function prepareFile(f, status) {
    if (/^video\//.test(f.type)) {
      if (f.size > 30 * 1048576) throw new Error(`video is ${(f.size / 1048576).toFixed(0)} MB. Please export it under 30 MB (1080p MP4).`);
      return f;
    }
    if (f.type === "image/svg+xml" || f.type === "image/gif") return f;
    if (!/^image\//.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) throw new Error("that isn't an image or video file");
    let bmp;
    try { bmp = await createImageBitmap(f); }
    catch (e) { throw new Error("this image type can't be read here. Please save it as JPG or PNG."); }
    const max = 2400, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const keepPng = f.type === "image/png";
    if (scale === 1 && f.size < 1.5 * 1048576 && /^image\/(jpeg|png|webp)$/.test(f.type)) return f;
    status("Optimizing image…");
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const type = keepPng ? "image/png" : "image/jpeg";
    const blob = await new Promise((r) => c.toBlob(r, type, 0.86));
    const name = f.name.replace(/\.[^.]+$/, "") + (keepPng ? ".png" : ".jpg");
    const out = new File([blob], name, { type });
    if (out.size > 30 * 1048576) throw new Error("image is still too large after optimizing");
    return out;
  }

  function iconPicker(path) {
    const thumb = el("div", { class: "thumb icon-thumb" });
    const draw = () => { const v = getAt(path) || ""; thumb.innerHTML = /[./]/.test(v) ? `<img src="${v}" alt="">` : `<svg viewBox="0 0 24 24">${ICONS[v] || ""}</svg>`; };
    const sel = el("select");
    const cur = getAt(path) || "";
    sel.append(el("option", { value: "" }, "— none —"));
    Object.keys(ICONS).sort().forEach((n) => { const o = el("option", { value: n }, n); if (n === cur) o.selected = true; sel.append(o); });
    if (/[./]/.test(cur)) { const o = el("option", { value: cur }, "Custom file"); o.selected = true; sel.append(o); }
    sel.onchange = () => { setAt(path, sel.value); draw(); markDirty(); };
    const note = el("span", { class: "note" });
    const file = el("input", { type: "file", accept: ".svg,image/png", style: "display:none" });
    file.onchange = async () => {
      const f = file.files[0]; file.value = ""; if (!f) return;
      note.textContent = "Uploading…";
      try {
        const r = await gas("upload", { name: f.name, mime: f.type || "image/svg+xml", data: await toBase64(f), folder: "media", subfolder: "icons" }, 60000);
        setAt(path, r.url); const o = el("option", { value: r.url }, "Custom file"); sel.append(o); sel.value = r.url;
        draw(); markDirty(); note.textContent = "";
      } catch (e) { note.textContent = "Upload failed: " + e.message; note.className = "note bad"; }
    };
    draw();
    return el("div", { class: "img" }, thumb, el("div", { class: "meta" }, el("div", { class: "row", style: "margin-top:0" }, sel, el("button", { class: "sbtn", onclick: () => file.click() }, "Use my SVG…"), note, file)));
  }

  /* ---------- lists (accordion items) ---------- */
  function blankLike(v) {
    if (typeof v === "string") return "";
    if (typeof v === "number") return 0;
    if (typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.length ? [blankLike(v[0])] : [];
    if (v && typeof v === "object") { const o = {}; for (const k in v) o[k] = (k === "icon" || k === "type") ? v[k] : blankLike(v[k]); return o; }
    return v;
  }
  function arrayEditor(arr, path, key, openIndex) {
    const objects = arr.length && typeof arr[0] === "object" && !isBi(arr[0]);
    const images = !objects && (IMAGE_KEYS.test(key) || path[0] === "offers" || key === "gallery");
    const wrap = el("div", { class: images ? "img-grid" : "" });
    const rerender = (open) => { const n = arrayEditor(getAt(path), path, key, open); wrap.replaceWith(n); markDirty(); };
    const move = (i, d) => { const a = getAt(path); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; rerender(j); };
    const remove = (i) => { if (!confirm("Remove this item?")) return; getAt(path).splice(i, 1); rerender(-1); };
    const dup = (i) => { const a = getAt(path); a.splice(i + 1, 0, JSON.parse(JSON.stringify(a[i]))); rerender(i + 1); };
    const ctrls = (i) => [
      el("button", { class: "ib", title: "Move up", onclick: (e) => { e.stopPropagation(); move(i, -1); } }, "↑"),
      el("button", { class: "ib", title: "Move down", onclick: (e) => { e.stopPropagation(); move(i, 1); } }, "↓"),
      objects ? el("button", { class: "ib", title: "Duplicate", onclick: (e) => { e.stopPropagation(); dup(i); } }, "⧉") : "",
      el("button", { class: "ib danger", title: "Remove", onclick: (e) => { e.stopPropagation(); remove(i); } }, "✕")
    ];
    arr.forEach((item, i) => {
      const p = path.concat(i);
      if (objects) {
        const title = textOf(item.title) || textOf(item.label) || textOf(item.text) || (item.src ? (textOf(item.src).split("/").pop() || "Slide") : "") || textOf(item.value) || human(key) + " " + (i + 1);
        const box = el("div", { class: "item" + (i === openIndex ? " open" : "") + (item.active === false ? " off" : "") });
        const chev = el("span", { class: "chev" }, icEl("chevronRight"));
        chev.firstChild.style.cssText = "width:16px;height:16px";
        const head = el("div", { class: "item-h" }, el("span", { class: "num" }, String(i + 1)), el("span", { class: "t" }, one(title).slice(0, 90)), ...ctrls(i), chev);
        const body = el("div", { class: "item-b" });
        head.onclick = () => {
          const willOpen = !box.classList.contains("open");
          [...wrap.children].forEach((x) => x.classList && x.classList.remove("open"));
          if (willOpen) { if (!body.childElementCount) body.append(objectFields(item, p)); box.classList.add("open"); }
        };
        if (i === openIndex) body.append(objectFields(item, p));
        box.append(head, body);
        wrap.append(box);
      } else {
        if (images) wrap.append(el("div", { class: "arr-row" }, el("div", {}, node(item, p, key)), el("span", { class: "num" }, i === 0 && path[0] !== "offers" ? "Featured" : String(i + 1)), el("div", { class: "ctrls" }, ...ctrls(i))));
        else wrap.append(el("div", { class: "arr-row" }, el("div", {}, node(item, p, key)), ...ctrls(i)));
      }
    });
    const add = el("button", { class: "sbtn add", onclick: () => {
      const a = getAt(path);
      a.push(a.length ? blankLike(a[a.length - 1]) : "");
      rerender(a.length - 1);
    } });
    add.innerHTML = ic("plus") + "Add " + (key === "ads" ? "Slide" : images || /gallery|photos|menuImages|Images$/.test(key) || path[0] === "offers" ? "Image" : "Item");
    wrap.append(add);
    return wrap;
  }

  /* ---------- pages ---------- */
  function slug(s) { return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function duplicatePage(s) {
    const name = prompt("Name for the new page (e.g. “Club Lounge”):");
    if (!name) return;
    let id = slug(name) || "page";
    while (content.pages[id]) id += "-2";
    const copy = JSON.parse(JSON.stringify(content.pages[s.pageId]));
    if (copy.title) copy.title = { en: name, ar: "" };
    if (copy.name) copy.name = { en: name, ar: "" };
    content.pages[id] = copy;
    if (s.parent && content.pages[s.parent].items) {
      const items = content.pages[s.parent].items;
      const src = items.find((it) => it.target === s.pageId) || items[0];
      const card = JSON.parse(JSON.stringify(src));
      card.target = id; card.title = { en: name, ar: "" };
      items.push(card);
    }
    markDirty(); renderNav(); select(findSection(id));
    toast("Page created. Replace its photos and text.");
  }
  function deletePage(s) {
    if (!confirm(`Delete “${s.title}”? Its card on the list page is removed too.`)) return;
    delete content.pages[s.pageId];
    Object.values(content.pages).forEach((p) => { if (p.items) p.items = p.items.filter((it) => it.target !== s.pageId); });
    (content.menu.tiles || []).forEach((t) => { if (t.target === s.pageId) t.target = ""; });
    markDirty(); renderNav(); select(s.parent ? findSection(s.parent) : firstSection());
  }

  /* ================= boot ================= */
  ping();
  if (pin) {
    gas("check", {}, 20000).then(start).catch(() => lock(""));
  } else {
    lock("");
  }
})();
