// SECURITY NOTE: This file is served to the browser and committed to a PUBLIC repo.
// Never put real API keys, tokens, or strong secrets here — anyone can read them via
// View Source. Secrets below are intentionally blank for the public deploy; the AI and
// gist-sync features no-op gracefully when they are empty (see app.js).
// To enable those features safely, route them through a backend proxy instead of the browser.
//
// For local development only, create an untracked lukasz/mission-config.local.js that sets
// window.MISSION_CONFIG_LOCAL = { gistToken: "...", anthropicKey: "..." } and load it before
// this file. It is .gitignored so it never reaches GitHub.
window.MISSION_CONFIG = Object.assign({
  passcode: "",
  // Mission Control API (FastAPI app behind tools.bukowiecki.co). The bearer
  // token is NOT stored here — type it at the lockscreen (it doubles as the
  // passcode) or in the connect form; mc.js keeps it in localStorage. For local
  // dev, mission-config.local.js can set mcApiUrl/mcToken.
  mcApiUrl: "https://tools.bukowiecki.co",
  mcToken: "",
  githubRepo: "manzombie/mrlobster-website",
  gistId: "f438e3b860e2a5fe35e5750e96c4ffca",
  gistToken: "",
  anthropicKey: "",
  projectStartDate: "2026-05-02",
  boardVersion: "2026-06-04-projects"
}, window.MISSION_CONFIG_LOCAL || {});

// Seed projects for a fresh board. Each project is a tab; each task is a card.
// task.status: "ready" | "active" | "blocked" | "done". Edit/add/reorder happens in the UI
// and is saved to localStorage, so this seed only applies the first time (per boardVersion).
window.MISSION_PROJECTS = [
  {
    id: "p-database",
    name: "Database Work",
    tasks: []
  }
];
