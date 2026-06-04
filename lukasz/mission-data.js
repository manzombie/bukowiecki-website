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
  githubRepo: "manzombie/mr_lobster_rebuild",
  gistId: "f438e3b860e2a5fe35e5750e96c4ffca",
  gistToken: "",
  anthropicKey: "",
  projectStartDate: "2026-05-02",
  boardVersion: "2026-05-25-post-terry-routing"
}, window.MISSION_CONFIG_LOCAL || {});

window.MISSION_TASKS = [
  {
    phase: "Project History",
    title: "Weeks 1-10 shipped",
    outcome: "Historical milestones stay visible for progress, calendar, and confidence without cluttering the active board.",
    owner: "Lukasz + Codex",
    tasks: [
      "Week 1: accounts, repo scaffold, first Render deploy, and BUILD_LOG started.",
      "Week 2: multi-tenant database foundation and Terry tenant config created.",
      "Week 3: provider interfaces, MCP tool pattern, and telemetry foundations shipped.",
      "Week 4: Twilio/ElevenLabs webhook gateway, queue pattern, and observability wired.",
      "Week 5: Terry reception agent tools and read-only Inbox UI shipped.",
      "Week 6: golden dataset, eval harness, score_eval, and dashboard pass rate shipped.",
      "Week 7: reconciliation, synthetic dry-run, voice failover, Sentry/Axiom/UptimeRobot shipped.",
      "Week 8: pre-go-live checks, Inbox proof, eval proof, and BUILD_LOG proof completed.",
      "Week 9-10: public Inbox login, Meta WhatsApp owner alerts, TTNC one-number routing proof, and Terry pilot readiness shipped."
    ]
  },
  {
    phase: "Completed v3.0",
    title: "Foundation shipped",
    outcome: "The product foundation is live enough to prove: API, Inbox, evals, monitoring, reconciliation, and failover route checks are working.",
    owner: "Lukasz + Codex",
    tasks: [
      "Ship API, database, tenant config, MCP tools, and Terry seed data.",
      "Ship read-only Inbox UI with search, filters, export, and eval pass rate.",
      "Ship golden eval harness with synthetic and real Terry examples.",
      "Wire Sentry, Axiom, UptimeRobot, and live health checks.",
      "Ship nightly Twilio reconciliation against call logs.",
      "Ship voice failover route from ElevenLabs failure to voicemail transcript to lead.",
      "Pause automatic synthetic pipeline so it no longer pollutes Terry's Inbox.",
      "Run all 13 Saturday pre-go-live checks and record proof in BUILD_LOG.",
      "Ship Terry pilot readiness: public Inbox login, TTNC setup notes, owner alerts, and first monitored routing proof."
    ]
  },
  {
    phase: "Shipped Terry Pilot",
    title: "Pre-Terry readiness shipped",
    outcome: "Everything needed before asking Terry for the first controlled TTNC routing test is complete and recorded.",
    owner: "Lukasz + Codex",
    tasks: [
      "Confirmed TTNC supports sequential forwarding: Terry mobile first, Mr Lobster AI second if unanswered.",
      "Confirmed +441245950223 is connected to the v3 ConvAI bridge in Twilio.",
      "Deployed owner-alert, Inbox-filtering, and WhatsApp cleanup changes to Render.",
      "Ran owner-alert diagnostic and confirmed Meta WhatsApp template alerts work.",
      "Ran direct test call to +441245950223 and confirmed AI answer, Inbox lead, eval pass, and owner alert.",
      "Deployed the Inbox to app.mrlobster.co.uk with Terry-facing login.",
      "Wrote Terry handover notes explaining what he gets and what we need him to test.",
      "Asked Terry to configure one TTNC number: 01245 830075 -> mobile 15s -> +441245950223.",
      "Completed the first monitored TTNC routing call and captured Lucas's real test lead."
    ]
  },
  {
    phase: "Deferred",
    title: "No parked blockers",
    outcome: "The old parked list has been moved into future stages so the board can restart cleanly after the Terry pilot proof.",
    owner: "Lukasz + Codex",
    tasks: []
  },
  {
    phase: "v3.0a",
    title: "Post-Terry pilot cleanup + customer 2 prep",
    outcome: "Stabilise from Terry's first routed proof call, watch the one-number pilot, then prepare the next customer without disturbing Terry.",
    owner: "Lukasz + Codex",
    tasks: [
      "Capture first real Terry routing proof after TTNC rolls a public number to Mr Lobster.",
      "Clean or filter historical synthetic/test leads from the Inbox.",
      "Fix Terry owner WhatsApp auto-replies so they do not create false leads.",
      "Monitor the first real missed-call pilot on 01245 830075 and record what happens.",
      "Only after the one-number TTNC test is stable, enrol the remaining TTNC numbers one by one.",
      "Polish the Inbox UI around real Terry usage and any feedback from the first pilot calls.",
      "Write customer-facing onboarding script for customer number 2.",
      "Prepare manual onboarding flow for customers 2-3."
    ]
  },
  {
    phase: "v3.1",
    title: "Self-serve onboarding",
    outcome: "Customer number 4 can provision themselves in under 30 minutes, with Mr Lobster creating their voice and WhatsApp agent from structured answers.",
    owner: "Future phase",
    tasks: [
      "Define the onboarding questionnaire for business info, services, prices, areas, hours, tone, and escalation rules.",
      "Decide which settings customers can edit themselves and which require Lukasz/operator approval.",
      "Make SOUL.md generated output from database config, not a hand-edited source file.",
      "Build Operator Dashboard for Lukasz to monitor tenants, numbers, calls, issues, evals, provider health, and costs.",
      "Build Customer Dashboard for leads, services, opening hours, prices, escalation rules, and business settings.",
      "Build six-step onboarding wizard.",
      "Decide how customer WhatsApp identity works: Mr Lobster-owned number, customer-owned WABA, or managed manual setup.",
      "Design Terry/public WhatsApp setup separately from owner-alert WhatsApp so customer messages do not confuse business identity.",
      "Use Meta Cloud API for new tenants.",
      "Enable inbound WhatsApp customer conversations.",
      "Add customer identity layer across phone and WhatsApp.",
      "Spike UK address verification for lead capture, starting with postcode validation and provider comparison.",
      "Store a clean service address on each lead: entered text, confirmed postcode, canonical address, and verification status.",
      "Add Stripe Billing for setup fee, subscription, and metered overage.",
      "Create Owner Assistant Agent on HQ WhatsApp number.",
      "Add optional Google Calendar booking."
    ]
  },
  {
    phase: "v3.2",
    title: "Company Agent",
    outcome: "Turn Mr Lobster from an answering service into a trusted company agent with approved memory, owner controls, and proactive guidance.",
    owner: "Future phase",
    tasks: [
      "Design what the Company Agent can update automatically and what needs owner approval.",
      "Design the approval flow for memory, service, price, area, and opening-hour updates.",
      "Build stale-config detection for prices, service areas, and outdated opening hours.",
      "Use website, Google Business, reviews, and call history to draft improved business config.",
      "Design customer-facing explanations that do not expose prompts, models, or provider details.",
      "Design the Monday digest with performance, missed leads, call themes, and recommendations.",
      "Hand-label more Terry recordings to grow the golden set from 27 toward 50 examples.",
      "Spike OpenAI Realtime voice against ElevenLabs on cost, latency, and lead accuracy.",
      "Use verified service addresses to check whether a caller is inside the customer coverage area.",
      "Flag unclear, incomplete, or out-of-area addresses for owner review instead of pretending they are confirmed.",
      "Enable owner WhatsApp commands for services, prices, hours, and escalation rules.",
      "Create safety rules for what the agent can answer directly versus pass to the owner.",
      "Create Memory Agent with owner-approved updates.",
      "Create Growth Advisor Agent and Monday digest.",
      "Enable conversational config via WhatsApp HQ.",
      "Build self-building onboarding from website, Google Business, and reviews.",
      "Add SOUL auto-calibration and drift detection.",
      "Publish first case study and public uptime page."
    ]
  },
  {
    phase: "v3.3",
    title: "Verticals + scale",
    outcome: "Scale Mr Lobster into repeatable verticals, pricing models, and channels after Terry and customers 2-3 prove the pattern.",
    owner: "Future phase",
    tasks: [
      "Choose the first three verticals after plumbers/heating engineers.",
      "Define vertical differences: questions, prices, emergency rules, tone, compliance, and handoff.",
      "Design vertical agents as templates on one configurable Mr Lobster core.",
      "Design outcome-based pricing options and when they become safe to test.",
      "Prioritise the next channels: web chat, Instagram DM, Facebook, email, or Google Business messages.",
      "Define public API use cases and which customers would actually need them.",
      "Build the usage/cost dashboard Lukasz needs before scaling beyond manual onboarding.",
      "Define the support promise Mr Lobster can safely make to customers.",
      "Package reusable local-data tools: address verification, Companies House lookup, and service-area checks.",
      "Productise Plumber Agent from Terry vertical.",
      "Add Heating Engineer Agent.",
      "Add Clinic Agent.",
      "Evaluate outcome-based pricing tier.",
      "Expose public API.",
      "Add web chat and Instagram DM channels."
    ]
  },
  {
    phase: "v3.4",
    title: "Operating model",
    outcome: "Make Mr Lobster operable as a real service before it grows beyond what Lukasz can manually watch.",
    owner: "Future phase",
    tasks: [
      "Build the morning Operator Dashboard view for Lukasz.",
      "Define incident levels: P1, P2, P3, and who gets notified.",
      "Create dedicated synthetic test tenant before turning 5-minute synthetic checks back on.",
      "Connect P1/P2 owner alerts after WhatsApp or SMS sender is approved.",
      "Create and test emergency fallback for Terry's Twilio number in under 2 minutes.",
      "Design customer support flow for bad answers, missed leads, and provider failures.",
      "Design customer-visible audit trail versus operator-only audit trail.",
      "Set data retention rules for calls, transcripts, recordings, evals, and logs.",
      "Build customer cancellation, pause, and emergency disable flows.",
      "Design provider-outage communication for customers.",
      "Create backup provider strategy for voice, messaging, transcription, and LLM.",
      "Scaffold official MCP TypeScript SDK only if moving beyond the ElevenLabs webhook pattern."
    ]
  }
];

window.MISSION_STATE = {
  version: "2026-05-25-post-terry-routing",
  currentTask: "v3-0a-4",
  collapsed: {
    "Project History": true,
    "Completed v3.0": true,
    "Shipped Terry Pilot": true,
    "Deferred": true,
    "v3.0a": false,
    "v3.1": true,
    "v3.2": true,
    "v3.3": true,
    "v3.4": true
  },
  tasks: {
    "project-history-1": "done",
    "project-history-2": "done",
    "project-history-3": "done",
    "project-history-4": "done",
    "project-history-5": "done",
    "project-history-6": "done",
    "project-history-7": "done",
    "project-history-8": "done",
    "project-history-9": "done",
    "completed-v3-0-1": "done",
    "completed-v3-0-2": "done",
    "completed-v3-0-3": "done",
    "completed-v3-0-4": "done",
    "completed-v3-0-5": "done",
    "completed-v3-0-6": "done",
    "completed-v3-0-7": "done",
    "completed-v3-0-8": "done",
    "completed-v3-0-9": "done",
    "shipped-terry-pilot-1": "done",
    "shipped-terry-pilot-2": "done",
    "shipped-terry-pilot-3": "done",
    "shipped-terry-pilot-4": "done",
    "shipped-terry-pilot-5": "done",
    "shipped-terry-pilot-6": "done",
    "shipped-terry-pilot-7": "done",
    "shipped-terry-pilot-8": "done",
    "shipped-terry-pilot-9": "done",
    "v3-0a-1": "done",
    "v3-0a-2": "done",
    "v3-0a-3": "done",
    "v3-0a-4": "active"
  },
  taskDates: {
    "project-history-1": "2026-05-02",
    "project-history-2": "2026-05-03",
    "project-history-3": "2026-05-04",
    "project-history-4": "2026-05-05",
    "project-history-5": "2026-05-06",
    "project-history-6": "2026-05-06",
    "project-history-7": "2026-05-07",
    "project-history-8": "2026-05-09",
    "project-history-9": "2026-05-25",
    "completed-v3-0-1": "2026-05-09",
    "completed-v3-0-2": "2026-05-09",
    "completed-v3-0-3": "2026-05-09",
    "completed-v3-0-4": "2026-05-09",
    "completed-v3-0-5": "2026-05-09",
    "completed-v3-0-6": "2026-05-09",
    "completed-v3-0-7": "2026-05-09",
    "completed-v3-0-8": "2026-05-09",
    "completed-v3-0-9": "2026-05-25",
    "shipped-terry-pilot-1": "2026-05-11",
    "shipped-terry-pilot-2": "2026-05-11",
    "shipped-terry-pilot-3": "2026-05-22",
    "shipped-terry-pilot-4": "2026-05-22",
    "shipped-terry-pilot-5": "2026-05-23",
    "shipped-terry-pilot-6": "2026-05-21",
    "shipped-terry-pilot-7": "2026-05-23",
    "shipped-terry-pilot-8": "2026-05-25",
    "shipped-terry-pilot-9": "2026-05-25",
    "v3-0a-1": "2026-05-25",
    "v3-0a-2": "2026-05-25",
    "v3-0a-3": "2026-05-25"
  }
};
