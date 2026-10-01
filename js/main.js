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
const LAB_URL        = "https://lab.bukowiecki.co/"; // Studio Cipher lab CTA target
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
  document.querySelectorAll('[data-link="lab"]').forEach((a) => {
    a.setAttribute("href", LAB_URL);
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

  const navToggle = nav.querySelector(".nav__toggle");
  if (navToggle) {
    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.textContent = open ? "Close" : "Menu";
    };
    navToggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    navLinks.forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  }

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
     3. HERO — scroll-scrubbed frame sequence on a sticky canvas
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

    // nearest frame that has finished loading (frames stream in progressively)
    function nearestLoaded(index) {
      for (let d = 0; d < FRAME_COUNT; d++) {
        for (const i of [index - d, index + d]) {
          const im = images[i];
          if (im && im.complete && im.naturalWidth) return i;
        }
      }
      return -1;
    }

    function drawFrame(wanted) {
      const index = nearestLoaded(wanted);
      if (index < 0) return;
      const img = images[index];
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

    // Load the opening frames first so the hero appears immediately, then stream
    // the rest a few at a time (the scrub uses the nearest loaded frame meanwhile).
    function loadFrame(i) {
      return new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = img.onerror = () => {
          loadedCount++;
          if (i === 1) { ready = true; resizeCanvas(); }
          else if (ready) { currentFrame = -1; drawFromScroll(); }
          resolve();
        };
        img.src = framePath(i);
        images[i - 1] = img;
      });
    }
    (async () => {
      await loadFrame(1);
      const order = [];
      for (let i = 2; i <= FRAME_COUNT; i++) order.push(i);
      for (let k = 0; k < order.length; k += 6) {
        await Promise.all(order.slice(k, k + 6).map(loadFrame));
      }
    })();

    window.addEventListener("scroll", onScrollHero, { passive: true });
    window.addEventListener("resize", resizeCanvas);
  }
})();
