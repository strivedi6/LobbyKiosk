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
  const CFG = window.KIOSK_CONFIG || {};
  const DataSource = {
    // Google Sheet (via Apps Script) first; content.json if the sheet is empty or unreachable.
    async load() {
      if (CFG.scriptUrl) {
        try {
          const c = await fetchJSON(CFG.scriptUrl + (CFG.scriptUrl.includes("?") ? "&" : "?") + "action=content&t=" + Date.now());
          if (c && c.pages && c.settings) return c;
        } catch (e) { console.warn("Sheet unavailable", e); }
        // sheet unreachable: keep showing the last good copy if we have one
        const cached = readCache();
        if (cached) return cached;
      }
      return await fetchJSON("content.json?t=" + Date.now());
    },
    async version() {
      if (!CFG.scriptUrl) {
        try {
          const r = await fetch("api/version?t=" + Date.now(), { cache: "no-store" });
          if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
            const v = await r.json();
            if (v && v.version) return { version: v.version };
          }
        } catch (e) {}
      }
      const content = await DataSource.load();
      return { version: hash(JSON.stringify(content)), content };
    }
  };
  function readCache() { try { return JSON.parse(localStorage.getItem("kiosk-content")); } catch (e) { return null; } }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h);
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  /* ---------------- Helpers ---------------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // bilingual text: falls back to English when Arabic is empty
  const tx = (v) => (v == null ? "" : typeof v === "string" ? v : (v[state.lang] || v.en || ""));
  // English shown inside the Arabic layout keeps its own text direction
  const T = (v) => {
    const out = esc(tx(v));
    const fallback = state.lang === "ar" && v && typeof v === "object" && !v.ar && v.en;
    return fallback ? `<span dir="ltr" class="fb">${out}</span>` : out;
  };
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
      if (m.tagName === "IMG") {
        if (m.complete && m.naturalWidth > 0) m.classList.add("loaded");
        else if (m.complete && m.src) fail();
        else { m.addEventListener("error", fail, { once: true }); m.addEventListener("load", () => m.classList.add("loaded"), { once: true }); }
      }
      else m.addEventListener("error", fail, { once: true });
    });
    root.querySelectorAll("img[data-fallback]").forEach((m) => {
      m.addEventListener("error", () => { const sp = document.createElement("span"); sp.className = "logo-fallback"; sp.textContent = m.alt; m.replaceWith(sp); }, { once: true });
    });
    root.querySelectorAll(".ico img").forEach((m) => m.addEventListener("error", () => { m.parentElement.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.star}</svg>`; }, { once: true }));
  }

  /* ---------------- Shared chrome ---------------- */
  function chrome({ lang = "glass", back = null, footer = true, onWhite = false, logo: showLogo = true } = {}) {
    const c = state.content;
    const lg = onWhite && tx(c.brand.propertyLogoOnWhite) ? c.brand.propertyLogoOnWhite : c.brand.propertyLogo;
    let h = showLogo ? esLogo(lg) : "";
    h += `<button class="lang-btn ${lang}" data-act="lang">${icon("translate")}<span>${L("language")}</span></button>`;
    if (back) h += `<button class="back-btn ${back.outlined ? "outlined" : ""} ${back.cls || ""}" style="top:${back.top}px" data-act="back"><span class="chev">${icon("chevronLeft")}</span>${L("back")}</button>`;
    if (footer) h += footerHTML();
    return h;
  }

  function esLogo(src) { return `<button class="es-logo" data-act="home">${logo(src, "EMBASSY SUITES", "")}</button>`; }

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
      const pillars = (h.pillars || []).map((p) => `<div class="pillar">${icon(p.icon)}<span>${T(p.text)}</span></div>`).join("");
      return `<div class="screen home">
        <div class="ads">${slides || pic("", "", "position:absolute;inset:0")}</div>
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
      const tiles = (m.tiles || []).slice(0, 6).map((t, i) => {
        const [x, y] = pos[i];   // same grid order as the Arabic Figma frame
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
      if (p.cardStyle === "attraction") return Screens.attractions(p);
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

    attractions(p) {
      const lab = ["distanceFromHotel", "openingTime", "perfectFor"];
      const cards = (p.items || []).map((it) => {
        const meta = (it.meta || []).slice(0, 3).map((m, i) => `<div class="am">${icon(m.icon)}<div><span>${L(lab[i])}</span><b>${T(m.text)}</b></div></div>`).join("");
        return `<div class="card attraction" ${it.target ? `data-go="${esc(it.target)}"` : ""}>
          ${pic(it.image)}
          ${tx(it.tagline) ? `<div class="badge"><i>★</i> ${T(it.tagline)}</div>` : ""}
          <div class="a-body"><h3>${T(it.title)}</h3><p>${T(it.text)}</p><div class="a-rule"></div><div class="a-meta">${meta}</div></div>
        </div>`;
      }).join("");
      return `<div class="screen list-page">
        <div class="bg">${pic(p.background, "", "position:absolute;inset:0")}</div>
        <div class="page-head"><h1>${T(p.title)}</h1><div class="rule"></div><h2>${T(p.headline)}</h2><p>${T(p.text)}</p></div>
        <div class="list-scroll attractions-scroll"><div class="inner">${cards}</div></div>
        <div class="list-fade"></div>
        ${chrome({ back: { top: 396 } })}
      </div>`;
    },

    meeting(p, id) {
      const btns = (p.buttons || []).slice(0, 3).map((b, i) => {
        const go = b.target ? `data-go="${esc(b.target)}"` : "";
        return i === 0
          ? `<button class="pill primary" ${go}>${icon(b.icon)}<span class="lbl pre two">${T(b.label)}</span><span class="chev">${icon("chevronRight")}</span></button>`
          : `<button class="pill secondary" ${go}>${icon(b.icon)}<span class="lbl pre">${T(b.label)}</span></button>`;
      }).join("");
      const info = `<div class="info-strip plain">${(p.info || []).slice(0, 4).map((i) => `<div class="it">${icon(i.icon)}<span class="pre">${T(i.value)}</span></div>`).join("")}</div>`;
      const gallery = (p.gallery || []).map((g) => pic(g)).join("");
      return `<div class="screen detail meeting">
        <div class="hero">${pic(p.hero, "", "position:absolute;inset:0")}<div class="shade"></div></div>
        <div class="hero-title">${T(p.title)}</div>
        <div class="hero-copy"><h3>${T(p.headline)}</h3><p>${T(p.text)}</p></div>
        ${info}
        <div class="cta-row">${btns}</div>
        <div class="gallery"><div class="track">${gallery}</div></div>
        ${banner(p.banner, 1473)}
        ${chrome({ back: { top: 602 } })}
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
          <button class="pill secondary" ${p.reservationContact ? `data-go="contact:${esc(p.reservationContact)}"` : ""}>${icon("calendar")}<span class="lbl">${L(p.secondButton === "moreInfo" ? "moreInformation" : "makeReservation")}</span></button>
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
        ${chrome({ lang: "tint", back: { top: 215, outlined: true, cls: "fixed-right" }, onWhite: true })}
      </div>`;
    },

    guide(p) {
      const secs = (p.sections || []).map((s) => `<div class="g-sec">${tx(s.image) ? pic(s.image) : ""}<div class="in"><h4>${icon(s.icon)}${T(s.title)}</h4><p>${T(s.text)}</p></div></div>`).join("");
      return `<div class="screen guide">
        <div class="guide-scroll">
          <div class="g-hero">${pic(p.hero)}<div class="shade"></div>
            ${esLogo(state.content.brand.propertyLogo)}
            <div class="g-welcome">${T(p.welcome)}</div>
            <div class="g-title">${T(p.title)}</div>
          </div>
          <p class="g-intro">${T(p.intro)}</p>
          ${secs}
          <div class="g-end"></div>
        </div>
        <div class="footer-bg"></div>
        ${chrome({ lang: "dark", logo: false, back: { top: 121, cls: "fixed-right" } })}
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
    view(id) {
      const [pid, field] = id.split(":");
      const p = state.content.pages[pid];
      const pages = (p && p[field] || []).map((m) => pic(m)).join("");
      return `<div class="pop menu-pop"><button class="pop-close" data-act="close">${icon("close")}</button><div class="pages">${pages}</div></div>`;
    },
    offers(id) {
      const imgs = state.content.offers[id] || [];
      return `<div class="pop offers-pop"><button class="pop-close" data-act="close">${icon("close")}</button>
        <div class="rail">${imgs.map((m, i) => `<div class="slide${i ? "" : " on"}" data-i="${i}">${pic(m)}</div>`).join("")}</div>
        ${imgs.length > 1 ? `<div class="dots">${imgs.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}</div>`;
    }
  };

  /* ---------------- Rendering ---------------- */
  function current() { return state.stack[state.stack.length - 1] || "home"; }

  /* Motion: page slides (forward/back), language crossfade, pop-up spring, staggered content. */
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const RISE_SEL = [
    ".home .welcome", ".home .start", ".home .pillar", ".tile", ".page-head > *", ".hero-copy > *",
    ".info-strip .it", ".usp-strip > *", ".cta-row > *", ".gallery .track > *", ".room-gallery .track > *",
    ".mosaic > *", ".card", ".room-title", ".room-text", ".room-rule", ".room-hl-title", ".room-hl > *",
    ".g-welcome", ".g-title", ".g-intro", ".g-sec", ".note", ".qrnote", ".pages > *",
  ].join(",");

  function stagger(root, base = 110, step = 45) {
    if (REDUCED) return;
    const all = [...root.querySelectorAll(RISE_SEL)];
    const set = new Set(all);
    const items = all.filter((el) => { for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (set.has(p)) return false; return true; });
    // order by position on screen so things build top-to-bottom
    const pos = items.map((el) => { const r = el.getBoundingClientRect(); return [el, r.top + r.left * 0.15]; }).sort((x, y) => x[1] - y[1]);
    pos.forEach(([el], i) => {
      el.style.setProperty("--d", `${base + Math.min(i, 14) * step}ms`);
      el.classList.add("rise");
      el.addEventListener("animationend", function done(ev) { if (ev.target === el) { el.classList.remove("rise"); el.removeEventListener("animationend", done); } });
    });
  }

  function buildScreen() {
    const id = current();
    const c = state.content;
    if (id === "home") return Screens.home();
    if (id === "menu") return Screens.menu();
    const p = c.pages[id];
    const fn = p && Screens[p.template];
    return fn ? fn(p, id) : Screens.menu();
  }

  function overlayHtml() {
    if (!state.overlay) return "";
    const [kind, oid] = state.overlay;
    const inner = Popups[kind] ? Popups[kind](oid) : "";
    return inner ? `<div class="overlay overlay-${kind}" data-act="close-bg">${inner}</div>` : "";
  }

  function wireOverlay(ov, animate) {
    if (!ov) return;
    wireImageFallbacks(ov);
    wireDots(ov);
    if (animate && !REDUCED) {
      ov.classList.add("opening");
      ov.querySelectorAll(".pop > :not(.pop-close):not(.rail)").forEach((el, i) => { el.style.setProperty("--d", `${140 + Math.min(i, 8) * 50}ms`); el.classList.add("rise"); });
      setTimeout(() => ov.classList.remove("opening"), 700);
    }
  }

  // mode: "forward" | "back" | "fade" | "lang" | "none"
  function render(mode = "fade") {
    if (mode === true) mode = "fade";
    if (mode === false) mode = "none";
    if (REDUCED && mode !== "none") mode = "fade";
    stopAds();
    const id = current();
    stage.setAttribute("dir", state.lang === "ar" ? "rtl" : "ltr");
    stage.setAttribute("lang", state.lang);

    const old = mode === "none" ? null : stage.querySelector(".screen:not(.leaving)");
    stage.querySelectorAll(".overlay").forEach((o) => { if (mode === "none" || !o.classList.contains("closing")) o.remove(); });
    if (!old) stage.querySelectorAll(".screen").forEach((n) => n.remove());

    const tmp = document.createElement("div");
    tmp.innerHTML = buildScreen() + overlayHtml();
    const scr = tmp.querySelector(".screen");
    const ov = tmp.querySelector(".overlay");
    if (old) {
      old.classList.add("leaving", "leave-" + mode);
      old.querySelectorAll("video").forEach((v) => v.pause());
      setTimeout(() => old.remove(), mode === "lang" ? 320 : 520);
    }
    if (scr) stage.appendChild(scr);
    if (ov) stage.appendChild(ov);
    if (scr) {
      wireImageFallbacks(scr);
      fitTitles(scr);
      if (mode !== "none") {
        scr.classList.add("enter", "enter-" + mode);
        stagger(scr, mode === "lang" ? 60 : 120, mode === "lang" ? 30 : 45);
        setTimeout(() => scr.classList.remove("enter", "enter-" + mode), 900);
      }
    }
    wireOverlay(ov, false);
    if (id === "home") startAds();
  }

  function openOverlay(kind, oid) {
    state.overlay = [kind, oid];
    stage.querySelectorAll(".overlay").forEach((o) => o.remove());
    const tmp = document.createElement("div");
    tmp.innerHTML = overlayHtml();
    const ov = tmp.firstElementChild;
    if (!ov) return;
    stage.appendChild(ov);
    wireOverlay(ov, true);
  }

  function closeOverlay() {
    state.overlay = null;
    stage.querySelectorAll(".overlay:not(.closing)").forEach((o) => {
      if (REDUCED) return o.remove();
      o.classList.add("closing");
      o.querySelectorAll("video").forEach((v) => v.pause());
      setTimeout(() => o.remove(), 300);
    });
  }

  function changeLanguage() {
    state.lang = state.lang === "en" ? "ar" : "en";
    if (state.overlay) { render("none"); return; }
    render("lang");
  }

  // shrink long page titles (e.g. NEARBY ATTRACTIONS) so they stay on one line
  function fitTitles(root) {
    root.querySelectorAll(".page-head h1").forEach((h) => {
      h.style.fontSize = "";
      let size = parseFloat(getComputedStyle(h).fontSize);
      while (h.scrollWidth > 960 && size > 50) { size -= 2; h.style.fontSize = size + "px"; }
    });
  }

  function wireDots(root) {
    const rail = root.querySelector(".offers-pop .rail");
    if (!rail) return;
    const dots = root.querySelectorAll(".offers-pop .dots i");
    const slides = [...rail.querySelectorAll(".slide")];
    const step = () => (slides[1] ? slides[1].offsetLeft - slides[0].offsetLeft : 1);
    const update = () => {
      const i = Math.round(rail.scrollLeft / step());
      slides.forEach((d, j) => d.classList.toggle("on", i === j));
      dots.forEach((d, j) => d.classList.toggle("on", i === j));
    };
    rail.addEventListener("scroll", update, { passive: true });
    // tap a side image (or a dot) to bring it to the middle
    slides.forEach((sl, j) => sl.addEventListener("click", (e) => {
      if (!sl.classList.contains("on")) { e.stopPropagation(); rail.scrollTo({ left: j * step(), behavior: "smooth" }); }
    }));
    dots.forEach((d, j) => d.addEventListener("click", (e) => { e.stopPropagation(); rail.scrollTo({ left: j * step(), behavior: "smooth" }); }));
  }

  /* ---------------- Ad slideshow ---------------- */
  function startAds() {
    const slides = [...stage.querySelectorAll(".home:not(.leaving) .ad")];
    if (!slides.length) return;
    const ads = (state.content.ads || []).filter((a) => a.active !== false && tx(a.src));
    const show = (i) => {
      state.adIndex = i;
      slides.forEach((s, j) => s.classList.toggle("on", i === j));
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
    const ci = target.indexOf(":");
    const [kind, id] = ci > 0 ? [target.slice(0, ci), target.slice(ci + 1)] : ["page", target];
    if (kind === "contact" || kind === "offers" || kind === "menu" || kind === "view") {
      openOverlay(kind, id);
      return;
    }
    if (target === "menu" || state.content.pages[target]) {
      if (state.overlay) closeOverlay();
      state.stack.push(target);
      render("forward");
    }
  }

  function back() {
    if (state.overlay) { closeOverlay(); return; }
    state.stack.pop();
    if (!state.stack.length) state.stack = ["home"];
    render(current() === "home" ? "fade" : "back");
  }

  function goHome(resetLang) {
    if (state.overlay) closeOverlay();
    const wasHome = current() === "home";
    state.stack = ["home"];
    const langChanged = resetLang && state.lang !== (state.content.settings.defaultLanguage || "en");
    if (resetLang) state.lang = state.content.settings.defaultLanguage || "en";
    if (wasHome && !langChanged) return;
    render(wasHome ? "lang" : "fade");
  }

  stage.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act],[data-go]");
    if (!el || !stage.contains(el) || el.closest(".leaving, .closing")) return;
    const act = el.dataset.act;
    if (el.dataset.go) return go(el.dataset.go);
    if (act === "lang") changeLanguage();
    else if (act === "back") back();
    else if (act === "menu") { if (state.overlay) closeOverlay(); state.stack = ["home", "menu"]; render("forward"); }
    else if (act === "home") goHome(false);
    else if (act === "close") closeOverlay();
    else if (act === "close-bg" && e.target === el) closeOverlay();
  });

  /* Touch feedback: a soft ring where the finger lands */
  stage.addEventListener("pointerdown", (e) => {
    if (REDUCED || PREVIEW) return;
    const r = stage.getBoundingClientRect();
    const k = r.width / 1080;
    const dot = document.createElement("span");
    dot.className = "touch-ring";
    dot.style.left = (e.clientX - r.left) / k + "px";
    dot.style.top = (e.clientY - r.top) / k + "px";
    stage.appendChild(dot);
    setTimeout(() => dot.remove(), 700);
  }, { passive: true });

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
      if (v.version !== state.version) {
        state.version = v.version;
        apply(v.content || await DataSource.load(), true);
      }
    } catch (e) {
      offline.classList.add("show");
    }
    const st = state.content && state.content.settings;
    const secs = (st && (st.checkMinutes ? st.checkMinutes * 60 : st.contentCheckSeconds)) || 60;
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
      const ok = (k === "contact" && content.contacts[id]) || (k === "offers" && content.offers[id]) || (k === "menu" && content.pages[id]) || (k === "view" && content.pages[id.split(":")[0]]);
      if (!ok) state.overlay = null;
    }
    render(false);
  }

  /* ---------------- Admin live preview ---------------- */
  if (PREVIEW) {
    addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "content") {
        const first = !state.content;
        apply(d.content, !first);
        if (first) { state.stack = ["home"]; render(false); }
      }
      if (d.type === "goto" && state.content) {
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
    if (PREVIEW && window.parent !== window) {
      // the admin page supplies the content; nothing to load
      window.parent.postMessage({ type: "preview-ready" }, "*");
      stage.innerHTML = '<div style="color:#999;font:40px sans-serif;padding:80px">Loading preview…</div>';
      return;
    }
    try { content = await DataSource.load(); }
    catch (e) { content = readCache(); }
    if (!content) { stage.innerHTML = '<div style="color:#fff;font:40px sans-serif;padding:80px">Waiting for content…</div>'; setTimeout(boot, 5000); return; }
    apply(content, false);
    state.lang = params.get("lang") || content.settings.defaultLanguage || "en";
    const startPage = params.get("page");
    state.stack = startPage && startPage !== "home" ? (startPage === "menu" ? ["home", "menu"] : ["home", "menu", startPage]) : ["home"];
    render();
    resetIdle();
    try { state.version = (await DataSource.version()).version; } catch (e) {}
    if (!PREVIEW) setTimeout(checkForUpdates, (content.settings.contentCheckSeconds || 10) * 1000);
  }
  boot();
})();
