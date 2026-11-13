/* András Gelle Photography: gallery, lightbox, navigation and theme */

(function () {
    "use strict";

    const PHOTO_ROOT = "Photos/";
    const SLIDE_MS = 4000;

    const state = {
        data: null,          // { "2024": [...], ... }
        view: "portfolio",
        year: null,
        photos: [],          // current filtered list
        cols: null,          // user-chosen density (null = auto)
        lbIndex: -1,
        playing: false,
        timer: null
    };

    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

    function store(key, val) { try { val === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch (e) {} }
    function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

    $$(".year-now").forEach(el => el.textContent = new Date().getFullYear());

    /* ---------------- Data ---------------- */
    async function loadPhotoData() {
        if (state.data) return state.data;
        const res = await fetch("photos.json", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load photos.json");
        const json = await res.json();
        state.data = json.photosByYear || {};
        return state.data;
    }

    function photosFor(year) {
        const data = state.data || {};
        const years = Object.keys(data).sort();             // ascending, like the original
        const chosen = year ? [year] : years;
        const out = [];
        chosen.forEach(y => (data[y] || []).forEach(p => out.push({ year: y, file: p.file, alt: p.alt || "Photograph" })));
        return out;
    }

    function fillCounts() {
        const data = state.data || {};
        let total = 0;
        Object.keys(data).forEach(y => {
            const n = data[y].length; total += n;
            $$(`[data-count="${y}"]`).forEach(el => el.textContent = n);
        });
        $$('[data-count="all"]').forEach(el => el.textContent = total);

        const years = Object.keys(data).sort();
        $('[data-stat="photos"]').textContent = total;
        $('[data-stat="years"]').textContent = years.length;
        $('[data-stat="latest"]').textContent = years[years.length - 1] || "–";
    }

    /* ---------------- Routing (same URL scheme as index.html) ---------------- */
    function readParams() {
        const params = new URLSearchParams(window.location.search);
        state.view = params.get("view") || "portfolio";
        state.year = params.get("year"); // "2024" / "2025" / "2026" / null
    }

    function setActiveLink(view, year) {
        $$("[data-nav]").forEach(a => a.classList.remove("active"));
        $$("#mainNavigation a, #mobileNav a, #yearChips a").forEach(a => {
            const p = new URLSearchParams(a.getAttribute("href").split("?")[1] || "");
            const v = p.get("view") || "portfolio";
            const y = p.get("year");
            const match = view === "gear" ? v === "gear" : (v === "portfolio" && (y || null) === (year || null));
            a.classList.toggle("active", match);
            if (a.closest("#yearChips")) a.setAttribute("aria-selected", match ? "true" : "false");
        });
    }

    function showView(view) {
        $("#portfolioView").hidden = view === "gear";
        $("#gearView").hidden = view !== "gear";
    }

    async function route({ scrollToGallery = false } = {}) {
        readParams();
        showView(state.view);
        setActiveLink(state.view, state.year);
        closeMenu();

        if (state.view === "gear") {
            document.title = "My Gear · András Gelle Photography";
            window.scrollTo({ top: 0 });
            return;
        }

        document.title = state.year
            ? `${state.year} Highlights · András Gelle Photography`
            : "András Gelle Photography";

        updateHeroCopy();

        try {
            await loadPhotoData();
            fillCounts();
            await renderGallery({ yearFilter: state.year });
            if (scrollToGallery) {
                const top = $("#gallery").getBoundingClientRect().top + window.scrollY - parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h"));
                if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
            }
        } catch (err) {
            console.error(err);
            showMessage(`Couldn't load <code>photos.json</code>. If you opened this file directly, run it through a local web server (e.g. <code>python -m http.server</code>) so the gallery can be fetched.`);
        }
    }

    // Intercept internal nav links for instant switching (falls back to normal links without JS)
    document.addEventListener("click", e => {
        const a = e.target.closest("a[data-nav]");
        if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        const href = a.getAttribute("href");
        const wasPortfolio = state.view !== "gear";
        history.pushState(null, "", href);
        const goingTo = new URLSearchParams(href.split("?")[1] || "").get("view") || "portfolio";
        route({ scrollToGallery: wasPortfolio && goingTo === "portfolio" && !!a.closest("#yearChips, #mainNavigation, #mobileNav") });
    });
    window.addEventListener("popstate", () => route());

    /* ---------------- Hero ---------------- */
    function updateHeroCopy() {
        $("#heroCue").textContent = state.year ? `View ${state.year} highlights` : "View the gallery";
    }

    function fillHero(list) {
        const figs = $$("#heroStack figure");
        if (!list.length) return;
        // Pick 3 evenly spaced photos so the stack feels representative
        const picks = [0.15, 0.5, 0.85].map(f => Math.min(list.length - 1, Math.floor(f * list.length)));
        figs.forEach((fig, i) => {
            const p = list[picks[i]];
            const src = PHOTO_ROOT + p.file;
            let img = fig.querySelector("img");
            if (img && img.getAttribute("src") === src) return;
            if (!img) { img = document.createElement("img"); fig.appendChild(img); }
            img.classList.remove("loaded");
            img.alt = "";
            img.onload = () => img.classList.add("loaded");
            img.src = src;
            fig.onclick = () => openLightbox(state.photos.indexOf(p));
        });
    }

    /* ---------------- Gallery ---------------- */
    function columnCount() {
        const w = window.innerWidth;
        const auto = w < 640 ? 2 : w < 1000 ? 3 : 4;
        if (!state.cols) return auto;
        return w < 640 ? Math.min(state.cols, 2) : state.cols;
    }

    let io = null;
    function observeTiles(tiles) {
        if (!("IntersectionObserver" in window)) { tiles.forEach(t => t.classList.add("in")); return; }
        if (!io) {
            io = new IntersectionObserver(entries => {
                entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
            }, { rootMargin: "0px 0px -40px 0px" });
        }
        tiles.forEach(t => io.observe(t));
    }

    function makeTile(p, idx) {
        const fig = document.createElement("figure");
        fig.className = "tile";
        fig.tabIndex = 0;
        fig.setAttribute("role", "button");
        fig.setAttribute("aria-label", `Open photo ${idx + 1} of ${state.photos.length}`);

        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = p.alt;
        img.onload = () => { img.classList.add("loaded"); fig.classList.add("has-img"); };
        img.src = PHOTO_ROOT + p.file;
        fig.appendChild(img);

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.innerHTML = `<span>${p.year}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/></svg>`;
        fig.appendChild(meta);

        fig.addEventListener("click", () => openLightbox(idx));
        fig.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(idx); } });
        return fig;
    }

    function layout() {
        const wrap = $("#galleryWrapper");
        const n = columnCount();
        wrap.innerHTML = "";
        const cols = [];
        for (let i = 0; i < n; i++) {
            const c = document.createElement("div");
            c.className = "masonry-col";
            wrap.appendChild(c); cols.push(c);
        }
        const tiles = state.photos.map((p, i) => {
            const t = makeTile(p, i);
            cols[i % n].appendChild(t);      // round-robin keeps reading order left → right
            return t;
        });
        wrap.dataset.cols = n;
        observeTiles(tiles);
    }

    // yearFilter: null => all years, or "2024", "2025", ...
    async function renderGallery({ yearFilter = null, shuffle = false } = {}) {
        await loadPhotoData();
        let list = photosFor(yearFilter);
        if (shuffle) {
            for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        }
        state.photos = list;

        $("#galleryMessage").hidden = true;
        $("#galleryTitle").firstChild.nodeValue = yearFilter ? `${yearFilter} Highlights` : "All work";
        $("#gallerySub").textContent = list.length
            ? `${list.length} photograph${list.length === 1 ? "" : "s"}${yearFilter ? "" : " · " + Object.keys(state.data).sort().join(", ")}`
            : "";

        if (!list.length) {
            $("#galleryWrapper").innerHTML = "";
            showMessage("No photos here yet. Check back soon.");
            return;
        }
        fillHero(list);
        layout();
    }

    function showMessage(html) {
        const m = $("#galleryMessage");
        m.innerHTML = html; m.hidden = false;
        $("#gallerySub").textContent = "";
    }

    // Density control
    function setDensity(cols) {
        state.cols = cols;
        store("ag-cols", cols ? String(cols) : undefined);
        $$("#densitySeg button").forEach(b => b.classList.toggle("on", Number(b.dataset.cols) === columnCount()));
        if (state.photos.length) layout();
    }
    $$("#densitySeg button").forEach(b => b.addEventListener("click", () => setDensity(Number(b.dataset.cols))));
    const savedCols = Number(read("ag-cols"));
    if (savedCols) state.cols = savedCols;
    $$("#densitySeg button").forEach(b => b.classList.toggle("on", Number(b.dataset.cols) === columnCount()));

    $("#shuffleBtn").addEventListener("click", () => renderGallery({ yearFilter: state.year, shuffle: true }));
    $("#slideshowBtn").addEventListener("click", () => { if (state.photos.length) { openLightbox(0); startSlideshow(); } });

    let resizeT;
    let lastCols = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeT);
        resizeT = setTimeout(() => {
            if (window.innerWidth > 1100) closeMenu();
            const n = columnCount();
            if (n !== lastCols && state.photos.length && state.view !== "gear") { layout(); }
            lastCols = n;
            $$("#densitySeg button").forEach(b => b.classList.toggle("on", Number(b.dataset.cols) === n));
        }, 150);
    });

    /* ---------------- Lightbox ---------------- */
    const lb = $("#lightbox"), lbImg = $("#lbImg"), lbStage = $("#lbStage");
    let lastFocus = null;

    function buildStrip() {
        const strip = $("#lbStrip");
        strip.innerHTML = "";
        state.photos.forEach((p, i) => {
            const b = document.createElement("button");
            b.setAttribute("aria-label", `Photo ${i + 1}`);
            const t = document.createElement("img");
            t.alt = ""; t.decoding = "async";
            t.dataset.src = PHOTO_ROOT + p.file;
            b.appendChild(t);
            b.addEventListener("click", () => { showPhoto(i); restartTimer(); });
            strip.appendChild(b);
        });
    }

    let stripIO = null;
    function watchStrip() {
        const strip = $("#lbStrip");
        if (stripIO) stripIO.disconnect();
        const load = img => { if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; } };
        if (!("IntersectionObserver" in window)) { $$("img", strip).forEach(load); return; }
        stripIO = new IntersectionObserver(entries => entries.forEach(en => {
            if (en.isIntersecting) { load(en.target); stripIO.unobserve(en.target); }
        }), { root: strip, rootMargin: "0px 150px" });
        $$("img", strip).forEach(img => stripIO.observe(img));
    }

    function openLightbox(i) {
        if (i < 0 || !state.photos.length) return;
        lastFocus = document.activeElement;
        lb.classList.add("open");
        document.body.style.overflow = "hidden";
        buildStrip();
        showPhoto(i);
        $("#lbClose").focus({ preventScroll: true });
    }

    function closeLightbox() {
        stopSlideshow();
        lb.classList.remove("open");
        document.body.style.overflow = "";
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        if (lastFocus) lastFocus.focus({ preventScroll: true });
        state.lbIndex = -1;
        stripWatched = false;
        if (stripIO) stripIO.disconnect();
    }

    let stripWatched = false, revealT = null;
    function showPhoto(i) {
        const n = state.photos.length;
        i = (i + n) % n;
        state.lbIndex = i;
        const p = state.photos[i];
        const src = PHOTO_ROOT + p.file;

        const reveal = () => {
            if (state.lbIndex !== i) return;
            lbStage.classList.remove("loading");
            lbImg.classList.add("show");
            if (!stripWatched) { stripWatched = true; watchStrip(); }
            // Preload neighbours only once the current photo is on screen
            [i + 1, i - 1].forEach(k => { const q = state.photos[(k + n) % n]; if (q) new Image().src = PHOTO_ROOT + q.file; });
        };
        lbImg.classList.remove("show");
        lbStage.classList.add("loading");
        lbImg.onload = reveal;
        lbImg.onerror = reveal;
        lbImg.setAttribute("fetchpriority", "high");
        lbImg.alt = p.alt;
        lbImg.src = src;
        if (lbImg.complete && lbImg.naturalWidth) reveal();
        clearTimeout(revealT);
        revealT = setTimeout(() => { if (state.lbIndex === i) lbImg.classList.add("show"); }, 2500); // never stay invisible

        $("#lbCounter").innerHTML = `<strong>${String(i + 1).padStart(2, "0")}</strong> / ${String(n).padStart(2, "0")} &nbsp;·&nbsp; ${p.year}`;
        $("#lbOpen").href = src;

        $$("#lbStrip button").forEach((b, k) => b.classList.toggle("current", k === i));
        const cur = $$("#lbStrip button")[i];
        if (cur) cur.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }

    const next = () => showPhoto(state.lbIndex + 1);
    const prev = () => showPhoto(state.lbIndex - 1);

    // Slideshow
    const progress = $("#lbProgress");
    function animateProgress() {
        progress.style.transition = "none"; progress.style.width = "0";
        void progress.offsetWidth;
        progress.style.transition = `width ${SLIDE_MS}ms linear`; progress.style.width = "100%";
    }
    function startSlideshow() {
        state.playing = true;
        $("#lbPlay").classList.add("playing");
        $("#lbPlay").setAttribute("aria-label", "Pause slideshow");
        restartTimer();
    }
    function stopSlideshow() {
        state.playing = false;
        clearInterval(state.timer);
        $("#lbPlay").classList.remove("playing");
        $("#lbPlay").setAttribute("aria-label", "Play slideshow");
        progress.style.transition = "none"; progress.style.width = "0";
    }
    function restartTimer() {
        if (!state.playing) return;
        clearInterval(state.timer);
        animateProgress();
        state.timer = setInterval(() => { next(); animateProgress(); }, SLIDE_MS);
    }

    $("#lbNext").addEventListener("click", () => { next(); restartTimer(); });
    $("#lbPrev").addEventListener("click", () => { prev(); restartTimer(); });
    $("#lbClose").addEventListener("click", closeLightbox);
    $("#lbPlay").addEventListener("click", () => state.playing ? stopSlideshow() : startSlideshow());
    $("#lbFull").addEventListener("click", toggleFullscreen);
    lbStage.addEventListener("click", e => { if (e.target === lbStage) closeLightbox(); });

    function toggleFullscreen() {
        if (!document.fullscreenElement) { (lb.requestFullscreen ? lb.requestFullscreen() : Promise.reject()).catch(() => {}); }
        else document.exitFullscreen().catch(() => {});
    }

    document.addEventListener("keydown", e => {
        if (!lb.classList.contains("open")) {
            if (e.key === "Escape") closeMenu();
            return;
        }
        switch (e.key) {
            case "ArrowRight": next(); restartTimer(); break;
            case "ArrowLeft": prev(); restartTimer(); break;
            case "Escape": if (!document.fullscreenElement) closeLightbox(); break;
            case " ": e.preventDefault(); state.playing ? stopSlideshow() : startSlideshow(); break;
            case "f": case "F": toggleFullscreen(); break;
            case "Tab": {   // keep focus inside the dialog
                const f = $$("button, a[href]", lb).filter(el => el.offsetParent !== null);
                if (!f.length) break;
                if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
                else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
            }
        }
    });

    // Swipe
    let tx = 0, ty = 0;
    lbStage.addEventListener("touchstart", e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    lbStage.addEventListener("touchend", e => {
        const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { (dx < 0 ? next : prev)(); restartTimer(); }
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeLightbox();
    }, { passive: true });

    /* ---------------- Mobile menu ---------------- */
    const menuBtn = $("#menuToggle");
    function closeMenu() {
        document.body.classList.remove("menu-open");
        menuBtn.setAttribute("aria-expanded", "false");
        if (!lb.classList.contains("open")) document.body.style.overflow = "";
    }
    menuBtn.addEventListener("click", () => {
        const open = !document.body.classList.contains("menu-open");
        document.body.classList.toggle("menu-open", open);
        menuBtn.setAttribute("aria-expanded", String(open));
        document.body.style.overflow = open ? "hidden" : "";
    });

    /* ---------------- Theme ---------------- */
    $("#themeToggle").addEventListener("click", () => {
        const dark = document.documentElement.getAttribute("data-theme") !== "dark";
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
        store("ag-theme", dark ? "dark" : "light");
    });

    /* ---------------- Scroll helpers ---------------- */
    const header = $("#siteHeader"), toTop = $("#toTop");
    window.addEventListener("scroll", () => {
        const y = window.scrollY;
        header.classList.toggle("scrolled", y > 8);
        toTop.classList.toggle("show", y > 900);
    }, { passive: true });
    const goTop = e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    toTop.addEventListener("click", goTop);
    $("#footerTop").addEventListener("click", goTop);

    /* ---------------- Init ---------------- */
    lastCols = columnCount();
    route();
})();
