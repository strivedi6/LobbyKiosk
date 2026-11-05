/* =========================================================
   Embassy Suites lobby screen — app
   Reads everything from content (content.json today, a Google
   Sheet later) and renders the Figma screens at 1080 x 1920.
   ========================================================= */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const PREVIEW = params.has("preview");
  const stage = document.getElementById("stage");
  const ICONS = window.KIOSK_ICONS || {};

  const state = {
    content: null,
    version: null,
    lang: "en",
    stack: [],            // navigation history: page ids ("home", "menu", or a page key)
    overlay: null,        // { kind, id }
    idleTimer: null,
    adTimer: null,
    adIndex: 0
  };

  /* ---------------- Data source ----------------
     "local": content.json served by server.py on the Mac.
     "sheet": a Google Apps Script web-app URL that returns the same
              JSON shape (added in the Google Sheet phase). */
  const DataSource = {
    async load() {
      const local = await fetchJSON("content.json?t=" + Date.now());
      const s = local && local.settings;
      if (s && s.dataSource === "sheet" && s.googleSheetUrl) {
        try { return await fetchJSON(s.googleSheetUrl); } catch (e) { console.warn("Sheet unavailable, using local content", e); }
      }
      return local;
    },
    async version() {
      const v = await fetchJSON("api/version?t=" + Date.now());
      return v && v.version;
    }
  };

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  /* ---------------- Helpers ---------------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // bilingual text: falls back to English when Arabic is empty
  const tx = (v) => (v == null ? "" : typeof v === "string" ? v : (v[state.lang] || v.en || ""));
  const T = (v) => esc(tx(v));
  const L = (key) => T(state.content.labels[key]);
  const isPath = (s) => typeof s === "string" && /[./]/.test(s);

  function icon(name, cls = "") {
    if (!name) return "";
    if (isPath(name)) return `<span class="ico ${cls}"><img src="${esc(name)}" alt=""></span>`;
    const p = ICONS[name] || ICONS.star;
    return `<span class="ico ${cls}"><svg viewBox="0 0 24 24">${p}</svg></span>`;
  }

  // image slot with a visible placeholder when the file isn't there yet
  function pic(src, cls = "", style = "") {
    const s = tx(src);
    if (!s) return `<div class="ph missing ${cls}" style="${style}" data-file="(no image set)"></div>`;
    const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(s);
    const media = isVideo
      ? `<video src="${esc(s)}" muted playsinline loop autoplay></video>`
      : `<img src="${esc(s)}" alt="" loading="lazy" decoding="async">`;
    return `<div class="ph ${cls}" style="${style}" data-file="${esc(s)}">${media}</div>`;
  }

  // logo image; if the file is missing, shows the name as text
  function logo(src, fallbackText, cls = "") {
    const s = tx(src);
    if (!s) return `<div class="${cls}"><span class="logo-fallback">${esc(fallbackText || "")}</span></div>`;
    return `<div class="${cls}"><img class="logo-img" src="${esc(s)}" alt="${esc(fallbackText || "")}" style="width:100%;height:100%" data-fallback="1"></div>`;
  }

  function wireImageFallbacks(root) {
    root.querySelectorAll(".ph img, .ph video").forEach((m) => {
      const ph = m.parentElement;
      const fail = () => { ph.classList.add("missing"); m.remove(); };
      if (m.tagName === "IMG") { if (m.complete && m.naturalWidth === 0 && m.src) fail(); else m.addEventListener("error", fail, { once: true }); }
      else m.addEventListener("error", fail, { once: true });
    });
    root.querySelectorAll("img[data-fallback]").forEach((m) => {
      m.addEventListener("error", () => { const sp = document.createElement("span"); sp.className = "logo-fallback"; sp.textContent = m.alt; m.replaceWith(sp); }, { once: true });
    });
    root.querySelectorAll(".ico img").forEach((m) => m.addEventListener("error", () => { m.parentElement.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.star}</svg>`; }, { once: true }));
  }

  /* ---------------- Shared chrome ---------------- */
  function chrome({ lang = "glass", back = null, footer = true } = {}) {
    const c = state.content;
    let h = `<button class="es-logo" data-act="home">${logo(c.brand.propertyLogo, "EMBASSY SUITES", "")}</button>`;
    h += `<button class="lang-btn ${lang}" data-act="lang">${icon("translate")}<span>${L("language")}</span></button>`;
    if (back) h += `<button class="back-btn ${back.outlined ? "outlined" : ""}" style="top:${back.top}px" data-act="back"><span class="chev">${icon("chevronLeft")}</span>${L("back")}</button>`;
    if (footer) h += footerHTML();
    return h;
  }

  function footerHTML() {
    const c = state.content;
    const helpLines = state.lang === "ar"
      ? `<span class="ar-line" style="margin-top:8px">${L("needHelp")}</span><span class="ar-line">${L("contactReception")}</span>`
      : `<b>${L("needHelp")}</b><span>${L("contactReception")}</span>`;
    return `<div class="footer">
      <button class="f-home" data-act="menu">${icon("home")}<span>${L("home")}</span></button>
      <div class="f-logo">${logo(c.brand.footerLogo, "Hilton")}</div>
      <button class="f-help" data-go="contact:reception">${icon("help")}${helpLines}</button>
    </div>`;
  }

  /* ---------------- Screens ---------------- */
  const Screens = {
    home() {
      const c = state.content, h = c.home;
      const ads = (c.ads || []).filter((a) => a.active !== false && tx(a.src));
      const slides = ads.map((a, i) => {
        const s = tx(a.src);
        const isVideo = a.type === "video" || /\.(mp4|webm|mov|m4v)$/i.test(s);
        const media = isVideo ? `<video src="${esc(s)}" muted playsinline preload="auto"></video>` : `<img src="${esc(s)}" alt="">`;
        return `<div class="ad ph${i === 0 ? " on" : ""}" data-i="${i}" data-video="${isVideo ? 1 : 0}" data-file="${esc(s)}" ${a.target ? `data-go="${esc(a.target)}"` : `data-act="menu"`}>${media}</div>`;
      }).join("");
      const dots = ads.length > 1 ? `<div class="ad-dots">${ads.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>` : "";
      const pillars = (h.pillars || []).map((p) => `<div class="pillar">${icon(p.icon)}<span>${T(p.text)}</span></div>`).join("");
      return `<div class="screen home">
        <div class="ads">${slides || pic("", "", "position:absolute;inset:0")}${dots}</div>
        <button class="lang-btn light" data-act="lang">${icon("translate")}<span>${L("language")}</span></button>
        <div class="explore">${T(h.explore)}</div>
        <button class="start" data-act="menu">
          <span class="hand">${icon("hand")}</span>
          <span class="label">${T(h.start)}</span>
          <span class="arrow">${icon("arrowRight")}</span>
        </button>
        <div class="tap">${T(h.tapText)}</div>
        <div class="pillars">${pillars}</div>
      </div>`;
    },

    menu() {
      const m = state.content.menu;
      const pos = [[50, 455], [553, 455], [50, 863], [553, 863], [50, 1270], [553, 1270]];
      const rtl = state.lang === "ar";
      const tiles = (m.tiles || []).slice(0, 6).map((t, i) => {
        let [x, y] = pos[i];
        if (rtl) x = x === 50 ? 553 : 50;   // mirror the grid in Arabic
        return `<button class="tile" style="left:${x}px;top:${y}px" data-go="${esc(t.target)}">
          ${pic(t.image)}<div class="shade"></div>
          ${icon(t.icon, "t-ico")}
          <div class="t-title">${T(t.title)}</div>
          <div class="t-sub">${T(t.subtitle)}</div>
          <span class="round-arrow outline">${icon("chevronRight")}</span>
        </button>`;
      }).join("");
      return `<div class="screen menu">
        <div class="bg">${pic(m.background, "", "position:absolute;inset:0")}</div>
        <div class="welcome">${T(m.welcome)}</div>
        <div class="headline">${T(m.headline)}</div>
        ${tiles}
        ${chrome()}
      </div>`;
    },

    list(p) {
      const feature = p.cardStyle !== "venue";
      const cards = (p.items || []).map((it) => {
        const meta = (it.meta || []).slice(0, 2).map((m) => `<div><span class="dot">${icon(m.icon)}</span>${T(m.text)}</div>`).join("");
        const top = feature
          ? `<div class="c-title">${T(it.title)}</div>`
          : `${logo(it.logo, tx(it.title), "c-logo")}<div class="c-tag">${T(it.tagline)}</div>`;
        return `<button class="card ${feature ? "feature" : ""}" ${it.target ? `data-go="${esc(it.target)}"` : ""}>
          ${pic(it.image)}
          <div class="body">
            ${top}
            <div class="c-text">${T(it.text)}</div>
            <div class="c-meta">${meta}</div>
            ${it.target ? `<span class="round-arrow berry">${icon("chevronRight")}</span>` : ""}
          </div>
        </button>`;
      }).join("");
      return `<div class="screen list-page">
        <div class="bg">${pic(p.background, "", "position:absolute;inset:0")}</div>
        <div class="page-head"><h1>${T(p.title)}</h1><div class="rule"></div><h2>${T(p.headline)}</h2><p>${T(p.text)}</p></div>
        <div class="list-scroll"><div class="inner">${cards}</div></div>
        <div class="list-fade"></div>
        ${chrome({ back: { top: 396 } })}
      </div>`;
    },

    venue(p, id) {
      const info = infoStrip(p.info);
      const hasMenu = (p.menuImages || []).some(Boolean);
      const gallery = (p.gallery || []).map((g) => pic(g)).join("");
      return `<div class="screen detail">
        <div class="hero">${pic(p.hero, "", "position:absolute;inset:0")}<div class="shade"></div></div>
        ${logo(p.heroLogo, tx(p.name), "hero-logo")}
        <div class="hero-copy"><h3>${T(p.headline)}</h3><p>${T(p.text)}</p></div>
        ${info}
        <div class="cta-row">
          <button class="pill primary" ${hasMenu ? `data-go="menu:${esc(id)}"` : ""}>${icon("cutlery")}<span class="lbl">${L("viewMenu")}</span><span class="chev">${icon("chevronRight")}</span></button>
          <button class="pill secondary" ${p.reservationContact ? `data-go="contact:${esc(p.reservationContact)}"` : ""}>${icon("calendar")}<span class="lbl">${L("makeReservation")}</span></button>
          <button class="pill secondary" ${p.offers ? `data-go="offers:${esc(p.offers)}"` : ""}>${icon("offer")}<span class="lbl">${L("viewOffers")}</span></button>
        </div>
        <div class="gallery"><div class="track">${gallery}</div></div>
        ${banner(p.banner, 1462)}
        ${chrome({ back: { top: 602 } })}
      </div>`;
    },

    facility(p) {
      const photos = (p.photos || []);
      const feats = (p.features || []).slice(0, 4).map((f, i) =>
        `<div class="fc" style="top:${[843, 987, 1131, 1276][i]}px">${icon(f.icon)}<div><b>${T(f.title)}</b><span>${T(f.text)}</span></div></div>`).join("");
      return `<div class="screen detail">
        <div class="hero">${pic(p.hero, "", "position:absolute;inset:0")}<div class="shade"></div></div>
        <div class="hero-title">${T(p.title)}</div>
        <div class="hero-copy"><h3>${T(p.headline)}</h3><p>${T(p.text)}</p></div>
        ${infoStrip(p.info)}
        <div class="mosaic">${pic(photos[0], "m1")}${pic(photos[1], "m2")}${pic(photos[2], "m3")}</div>
        <div class="features">${feats}</div>
        ${banner(p.banner, 1441)}
        ${chrome({ back: { top: 602 } })}
      </div>`;
    },

    room(p) {
      const gallery = (p.gallery || []).map((g) => pic(g)).join("");
      const hl = (p.highlights || []).map((h) => `<div class="h">${icon(h.icon)}<div><b>${T(h.title)}</b><ul>${(h.items || []).map((i) => `<li>${T(i)}</li>`).join("")}</ul></div></div>`).join("");
      const usps = (p.usps || []).slice(0, 3).map((u) => `<div class="u">${icon(u.icon)}<span>${T(u.text)}</span></div>`).join("");
      return `<div class="screen detail">
        <div class="room-gallery"><div class="track">${gallery}</div></div>
        <div class="room-title">${T(p.title)}</div>
        <button class="book-btn" ${p.bookContact ? `data-go="contact:${esc(p.bookContact)}"` : ""}>${L("bookNow")}</button>
        <p class="room-text">${T(p.text)}</p>
        <div class="room-hl-title">${L("roomHighlights")}</div>
        <div class="room-rule"></div>
        <div class="room-hl">${hl}</div>
        <div class="usp-strip">${usps}</div>
        ${chrome({ lang: "tint", back: { top: 215, outlined: true } })}
      </div>`;
    },

    guide(p) {
      const secs = (p.sections || []).map((s) => `<div class="g-sec">${tx(s.image) ? pic(s.image) : ""}<div class="in"><h4>${icon(s.icon)}${T(s.title)}</h4><p>${T(s.text)}</p></div></div>`).join("");
      return `<div class="screen guide">
        <div class="guide-scroll">
          <div class="g-hero">${pic(p.hero)}<div class="shade"></div>
            ${logo(p.logo, "Hilton", "g-logo")}
            <div class="g-welcome">${T(p.welcome)}</div>
            <div class="g-title">${T(p.title)}</div>
          </div>
          <p class="g-intro">${T(p.intro)}</p>
          ${secs}
          <div class="g-end"></div>
        </div>
        <div class="footer-bg"></div>
        ${chrome({ back: { top: 396 } })}
      </div>`;
    }
  };

  function infoStrip(items) {
    return `<div class="info-strip">${(items || []).slice(0, 3).map((i) => `<div class="it">${icon(i.icon)}<div><b>${T(i.label)}</b><span>${T(i.value)}</span></div></div>`).join("")}</div>`;
  }

  function banner(b, top) {
    if (!b || !tx(b.image)) return "";
    return `<button class="banner" style="top:${top}px" ${b.target ? `data-go="${esc(b.target)}"` : ""}>${pic(b.image)}</button>`;
  }

  /* ---------------- Pop-ups ---------------- */
  const Popups = {
    contact(id) {
      const k = state.content.contacts[id];
      if (!k) return "";
      return `<div class="pop contact-pop" dir="${state.lang === "ar" ? "rtl" : "ltr"}">
        <div class="head">${pic(k.headerImage, "", "position:absolute;inset:0")}${tx(k.logo) ? logo(k.logo, "", "c-logo") : ""}</div>
        <button class="pop-close" data-act="close">${icon("close")}</button>
        <div class="cols">
          <div class="col"><div class="circle">${icon("phone")}</div><h5>${L("callUs")}</h5>
            <div class="hl" style="margin-top:30px">${esc(k.phone)}</div><div class="hl">${esc(k.extension)}</div>
            <div class="note">${T(k.callNote)}</div></div>
          <div class="col"><div class="circle">${icon("whatsapp")}</div><h5>${L("chatWithUs")}</h5>
            ${pic(k.qrImage, "qr")}<div class="qrnote">${L("scanQr")}</div></div>
          <div class="col"><div class="circle">${icon("mail")}</div><h5>${L("emailUs")}</h5>
            <div class="mail">${esc(k.email)}</div><div class="note">${L("emailNote")}</div></div>
        </div>
      </div>`;
    },
    menu(pageId) {
      const p = state.content.pages[pageId];
      const pages = (p && p.menuImages || []).map((m) => pic(m)).join("");
      return `<div class="pop menu-pop"><button class="pop-close" data-act="close">${icon("close")}</button><div class="pages">${pages}</div></div>`;
    },
    offers(id) {
      const imgs = state.content.offers[id] || [];
      return `<div class="pop offers-pop"><button class="pop-close" data-act="close">${icon("close")}</button>
        <div class="rail">${imgs.map((m) => pic(m)).join("")}</div>
        ${imgs.length > 1 ? `<div class="dots">${imgs.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}</div>`;
    }
  };

  /* ---------------- Rendering ---------------- */
  function current() { return state.stack[state.stack.length - 1] || "home"; }

  function render(animate = true) {
    stopAds();
    const id = current();
    const c = state.content;
    let html;
    if (id === "home") html = Screens.home();
    else if (id === "menu") html = Screens.menu();
    else {
      const p = c.pages[id];
      const fn = p && Screens[p.template];
      html = fn ? fn(p, id) : Screens.menu();
    }
    if (state.overlay) {
      const [kind, oid] = state.overlay;
      const inner = Popups[kind] ? Popups[kind](oid) : "";
      if (inner) html += `<div class="overlay" data-act="close-bg">${inner}</div>`;
    }
    stage.setAttribute("dir", state.lang === "ar" ? "rtl" : "ltr");
    stage.setAttribute("lang", state.lang);
    stage.innerHTML = html;
    const scr = stage.querySelector(".screen");
    if (animate && scr) scr.classList.add("enter");
    wireImageFallbacks(stage);
    wireDots(stage);
    if (id === "home") startAds();
  }

  function wireDots(root) {
    const rail = root.querySelector(".offers-pop .rail");
    if (!rail) return;
    const dots = root.querySelectorAll(".offers-pop .dots i");
    rail.addEventListener("scroll", () => {
      const i = Math.round(rail.scrollLeft / 800);
      dots.forEach((d, j) => d.classList.toggle("on", i === j));
    }, { passive: true });
  }

  /* ---------------- Ad slideshow ---------------- */
  function startAds() {
    const slides = [...stage.querySelectorAll(".home .ad")];
    const dots = [...stage.querySelectorAll(".home .ad-dots i")];
    if (!slides.length) return;
    const ads = (state.content.ads || []).filter((a) => a.active !== false && tx(a.src));
    const show = (i) => {
      state.adIndex = i;
      slides.forEach((s, j) => s.classList.toggle("on", i === j));
      dots.forEach((d, j) => d.classList.toggle("on", i === j));
      const slide = slides[i];
      const ad = ads[i] || {};
      clearTimeout(state.adTimer);
      const next = () => show((i + 1) % slides.length);
      const vid = slide.querySelector("video");
      if (vid) {
        vid.currentTime = 0;
        vid.loop = slides.length === 1;
        vid.play().catch(() => {});
        if (ad.seconds > 0) state.adTimer = setTimeout(next, ad.seconds * 1000);
        else if (slides.length > 1) { vid.onended = next; vid.onerror = next; }
      } else if (slides.length > 1) {
        state.adTimer = setTimeout(next, (ad.seconds > 0 ? ad.seconds : (state.content.settings.adImageSeconds || 8)) * 1000);
      }
      slides.forEach((s, j) => { if (j !== i) { const v = s.querySelector("video"); if (v) v.pause(); } });
    };
    show(0);
  }
  function stopAds() { clearTimeout(state.adTimer); stage.querySelectorAll(".home video").forEach((v) => v.pause()); }

  /* ---------------- Navigation ---------------- */
  function go(target) {
    if (!target) return;
    const [kind, id] = target.includes(":") ? target.split(":") : ["page", target];
    if (kind === "contact" || kind === "offers" || kind === "menu") {
      state.overlay = [kind, id];
      render(false);
      return;
    }
    if (target === "menu" || state.content.pages[target]) {
      state.overlay = null;
      state.stack.push(target);
      render();
    }
  }

  function back() {
    if (state.overlay) { state.overlay = null; render(false); return; }
    state.stack.pop();
    if (!state.stack.length) state.stack = ["home"];
    render();
  }

  function goHome(resetLang) {
    state.overlay = null;
    state.stack = ["home"];
    if (resetLang) state.lang = state.content.settings.defaultLanguage || "en";
    render();
  }

  stage.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act],[data-go]");
    if (!el || !stage.contains(el)) return;
    const act = el.dataset.act;
    if (el.dataset.go) return go(el.dataset.go);
    if (act === "lang") { state.lang = state.lang === "en" ? "ar" : "en"; render(false); }
    else if (act === "back") back();
    else if (act === "menu") { state.overlay = null; state.stack = ["home", "menu"]; render(); }
    else if (act === "home") goHome(false);
    else if (act === "close") { state.overlay = null; render(false); }
    else if (act === "close-bg" && e.target === el) { state.overlay = null; render(false); }
  });

  /* ---------------- Idle → back to the attract screen ---------------- */
  function resetIdle() {
    clearTimeout(state.idleTimer);
    if (PREVIEW) return;
    const secs = (state.content && state.content.settings.idleSeconds) || 90;
    state.idleTimer = setTimeout(() => { if (current() !== "home" || state.overlay || state.lang !== (state.content.settings.defaultLanguage || "en")) goHome(true); }, secs * 1000);
  }
  ["pointerdown", "touchstart", "keydown", "wheel"].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));
  stage.addEventListener("scroll", resetIdle, { capture: true, passive: true });

  /* ---------------- Scale stage to the screen ---------------- */
  function fit() {
    const s = Math.min(innerWidth / 1080, innerHeight / 1920);
    stage.style.transform = `translate(${(innerWidth - 1080 * s) / 2}px, ${(innerHeight - 1920 * s) / 2}px) scale(${s})`;
  }
  addEventListener("resize", fit);

  /* ---------------- Live updates from the Mac ---------------- */
  const offline = document.getElementById("offline");
  async function checkForUpdates() {
    try {
      const v = await DataSource.version();
      offline.classList.remove("show");
      if (v !== state.version) {
        state.version = v;
        const fresh = await DataSource.load();
        apply(fresh, true);
      }
    } catch (e) {
      offline.classList.add("show");
    }
    const secs = (state.content && state.content.settings.contentCheckSeconds) || 10;
    setTimeout(checkForUpdates, secs * 1000);
  }

  function apply(content, keepPlace) {
    state.content = content;
    try { localStorage.setItem("kiosk-content", JSON.stringify(content)); } catch (e) {}
    if (!keepPlace) return;
    // stay on the same screen if it still exists
    state.stack = state.stack.filter((id) => id === "home" || id === "menu" || content.pages[id]);
    if (!state.stack.length) state.stack = ["home"];
    if (state.overlay) {
      const [k, id] = state.overlay;
      const ok = (k === "contact" && content.contacts[id]) || (k === "offers" && content.offers[id]) || (k === "menu" && content.pages[id]);
      if (!ok) state.overlay = null;
    }
    render(false);
  }

  /* ---------------- Admin live preview ---------------- */
  if (PREVIEW) {
    addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "content") apply(d.content, true);
      if (d.type === "goto") {
        state.lang = d.lang || state.lang;
        state.overlay = null;
        state.stack = d.page === "home" ? ["home"] : d.page === "menu" ? ["home", "menu"] : ["home", "menu", d.page];
        if (d.overlay) state.overlay = d.overlay.split(":");
        render(false);
      }
    });
  }

  /* ---------------- Boot ---------------- */
  async function boot() {
    if (!PREVIEW) document.body.classList.add("kiosk-mode");
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    fit();
    let content = null;
    try { content = await DataSource.load(); }
    catch (e) { try { content = JSON.parse(localStorage.getItem("kiosk-content")); } catch (_) {} }
    if (!content) { stage.innerHTML = '<div style="color:#fff;font:40px sans-serif;padding:80px">Waiting for content…</div>'; setTimeout(boot, 5000); return; }
    apply(content, false);
    state.lang = params.get("lang") || content.settings.defaultLanguage || "en";
    const startPage = params.get("page");
    state.stack = startPage && startPage !== "home" ? (startPage === "menu" ? ["home", "menu"] : ["home", "menu", startPage]) : ["home"];
    render();
    resetIdle();
    try { state.version = await DataSource.version(); } catch (e) {}
    if (!PREVIEW) setTimeout(checkForUpdates, (content.settings.contentCheckSeconds || 10) * 1000);
    if (PREVIEW && window.parent !== window) window.parent.postMessage({ type: "preview-ready" }, "*");
  }
  boot();
})();
