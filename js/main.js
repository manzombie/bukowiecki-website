/* =================================================================
   bukowiecki.co — interactions
   Vanilla JS only. No framework, no build step.
   ================================================================= */

/* -----------------------------------------------------------------
   REPOINTABLE LINK CONSTANTS
   Change these two values to repoint the CTAs — no markup hunting.
   ----------------------------------------------------------------- */
const FRAMESHIFT_URL = "https://frameshift.run/";   // FRAME/SHIFT CTA target
const VFXTOOLS_URL   = "/vfxtools/index.html";       // existing page in repo — link only
/* ----------------------------------------------------------------- */

(function () {
  "use strict";

  const prefersReducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = window.matchMedia("(max-width: 820px)").matches;

  /* ---------------------------------------------------------------
     0. Wire CTA constants into the markup
     --------------------------------------------------------------- */
  document.querySelectorAll('[data-link="frameshift"]').forEach((a) => {
    a.setAttribute("href", FRAMESHIFT_URL);
  });
  document.querySelectorAll('[data-link="vfxtools"]').forEach((a) => {
    a.setAttribute("href", VFXTOOLS_URL);
  });

  /* ---------------------------------------------------------------
     1. NAV — background on scroll + active-section dot
     --------------------------------------------------------------- */
  const nav = document.getElementById("nav");
  const navLinks = Array.from(document.querySelectorAll(".nav__links a"));
  const sectionForLink = navLinks
    .map((a) => {
      const id = a.getAttribute("href").slice(1);
      const el = document.getElementById(id);
      return el ? { link: a, el } : null;
    })
    .filter(Boolean);

  function onScrollNav() {
    nav.classList.toggle("is-scrolled", window.scrollY > 40);
  }
  onScrollNav();
  window.addEventListener("scroll", onScrollNav, { passive: true });

  // Active section highlight
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const active = entry.target;
          sectionForLink.forEach(({ link, el }) =>
            link.classList.toggle("is-active", el === active)
          );
        }
      });
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );
  sectionForLink.forEach(({ el }) => sectionObserver.observe(el));

  /* ---------------------------------------------------------------
     2. REVEAL ON SCROLL
     --------------------------------------------------------------- */
  const reveals = document.querySelectorAll(".reveal");
  if (prefersReducedMotion) {
    reveals.forEach((el) => el.classList.add("is-visible"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 }
    );
    reveals.forEach((el) => revealObserver.observe(el));
  }

  /* ---------------------------------------------------------------
     3. FILM VIDEOS — scroll-scrubbed (like the hero sequence)
        Scroll position is the playhead: scroll DOWN plays the clip
        forward, scroll UP plays it backward. Each node maps its
        travel through the viewport (enter→leave) to currentTime.
        Lazy-load sources; only scrub videos currently in view.
     --------------------------------------------------------------- */
  const filmVideos = document.querySelectorAll("[data-film-video]");

  function loadVideoSources(video) {
    if (video.dataset.loaded) return;
    video.querySelectorAll("source[data-src]").forEach((s) => {
      s.src = s.dataset.src;
    });
    video.preload = "auto";
    video.load();
    video.dataset.loaded = "1";
  }

  // Release a video's decoder + buffers when it's far off-screen. Browsers keep
  // only a few video decoders alive; holding all five means the oldest (the first
  // node, Avatar) gets silently evicted and frozen. Unloading distant clips caps
  // live decoders to the one or two near the viewport, so the node you're looking
  // at always owns a decoder. It reloads from HTTP cache when you scroll back.
  function unloadVideoSources(video) {
    if (!video.dataset.loaded) return;
    video.pause();
    video.querySelectorAll("source").forEach((s) => s.removeAttribute("src"));
    video.removeAttribute("src");
    video.load(); // frees the decoder; falls back to the poster frame
    delete video.dataset.loaded;
  }

  if (!prefersReducedMotion && !isMobile && filmVideos.length) {
    // Progress of a node through the viewport:
    // 0 = top edge entering at the bottom, 0.5 = centered, 1 = bottom edge leaving at the top.
    function nodeProgress(rect, vh) {
      return Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
    }

    // A self-converging rAF loop (NOT scroll-event gated). Each frame it samples
    // the live scroll position and seeks the film videos toward their target
    // currentTime. A seek that can't run this frame (still seeking) is retried
    // next frame, so nothing gets stranded the way a single-shot scroll handler
    // could. The loop runs only while ≥1 film node is on screen and parks once
    // the scroll position has been stable and all seeks have settled.
    //
    // IMPORTANT — decoder budget: browsers keep only a few video decoders alive.
    // Seeking all five WebMs at once thrashes and the least-recently-used ones
    // get evicted and freeze on a stale frame. So we scrub ONLY the single
    // most-centered node each frame (one active decoder); the others hold their
    // last frame until they become the centered one — which is exactly how you
    // view them while scrolling past one at a time.
    let visibleCount = 0;
    let looping = false;
    let lastY = null;
    let stableFrames = 0;

    function tick() {
      if (visibleCount <= 0) { looping = false; return; }
      const vh = window.innerHeight;
      const y = window.scrollY;
      if (y === lastY) { stableFrames++; } else { stableFrames = 0; lastY = y; }

      // Find the in-view video whose center is nearest the viewport center.
      let video = null, bestDist = Infinity;
      filmVideos.forEach((v) => {
        if (!v._inView) return;
        const r = v.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - vh / 2);
        if (dist < bestDist) { bestDist = dist; video = v; }
      });

      let pending = false; // seek still settling?
      if (video) {
        const d = video.duration;
        if (!d || !isFinite(d)) {
          pending = true;                  // metadata not ready — keep looping
        } else {
          if (!video.paused) video.pause(); // scroll is the clock — never free-run
          if (video.seeking) {
            pending = true;                 // retry next frame
          } else {
            const rect = video.getBoundingClientRect();
            const target = Math.min(d - 0.04, nodeProgress(rect, vh) * d);
            if (Math.abs(target - video.currentTime) > 0.03) {
              video.currentTime = target;   // currentTime drives the playhead
              pending = true;
            }
          }
        }
      }

      // Park once the page is still and the active video has reached target.
      if (stableFrames > 12 && !pending) { looping = false; return; }
      requestAnimationFrame(tick);
    }
    function startLoop() {
      if (!looping) { looping = true; stableFrames = 0; lastY = null; requestAnimationFrame(tick); }
    }

    // Track which nodes are near the viewport; lazy-load (and unload-when-far)
    // their sources to cap live decoders; drive the loop. The generous margin
    // keeps the current node + immediate neighbour loaded, and frees the rest.
    const filmObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target;
          if (entry.isIntersecting) {
            loadVideoSources(video);
            video.pause();
            if (!video._inView) { video._inView = true; visibleCount++; }
          } else {
            if (video._inView) { video._inView = false; visibleCount--; }
            unloadVideoSources(video); // far off-screen → free its decoder
          }
        });
        if (visibleCount > 0) startLoop();
      },
      { rootMargin: "300px 0px 300px 0px", threshold: 0 }
    );
    filmVideos.forEach((video) => {
      filmObserver.observe(video);
      // Kick the loop when metadata lands so the first frame matches scroll pos.
      video.addEventListener("loadedmetadata", () => { video.pause(); startLoop(); });
    });

    // Any scroll/resize wakes the loop (it parks itself when idle again).
    window.addEventListener("scroll", startLoop, { passive: true });
    window.addEventListener("resize", startLoop);
  }
  /* On mobile / reduced-motion the poster (WebP first frame) simply stays. */

  /* ---------------------------------------------------------------
     4. HERO — scroll-scrubbed frame sequence on a sticky canvas
     --------------------------------------------------------------- */
  const FRAME_COUNT = 61;
  const framePath = (i) =>
    "hero/frame_" + String(i).padStart(4, "0") + ".webp"; // frame_0001 … frame_0061

  const heroSection = document.getElementById("hero");
  const canvas = document.getElementById("hero-canvas");
  const ctx = canvas ? canvas.getContext("2d") : null;

  // Mobile / reduced-motion → static end-pose image, skip the whole rig.
  if (prefersReducedMotion || isMobile || !ctx) {
    heroSection.classList.add("is-fallback");
  } else {
    const images = new Array(FRAME_COUNT);
    let loadedCount = 0;
    let ready = false;
    let currentFrame = -1;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resizeCanvas() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      currentFrame = -1; // force redraw
      drawFromScroll();
    }

    function drawFrame(index) {
      const img = images[index];
      if (!img || !img.complete || !img.naturalWidth) return;
      if (index === currentFrame) return;
      currentFrame = index;

      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      // object-fit: contain
      const ir = img.naturalWidth / img.naturalHeight;
      const cr = cw / ch;
      let dw, dh, dx, dy;
      if (ir > cr) {
        dw = cw; dh = cw / ir; dx = 0; dy = (ch - dh) / 2;
      } else {
        dh = ch; dw = ch * ir; dy = 0; dx = (cw - dw) / 2;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    function progressThroughHero() {
      const rect = heroSection.getBoundingClientRect();
      const runway = heroSection.offsetHeight - window.innerHeight;
      if (runway <= 0) return 0;
      const scrolled = -rect.top;
      return Math.min(1, Math.max(0, scrolled / runway));
    }

    let rafQueued = false;
    function drawFromScroll() {
      if (!ready) return;
      const p = progressThroughHero();
      const index = Math.round(p * (FRAME_COUNT - 1));
      drawFrame(index);
    }
    function onScrollHero() {
      if (rafQueued) return;
      rafQueued = true;
      requestAnimationFrame(() => {
        rafQueued = false;
        drawFromScroll();
      });
    }

    // Preload the ENTIRE sequence before enabling scrub.
    for (let i = 1; i <= FRAME_COUNT; i++) {
      const img = new Image();
      img.onload = img.onerror = () => {
        loadedCount++;
        if (loadedCount === FRAME_COUNT) {
          ready = true;
          resizeCanvas();
          drawFrame(0);
          drawFromScroll();
        } else if (i === 1) {
          // show frame 1 as soon as it lands, even mid-preload
          drawFrame(0);
        }
      };
      img.src = framePath(i);
      images[i - 1] = img;
    }

    // Draw frame 1 the instant it's available so we never show empty canvas.
    if (images[0]) {
      images[0].decode ? images[0].decode().then(() => { resizeCanvas(); drawFrame(0); }).catch(() => {}) : null;
    }

    window.addEventListener("scroll", onScrollHero, { passive: true });
    window.addEventListener("resize", resizeCanvas);
  }
})();
