(() => {
  "use strict";

  const STORAGE_KEY = "polinetwork_studylab_v1";
  const STATE_SCHEMA = 2;
  const MAX_EPOCH_MS = 32503680000000;

  let CORPUS = null;
  let PACK = null;
  let ALL_SECTIONS = [];
  let STUDYABLE_SECTIONS = [];
  let CLOZEABLE_SECTIONS = [];
  let SECTION_MAP = new Map();

  let state = null;
  let currentView = "overview";
  let readerDocFilter = "all";
  let readerStatusFilter = "all";
  let readerSecId = null;
  let readerMode = "read";
  let returnStack = [];

  let practiceMode = "flashcards";
  let practiceClozeSecId = null;

  let inlineClozeCtrl = null;
  let practiceClozeCtrl = null;

  let fcQueue = [];
  let fcTotalSession = 0;
  let fcCompletedSession = 0;
  let fcFlipped = false;
  let fcLastAction = null;
  let fcCustomContext = null;

  let qzQueue = [];
  let qzIdx = 0;
  let qzCorrect = 0;
  let qzWrong = [];
  let qzAnswered = false;
  let qzCustomContext = null;

  let csTab = "timeline";
  let lbGallery = [];
  let lbIdx = 0;

  let gsResults = [];
  let gsActiveIdx = -1;
  let lastFocusedEl = null;
  let activeTrapContainer = null;

  const DOC_SHORT = { statuto: "Statuto", rri: "RRI", elettorale: "Elettorale" };
  const DOC_CLEAN = { statuto: "Statuto", rri: "Regolamenti Interni", elettorale: "Regolamento Elettorale" };
  const STATUS_LABELS = ["Da studiare", "In corso", "Imparato", "A memoria"];
  const MODE_LABELS = { all: "Tutte", blitz: "Blitz", mc: "Normativa", scenario: "Scenari" };
  const MONTHS_IT = ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"];

  const DIAGRAM_LABELS = {
    "21": "Allegato D — Modulo Candidatura Direttivo",
    "22": "Allegato E — Modulo Delega",
    "23": "Allegato F — Modulo Partecipazione a Distanza",
    "24": "Allegato G — Timeline dei Tempi (1/4)",
    "25": "Allegato G — Timeline dei Tempi (2/4)",
    "26": "Allegato G — Timeline dei Tempi (3/4)",
    "27": "Allegato G — Timeline dei Tempi (4/4)",
    "28": "Allegato H — Schema Scrutinio STV (1/2)",
    "29": "Allegato H — Schema Scrutinio STV (2/2)",
    "32": "Allegato K — Processo Elettorale per Attore (1/2)",
    "33": "Allegato K — Processo Elettorale per Attore (2/2)",
  };

  const CS_PLACEHOLDERS = {
    timeline: "Filtra cronoprogramma…",
    quorums: "Filtra quorum…",
    organs: "Filtra organi…",
    deadlines: "Filtra scadenze…",
    diagrams: "Filtra schemi PDF…",
  };

  const STOPWORDS = new Set([
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per",
    "tra", "fra", "del", "dello", "della", "dei", "degli", "delle", "al", "allo", "alla", "ai", "agli",
    "alle", "dal", "dallo", "dalla", "dai", "dagli", "dalle", "nel", "nello", "nella", "nei", "negli",
    "nelle", "sul", "sullo", "sulla", "sui", "sugli", "sulle", "e", "ed", "o", "od", "ma", "che", "chi",
    "cui", "non", "si", "se", "come", "anche", "più", "solo", "sono", "è", "ha", "hanno", "può", "essere",
    "tale", "tali", "ogni", "tutti", "tutte", "questo", "questa", "questi", "queste", "quello", "quella",
    "suo", "sua", "suoi", "sue", "loro", "proprio", "propria", "propri", "proprie", "altri", "altre",
    "altro", "altra", "caso", "sensi", "presente", "presenti", "stato", "stata", "dalla", "dall",
    "dell", "all", "nell", "sull", "l", "d"
  ]);

  // ==================== DIAGNOSTIC TELEMETRY & CLOUD AUDIT CONSOLE ====================
  const DIAG_STORAGE_KEY = "polinetwork_studylab_diag_v1";
  const APP_VERSION = "v4.4.0";
  const VALID_CS_TABS = new Set(["timeline", "quorums", "organs", "deadlines", "hierarchy", "diagrams"]);
  const NON_CLOZE_SECTIONS = new Set(["el-b-1", "el-d", "el-e", "el-f", "el-g", "el-h", "el-k"]);
  let fcCustomCards = null;
  let searchIndex = [];
  let diagEvents = loadDiagEvents();
  let diagSeq = diagEvents.length;

  function loadDiagEvents() {
    try {
      const raw = sessionStorage.getItem(DIAG_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.slice(-200);
      }
    } catch (_) { /* ignore */ }
    return [];
  }

  function saveDiagEvents() {
    try {
      sessionStorage.setItem(DIAG_STORAGE_KEY, JSON.stringify(diagEvents.slice(-200)));
    } catch (_) { /* ignore */ }
  }

  function formatDiagTime(dateObj) {
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}.${pad(dateObj.getMilliseconds(), 3)}`;
  }

  function summarizeStateForLog(s) {
    if (!s || typeof s !== "object") return "null";
    const mKeys = Object.keys(s.mastery || {}).filter(k => (s.mastery[k] || 0) > 0);
    const mLearned = mKeys.filter(k => s.mastery[k] >= 2).length;
    const mMem = mKeys.filter(k => s.mastery[k] === 3).length;
    const bmCount = Object.keys(s.bookmarks || {}).filter(k => s.bookmarks[k]).length;
    const sm2Count = Object.keys(s.sm2 || {}).length;
    const qzMastCount = Object.keys(s.quizMastered || {}).filter(k => s.quizMastered[k]).length;
    return `mastery=${mKeys.length}(learned=${mLearned},mem=${mMem}) bm=${bmCount} sm2=${sm2Count} qzMastered=${qzMastCount} qzTotal=${s.quizStats?.total || 0} lastSec=${s.lastSecId || "-"} updatedAt=${s.updatedAt || 0}`;
  }

  function diagLog(category, action, details = "") {
    diagSeq++;
    const now = new Date();
    const detailStr = typeof details === "object" && details !== null
      ? JSON.stringify(details)
      : String(details || "");
    const line = `[#${String(diagSeq).padStart(3, "0")}] ${formatDiagTime(now)} [${category}] ${action}${detailStr ? ` — ${detailStr}` : ""}`;
    diagEvents.push(line);
    if (diagEvents.length > 250) diagEvents = diagEvents.slice(-250);
    saveDiagEvents();
    refreshDiagConsoleUI();
  }

  function buildFullDiagnosticReport() {
    const now = new Date();
    const lsRaw = (() => { try { return localStorage.getItem(STORAGE_KEY) || ""; } catch (_) { return "ERR"; } })();
    const header = [
      "=== POLINETWORK STUDIO — REPORT DIAGNOSTICO APP & CLOUD ===",
      `Timestamp ISO      : ${now.toISOString()}`,
      `Versione App       : ${APP_VERSION}`,
      `URL                : ${location.href}`,
      `Hostname           : ${location.hostname}`,
      `Online             : ${navigator.onLine}`,
      `Viewport           : ${window.innerWidth}x${window.innerHeight} (DPR ${window.devicePixelRatio || 1})`,
      `User-Agent         : ${navigator.userAgent}`,
      `--- STATO CORPUS & DATI ---`,
      `Corpus caricato    : ${!!CORPUS} (sezioni totali=${ALL_SECTIONS.length}, studiabili=${STUDYABLE_SECTIONS.length}, cloze=${CLOZEABLE_SECTIONS.length})`,
      `StudyPack caricato : ${!!PACK} (flashcard=${PACK?.flashcards?.length || 0}, quiz=${PACK?.quizzes?.length || 0})`,
      `Vista attiva       : view=${currentView} readerSec=${readerSecId || "-"} readerMode=${readerMode} practiceMode=${practiceMode} csTab=${csTab}`,
      `--- STATO LOCALE (localStorage) ---`,
      `Storage Key        : ${STORAGE_KEY} (${lsRaw.length} bytes)`,
      `Sommario Locale    : ${summarizeStateForLog(state)}`,
      `Tema / Scala       : theme=${state?.theme} scale=${state?.readerScale}`,
      `--- STATO FIREBASE & CLOUD ---`,
      `Firebase ProjectId : ${FIREBASE_CONFIG.projectId} (${FIREBASE_CONFIG.authDomain})`,
      `SDK Inizializzato  : app=${!!fbApp} auth=${!!fbAuth} firestore=${!!fbDb} cache=${fbCacheMode} analytics=${getAnalyticsConsent() || "non-scelto"}`,
      `Utente Google      : ${fbUser ? `CONNESSO (uid=${maskUid(fbUser.uid)}, email=${maskEmail(fbUser.email)})` : "NON CONNESSO"}`,
      `Collezione Cloud   : ${CLOUD_COLLECTION}`,
      `Stato Sync Cloud   : status=${cloudStatus} pendingPush=${cloudPendingPush} lastSyncedAt=${cloudLastSyncedAt ? new Date(cloudLastSyncedAt).toISOString() : "mai"} liveListener=${cloudLiveActive} retries=${pushRetryAttempt}`,
      "",
      `=== CRONOLOGIA EVENTI (${diagEvents.length} registrati) ===`,
      ...diagEvents,
      "=== FINE REPORT DIAGNOSTICO ===",
    ];
    return header.join("\n");
  }

  function refreshDiagConsoleUI() {
    const badge = document.getElementById("diagCountBadge");
    if (badge) badge.textContent = `${diagEvents.length} eventi`;
    const out = document.getElementById("diagConsoleOutput");
    if (out && !out.closest(".hidden")) {
      out.value = buildFullDiagnosticReport();
      out.scrollTop = out.scrollHeight;
    }
  }

  let diagTestRunning = false;
  let diagLastRunAt = 0;

  function maskEmail(email) {
    const e = String(email || "");
    const at = e.indexOf("@");
    if (at < 1) return e ? "***" : "-";
    return `${e.slice(0, Math.min(3, at))}***${e.slice(at)}`;
  }

  function maskUid(uid) {
    const u = String(uid || "");
    return u ? `${u.slice(0, 6)}…` : "-";
  }

  async function runFullCloudAndAppDiagnostic() {
    if (diagTestRunning || (Date.now() - diagLastRunAt) < 1200) {
      diagLog("SELF-TEST", "Test già in corso o appena eseguito — doppio tap ignorato");
      return;
    }
    diagTestRunning = true;
    diagLastRunAt = Date.now();
    const btn = document.getElementById("btnDiagTestCloud");
    if (btn) { btn.disabled = true; btn.textContent = "Test in corso…"; }
    try {
      diagLog("SELF-TEST", "Avvio test diagnostico completo App + Cloud…");
      // 1. LocalStorage test
      try {
        const testKey = `${STORAGE_KEY}_diag_probe`;
        const probeVal = String(Date.now());
        localStorage.setItem(testKey, probeVal);
        const readBack = localStorage.getItem(testKey);
        localStorage.removeItem(testKey);
        diagLog("SELF-TEST", "1/4 LocalStorage R/W", readBack === probeVal ? "PASS (lettura/scrittura OK)" : "FAIL (mismatch)");
      } catch (e) {
        diagLog("SELF-TEST", "1/4 LocalStorage R/W", `FAIL (${e.message || e})`);
      }

      // 2. Corpus & UI integrity test
      const domChecks = ["view-overview", "view-reader", "view-practice", "view-reference", "backupModal", "searchModal"]
        .every(id => !!document.getElementById(id));
      diagLog(
        "SELF-TEST",
        "2/4 Integrità Corpus & DOM",
        CORPUS && PACK && ALL_SECTIONS.length === 160 && domChecks
          ? `PASS (160 sezioni, ${PACK.flashcards.length} flashcard, ${PACK.quizzes.length} quiz, DOM completo)`
          : `WARN (sezioni=${ALL_SECTIONS.length}, dom=${domChecks})`
      );

      // 3. Firebase SDK & Auth check
      if (!fbApp || !fbAuth || !fbDb) {
        diagLog("SELF-TEST", "3/4 Firebase SDK", "Non ancora inizializzato, attendo init…");
        await initFirebaseCloud();
      }
      diagLog(
        "SELF-TEST",
        "3/4 Firebase SDK & Auth",
        `app=${!!fbApp} auth=${!!fbAuth} firestore=${!!fbDb} cache=${fbCacheMode} user=${fbUser ? `${maskEmail(fbUser.email)} (uid=${maskUid(fbUser.uid)})` : "NON LOGGATO"}`
      );

      // 4. Cloud Firestore round-trip
      if (!fbUser) {
        diagLog("SELF-TEST", "4/4 Test Cloud Firestore R/W", "SKIP — Effettua prima 'Accedi con Google' per testare lettura/scrittura Cloud.");
        showToast("Test locale OK · Accedi con Google per il test Cloud");
        return;
      }
      const uid = fbUser.uid;
      const t0 = performance.now();
      diagLog("SELF-TEST", "4/4 Test Cloud Firestore R/W", "Avvio test REST API + SDK…");
      try {
        const token = await fbUser.getIdToken();
        const restUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${CLOUD_COLLECTION}/${uid}`;
        const restRes = await fetch(restUrl, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
        const restMs = Math.round(performance.now() - t0);
        if (restRes.status === 200 || restRes.status === 404) {
          diagLog("SELF-TEST", "4a/4 Firestore REST API", `HTTP ${restRes.status} OK in ${restMs}ms — Database raggiungibile e permessi validi`);
        } else {
          const errBody = await restRes.text();
          let errReason = errBody.slice(0, 260);
          try {
            const parsed = JSON.parse(errBody);
            errReason = `${parsed?.error?.status || ""} — ${parsed?.error?.message || errReason}`;
          } catch (_) { /* ignore */ }
          diagLog("SELF-TEST", "4a/4 Firestore REST API", `HTTP ${restRes.status} in ${restMs}ms — ${errReason}`);
          if (restRes.status === 403) {
            setCloudNotice(`Firestore risponde HTTP 403 (${errReason}). Verifica che il database esista e che le regole consentano l'accesso al proprio documento users/{uid}.`, true);
          }
        }
      } catch (restErr) {
        diagLog("SELF-TEST", "4a/4 Firestore REST API", `ERRORE RETE — ${restErr?.message || restErr}`);
      }

      const sdkT0 = performance.now();
      const pushed = await pushStateToCloud({ reason: "self-test" });
      try {
        const ref = fbModules.doc(fbDb, CLOUD_COLLECTION, uid);
        const snap = await withCloudTimeout(fbModules.getDocFromServer(ref), 8000, "getDocFromServer");
        const ms = Math.round(performance.now() - sdkT0);
        if (pushed && snap.exists()) {
          diagLog("SELF-TEST", "4b/4 Firestore SDK Round-Trip", `PASS in ${ms}ms — '${CLOUD_COLLECTION}/${maskUid(uid)}' scritto e riletto dal server (${summarizeStateForLog(snap.data()?.studylab_v1)})`);
          showToast(`Test Cloud PASS (${ms}ms) ✓`);
        } else {
          diagLog("SELF-TEST", "4b/4 Firestore SDK Round-Trip", `WARN in ${ms}ms — push=${pushed ? "OK" : "FALLITO"} documento=${snap.exists() ? "presente" : "assente"}`);
          showToast("Test Cloud parziale (vedi log)");
        }
      } catch (err) {
        const ms = Math.round(performance.now() - sdkT0);
        diagLog("SELF-TEST", "4b/4 Firestore SDK Round-Trip", `FAIL in ${ms}ms — push=${pushed ? "OK" : "FALLITO"} code=${err?.code || "timeout"} msg=${err?.message || err}`);
        showToast("Test Cloud fallito (vedi log)");
      }
    } finally {
      diagTestRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = "⚡ Testa Cloud"; }
      refreshDiagConsoleUI();
    }
  }

  async function copyDiagnosticReportToClipboard() {
    diagLog("CONSOLE", "Generazione report completo per copia negli appunti");
    const report = buildFullDiagnosticReport();
    const out = document.getElementById("diagConsoleOutput");
    if (out) out.value = report;
    const hint = document.getElementById("diagStatusHint");
    try {
      await navigator.clipboard.writeText(report);
      showToast("Log completo copiato negli appunti ✓");
      if (hint) hint.textContent = `✓ Copiati ${report.length} caratteri (${diagEvents.length} eventi). Incollali in chat!`;
    } catch (_) {
      let ok = false;
      if (out) {
        out.focus();
        out.select();
        try { ok = document.execCommand && document.execCommand("copy"); } catch (_) { ok = false; }
      }
      showToast(ok ? "Log selezionato e copiato ✓" : "Seleziona il testo e copialo manualmente");
      if (hint && !ok) hint.textContent = "Copia automatica non disponibile: tieni premuto sul testo → Seleziona tutto → Copia.";
    }
  }

  window.addEventListener("error", e => {
    diagLog("ERROR", "Window Error", `${e.message || "error"} (${e.filename || ""}:${e.lineno || 0})`);
  });
  window.addEventListener("unhandledrejection", e => {
    const r = e.reason;
    diagLog("ERROR", "Unhandled Promise Rejection", r?.stack || r?.message || String(r));
  });

  // ==================== PERSISTENCE & FIREBASE CLOUD SYNC ====================
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyC8HjMUxxtbuf0YwcjSwcedLD5_BiUFlYw",
    authDomain: "polinetwork.firebaseapp.com",
    projectId: "polinetwork",
    storageBucket: "polinetwork.firebasestorage.app",
    messagingSenderId: "234080938640",
    appId: "1:234080938640:web:d5fd10c99545d7130e4615",
    measurementId: "G-ZRVKLNBHLF",
  };
  const FIREBASE_SDK_VERSION = "11.0.2";
  const CLOUD_COLLECTION = "users";
  const CONSENT_KEY = "polinetwork_analytics_consent";
  const PUSH_DEBOUNCE_MS = 1500;
  const PUSH_MAX_WAIT_MS = 10000;
  const CLOUD_OP_TIMEOUT_MS = 10000;

  let fbApp = null;
  let fbAuth = null;
  let fbDb = null;
  let fbModules = null;
  let fbUser = null;
  let fbInitPromise = null;
  let fbCacheMode = "n/d";
  let fbAnalytics = null;
  let fbAnalyticsMod = null;
  let fbUnsubSnapshot = null;
  let fbLiveRestartTimer = null;
  let cloudLiveActive = false;
  let cloudPendingPush = false;
  let cloudLastSyncedAt = 0;
  let cloudApplyingRemote = false;
  let cloudStatus = "idle"; // idle | syncing | online | pending | error
  let pushInFlight = null;
  let pushQueued = false;
  let pushDebounceTimer = null;
  let pushDebounceFirstAt = 0;
  let pushRetryTimer = null;
  let pushRetryAttempt = 0;
  let localRev = 0;

  function getDeviceId() {
    const k = "polinetwork_studylab_device_id";
    try {
      let id = localStorage.getItem(k);
      if (!id) {
        id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(k, id);
      }
      return id;
    } catch (_) {
      return "d-unknown";
    }
  }

  function defaultState() {
    return {
      schema: 2,
      mastery: {},
      bookmarks: {},
      sm2: {},
      quizStats: { total: 0, correct: 0, byDevice: {} },
      quizMastered: {},
      theme: "light",
      readerScale: 1,
      lastSecId: null,
      updatedAt: 0,
      resetAt: 0,
      ownerUid: null,
      _ts: { mastery: {}, bookmarks: {}, quizMastered: {}, sm2Del: {} },
      prefs: {
        highlightNums: true,
        clozeLevel: "1",
        clozeInputMode: "click",
        fcDeckMode: "curated",
      },
    };
  }

  function recomputeQuizTotals(qs) {
    let total = 0;
    let correct = 0;
    for (const d of Object.values(qs.byDevice || {})) {
      total += Number(d?.total) || 0;
      correct += Number(d?.correct) || 0;
    }
    qs.total = total;
    qs.correct = correct;
    return qs;
  }

  function normalizeQuizStats(raw) {
    const qs = { total: 0, correct: 0, byDevice: {} };
    if (raw && typeof raw === "object") {
      if (raw.byDevice && typeof raw.byDevice === "object") {
        for (const [id, d] of Object.entries(raw.byDevice)) {
          qs.byDevice[id] = { total: Number(d?.total) || 0, correct: Number(d?.correct) || 0 };
        }
      } else if ((Number(raw.total) || 0) > 0) {
        // Legacy (pre-v4.3) aggregate counters → single "legacy" bucket
        qs.byDevice.legacy = { total: Number(raw.total) || 0, correct: Number(raw.correct) || 0 };
      }
    }
    return recomputeQuizTotals(qs);
  }

  function clampEpochMs(v) {
    const n = Math.round(Number(v) || 0);
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_EPOCH_MS, n)) : 0;
  }

  function sanitizeTsMap(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      const t = clampEpochMs(v);
      if (t > 0) out[k] = t;
    }
    return out;
  }

  function sanitizeSm2Map(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, rec] of Object.entries(raw)) {
      if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
      const reps = Math.max(0, Math.min(1000, Math.round(Number(rec.reps) || 0)));
      const interval = Math.max(0, Math.min(36500, Math.round(Number(rec.interval) || 0)));
      const efRaw = Number(rec.ef);
      const ef = Number.isFinite(efRaw) ? Number(Math.max(1.3, Math.min(5, efRaw)).toFixed(2)) : 2.5;
      const lastReviewedAt = clampEpochMs(rec.lastReviewedAt);
      const nextReviewRaw = clampEpochMs(rec.nextReview);
      const nextReview = nextReviewRaw || (lastReviewedAt ? clampEpochMs(lastReviewedAt + interval * 86400000) : 0);
      const clean = { reps, interval, ef, lastReviewedAt, nextReview };
      const editedAt = clampEpochMs(rec._editedAt);
      if (editedAt > 0) clean._editedAt = editedAt;
      out[k] = clean;
    }
    return out;
  }

  function normalizeStateObject(p) {
    const def = defaultState();
    if (!p || typeof p !== "object" || Array.isArray(p)) return def;

    const mastery = {};
    if (p.mastery && typeof p.mastery === "object" && !Array.isArray(p.mastery)) {
      for (const [k, v] of Object.entries(p.mastery)) {
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n >= 1 && n <= 3) mastery[k] = n;
      }
    }

    const bookmarks = {};
    if (p.bookmarks && typeof p.bookmarks === "object" && !Array.isArray(p.bookmarks)) {
      for (const [k, v] of Object.entries(p.bookmarks)) {
        if (v) bookmarks[k] = true;
      }
    }

    const quizMastered = {};
    if (p.quizMastered && typeof p.quizMastered === "object" && !Array.isArray(p.quizMastered)) {
      for (const [k, v] of Object.entries(p.quizMastered)) {
        if (v) quizMastered[k] = true;
      }
    }

    const rawPrefs = (p.prefs && typeof p.prefs === "object" && !Array.isArray(p.prefs)) ? p.prefs : {};
    const clozeLevel = ["1", "2", "3", "4"].includes(String(rawPrefs.clozeLevel)) ? String(rawPrefs.clozeLevel) : def.prefs.clozeLevel;
    const clozeInputMode = ["click", "type"].includes(rawPrefs.clozeInputMode) ? rawPrefs.clozeInputMode : def.prefs.clozeInputMode;
    const fcDeckMode = ["curated", "all_articles", "combined"].includes(rawPrefs.fcDeckMode) ? rawPrefs.fcDeckMode : def.prefs.fcDeckMode;
    const scaleRaw = Number(p.readerScale);
    const readerScale = Number.isFinite(scaleRaw) ? Number(Math.max(0.88, Math.min(1.28, scaleRaw)).toFixed(2)) : 1;

    return {
      schema: STATE_SCHEMA,
      mastery,
      bookmarks,
      sm2: sanitizeSm2Map(p.sm2),
      quizStats: normalizeQuizStats(p.quizStats),
      quizMastered,
      theme: p.theme === "dark" ? "dark" : "light",
      readerScale,
      lastSecId: typeof p.lastSecId === "string" && p.lastSecId.length <= 80 ? p.lastSecId : null,
      updatedAt: clampEpochMs(p.updatedAt),
      resetAt: clampEpochMs(p.resetAt),
      ownerUid: typeof p.ownerUid === "string" && p.ownerUid.length <= 128 ? p.ownerUid : null,
      _ts: {
        mastery: sanitizeTsMap(p._ts?.mastery),
        bookmarks: sanitizeTsMap(p._ts?.bookmarks),
        quizMastered: sanitizeTsMap(p._ts?.quizMastered),
        sm2Del: sanitizeTsMap(p._ts?.sm2Del),
      },
      prefs: {
        highlightNums: rawPrefs.highlightNums !== false,
        clozeLevel,
        clozeInputMode,
        fcDeckMode,
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeStateObject(JSON.parse(raw));
    } catch (err) {
      console.error("loadState error:", err);
      diagLog("ERROR", "Errore lettura localStorage (ripristinato stato iniziale)", err?.message || String(err));
    }
    return defaultState();
  }

  function freshStateKeepingPrefs() {
    return normalizeStateObject({
      ...defaultState(),
      theme: state.theme,
      readerScale: state.readerScale,
      prefs: { ...state.prefs },
    });
  }

  /**
   * saveState options:
   *  - light: UI-only change (e.g. last opened article). No timestamp bump, no Cloud push, no log.
   *  - preserveTimestamp / skipCloud / silentLog: fine-grained control (used when applying remote state).
   */
  function saveState(opts = {}) {
    const light = !!opts.light;
    if (!light && !opts.preserveTimestamp) {
      state.updatedAt = Date.now();
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!light && !opts.silentLog) {
        diagLog("STATE", "Salvato in localStorage", summarizeStateForLog(state));
      }
    } catch (e) {
      diagLog("ERROR", "Errore scrittura localStorage", e?.message || e);
    }
    if (light || opts.skipCloud || cloudApplyingRemote) return;
    localRev++;
    if (fbUser) scheduleCloudPush();
  }

  function ensureTs() {
    if (!state._ts) state._ts = {};
    state._ts.mastery ||= {};
    state._ts.bookmarks ||= {};
    state._ts.quizMastered ||= {};
    state._ts.sm2Del ||= {};
    return state._ts;
  }

  function recordQuizAnswer(itemId, ok) {
    const qs = state.quizStats || (state.quizStats = { total: 0, correct: 0, byDevice: {} });
    qs.byDevice ||= {};
    const dev = getDeviceId();
    const d = qs.byDevice[dev] || (qs.byDevice[dev] = { total: 0, correct: 0 });
    d.total++;
    if (ok) d.correct++;
    recomputeQuizTotals(qs);
    const ts = ensureTs();
    if (ok) state.quizMastered[itemId] = true;
    else delete state.quizMastered[itemId];
    ts.quizMastered[itemId] = Date.now();
  }

  function sm2RecordTs(rec) {
    if (!rec) return 0;
    const last = Number(rec.lastReviewedAt) || 0;
    const edited = Number(rec._editedAt) || 0;
    const derived = last || ((Number(rec.nextReview) || 0) - (Number(rec.interval) || 0) * 86400000);
    return Math.max(derived > 0 ? derived : 0, edited);
  }

  function stableStringify(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
    return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }

  function mergeFlagMap(lMap, rMap, lTsMap, rTsMap) {
    const out = {};
    const outTs = {};
    const keys = new Set([
      ...Object.keys(lMap || {}), ...Object.keys(rMap || {}),
      ...Object.keys(lTsMap || {}), ...Object.keys(rTsMap || {}),
    ]);
    for (const k of keys) {
      const lTs = Number(lTsMap?.[k]) || 0;
      const rTs = Number(rTsMap?.[k]) || 0;
      let active;
      if (lTs > 0 || rTs > 0) {
        if (rTs > lTs) active = !!rMap?.[k];
        else if (lTs > rTs) active = !!lMap?.[k];
        else active = !!(lMap?.[k] || rMap?.[k]);
        outTs[k] = Math.max(lTs, rTs);
      } else {
        active = !!(lMap?.[k] || rMap?.[k]);
      }
      if (active) out[k] = true;
    }
    return { map: out, ts: outTs };
  }

  function mergeCloudAndLocalState(localRaw, remoteRaw) {
    const local = normalizeStateObject(localRaw);
    const remote = normalizeStateObject(remoteRaw);

    // Explicit full reset more recent than every change on the other side wins entirely
    if (remote.resetAt > local.updatedAt && remote.resetAt > local.resetAt) {
      return normalizeStateObject({ ...remote, ownerUid: local.ownerUid || remote.ownerUid });
    }
    if (local.resetAt > remote.updatedAt && local.resetAt > remote.resetAt) {
      return normalizeStateObject({ ...local });
    }

    const baseResetAt = Math.max(local.resetAt || 0, remote.resetAt || 0);
    const newerIsRemote = (remote.updatedAt || 0) > (local.updatedAt || 0);
    const primary = newerIsRemote ? remote : local;

    // Mastery: per-section last-writer-wins (timestamps kept even for level 0 to propagate downgrades)
    const mergedMastery = {};
    const mergedMasteryTs = {};
    const allMasteryKeys = new Set([
      ...Object.keys(local.mastery), ...Object.keys(remote.mastery),
      ...Object.keys(local._ts.mastery), ...Object.keys(remote._ts.mastery),
    ]);
    for (const k of allMasteryKeys) {
      const lTs = Number(local._ts.mastery[k]) || 0;
      const rTs = Number(remote._ts.mastery[k]) || 0;
      const lVal = Number(local.mastery[k]) || 0;
      const rVal = Number(remote.mastery[k]) || 0;
      let val;
      if (lTs > 0 || rTs > 0) {
        if (rTs > lTs) val = rVal;
        else if (lTs > rTs) val = lVal;
        else val = Math.max(lVal, rVal);
        mergedMasteryTs[k] = Math.max(lTs, rTs);
      } else {
        val = Math.max(lVal, rVal);
      }
      if (val > 0) mergedMastery[k] = val;
    }

    const bm = mergeFlagMap(local.bookmarks, remote.bookmarks, local._ts.bookmarks, remote._ts.bookmarks);
    const qm = mergeFlagMap(local.quizMastered, remote.quizMastered, local._ts.quizMastered, remote._ts.quizMastered);

    // SM-2: newest record wins; tombstones (undo of a first review) win if newer than any record
    const mergedSm2 = {};
    const mergedSm2Del = {};
    const allSm2Keys = new Set([
      ...Object.keys(local.sm2), ...Object.keys(remote.sm2),
      ...Object.keys(local._ts.sm2Del), ...Object.keys(remote._ts.sm2Del),
    ]);
    for (const k of allSm2Keys) {
      const lRec = local.sm2[k];
      const rRec = remote.sm2[k];
      const lT = sm2RecordTs(lRec);
      const rT = sm2RecordTs(rRec);
      let best = null;
      let bestTs = 0;
      if (lRec && rRec) {
        if (rT > lT) { best = rRec; bestTs = rT; }
        else if (lT > rT) { best = lRec; bestTs = lT; }
        else { best = (Number(rRec.reps) || 0) >= (Number(lRec.reps) || 0) ? rRec : lRec; bestTs = lT; }
      } else if (lRec) { best = lRec; bestTs = lT; }
      else if (rRec) { best = rRec; bestTs = rT; }
      const delTs = Math.max(Number(local._ts.sm2Del[k]) || 0, Number(remote._ts.sm2Del[k]) || 0);
      if (delTs > 0 && delTs >= bestTs) {
        mergedSm2Del[k] = delTs;
      } else if (best) {
        mergedSm2[k] = best;
        if (delTs > 0) mergedSm2Del[k] = delTs;
      }
    }

    // Quiz stats: per-device monotonic counters → take max per device, then sum
    const byDevice = {};
    for (const id of new Set([...Object.keys(local.quizStats.byDevice), ...Object.keys(remote.quizStats.byDevice)])) {
      const l = local.quizStats.byDevice[id] || { total: 0, correct: 0 };
      const r = remote.quizStats.byDevice[id] || { total: 0, correct: 0 };
      byDevice[id] = r.total > l.total ? { ...r } : (l.total > r.total ? { ...l } : { total: l.total, correct: Math.max(l.correct, r.correct) });
    }

    return normalizeStateObject({
      ...primary,
      mastery: mergedMastery,
      bookmarks: bm.map,
      sm2: mergedSm2,
      quizMastered: qm.map,
      quizStats: recomputeQuizTotals({ total: 0, correct: 0, byDevice }),
      theme: primary.theme || local.theme || "light",
      readerScale: primary.readerScale || local.readerScale || 1,
      lastSecId: primary.lastSecId || local.lastSecId || remote.lastSecId || null,
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
      resetAt: baseResetAt,
      ownerUid: local.ownerUid || remote.ownerUid || null,
      _ts: { mastery: mergedMasteryTs, bookmarks: bm.ts, quizMastered: qm.ts, sm2Del: mergedSm2Del },
      prefs: { ...local.prefs, ...remote.prefs, ...primary.prefs },
    });
  }

  function makeInitialsAvatarDataUri(nameOrEmail) {
    const clean = String(nameOrEmail || "PN").trim();
    const parts = clean.split(/[\s._@-]+/).filter(Boolean);
    const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#0071e3"/><text x="32" y="40" font-family="-apple-system,system-ui,sans-serif" font-size="24" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(initials)}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function formatSyncTime(ts) {
    if (!ts) return "in tempo reale";
    const d = new Date(ts);
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function setCloudNotice(msg, isError = false) {
    const el = document.getElementById("cloudModalNotice");
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.style.background = isError ? "var(--red-soft)" : "var(--orange-soft)";
    el.style.color = isError ? "var(--red-text)" : "var(--orange-text)";
    el.classList.remove("hidden");
  }

  function updateCloudUI() {
    const isSigned = !!fbUser;
    const avatarSrc = isSigned ? (fbUser.photoURL || makeInitialsAvatarDataUri(fbUser.displayName || fbUser.email)) : "";
    const fallbackSrc = isSigned ? makeInitialsAvatarDataUri(fbUser.displayName || fbUser.email) : "";

    [
      { ic: "cloudBtnIcon", av: "cloudBtnAvatar", dot: "cloudStatusDot" },
      { ic: "cloudBtnIconMobile", av: "cloudBtnAvatarMobile", dot: "cloudStatusDotMobile" },
    ].forEach(({ ic, av, dot }) => {
      const icEl = document.getElementById(ic);
      const avEl = document.getElementById(av);
      const dotEl = document.getElementById(dot);
      if (icEl) icEl.classList.toggle("hidden", isSigned);
      if (avEl) {
        avEl.classList.toggle("hidden", !isSigned);
        if (isSigned && avEl.getAttribute("src") !== avatarSrc) {
          avEl.src = avatarSrc;
          avEl.onerror = () => { avEl.src = fallbackSrc; };
        }
      }
      if (dotEl) {
        dotEl.classList.toggle("hidden", !isSigned);
        dotEl.className = `cloud-dot ${!isSigned ? "hidden" : (cloudStatus === "syncing" ? "syncing" : (cloudStatus === "pending" ? "pending" : (cloudStatus === "error" ? "error" : "")))}`;
      }
    });

    const homeOut = document.getElementById("cloudHomeOut");
    const homeIn = document.getElementById("cloudHomeIn");
    if (homeOut && homeIn) {
      homeOut.classList.toggle("hidden", isSigned);
      homeIn.classList.toggle("hidden", !isSigned);
      if (isSigned) {
        const hAv = document.getElementById("cloudHomeAvatar");
        if (hAv && hAv.getAttribute("src") !== avatarSrc) {
          hAv.src = avatarSrc;
          hAv.onerror = () => { hAv.src = fallbackSrc; };
        }
        document.getElementById("cloudHomeName").textContent = fbUser.displayName || fbUser.email || "Account Google";
        const subEl = document.getElementById("cloudHomeSub");
        if (cloudStatus === "syncing") subEl.textContent = "● Sincronizzazione Cloud in corso…";
        else if (cloudStatus === "pending") subEl.textContent = "● Salvato in locale · In attesa di rete";
        else if (cloudStatus === "error") subEl.textContent = "● Salvato in locale · Tocca per verificare Cloud";
        else subEl.textContent = `● Sincronizzato nel Cloud · ${formatSyncTime(cloudLastSyncedAt)}`;
      }
    }

    const modOut = document.getElementById("cloudModalOut");
    const modIn = document.getElementById("cloudModalIn");
    if (modOut && modIn) {
      modOut.classList.toggle("hidden", isSigned);
      modIn.classList.toggle("hidden", !isSigned);
      if (isSigned) {
        const mAv = document.getElementById("cloudModalAvatar");
        if (mAv && mAv.getAttribute("src") !== avatarSrc) {
          mAv.src = avatarSrc;
          mAv.onerror = () => { mAv.src = fallbackSrc; };
        }
        document.getElementById("cloudModalName").textContent = fbUser.displayName || "Utente Google";
        document.getElementById("cloudModalEmail").textContent = fbUser.email || "";
        const badge = document.getElementById("cloudModalStatusBadge");
        const tsEl = document.getElementById("cloudModalTimestamp");
        if (cloudStatus === "syncing") {
          badge.className = "cloud-pill-status syncing";
          badge.textContent = "● Sincronizzo…";
          tsEl.textContent = "Aggiornamento continuo nel Cloud in corso…";
        } else if (cloudStatus === "pending") {
          badge.className = "cloud-pill-status pending";
          badge.textContent = "● In coda";
          tsEl.textContent = "Progressi al sicuro sul dispositivo; verranno inviati al Cloud appena torna la rete.";
        } else if (cloudStatus === "error") {
          badge.className = "cloud-pill-status error";
          badge.textContent = "● Locale attivo";
          tsEl.textContent = "Progressi salvati sul dispositivo.";
        } else {
          badge.className = "cloud-pill-status online";
          badge.textContent = "● Cloud attivo";
          tsEl.textContent = cloudLastSyncedAt
            ? `Ultimo backup Cloud automatico: oggi alle ${formatSyncTime(cloudLastSyncedAt)} — Sincronizzazione continua attiva.`
            : "Sincronizzazione continua attiva in tempo reale.";
        }
      }
    }
  }

  function applyFullStateToUI({ preserveActiveSession = false } = {}) {
    applyTheme(state.theme);
    applyReaderScale(state.readerScale);
    applySavedPrefsToControls();
    if (state.lastSecId && SECTION_MAP.has(state.lastSecId)) {
      if (currentView !== "reader" || !preserveActiveSession) readerSecId = state.lastSecId;
    } else if (!preserveActiveSession) {
      readerSecId = STUDYABLE_SECTIONS[0]?.id || ALL_SECTIONS[0]?.id || null;
    }
    renderOverview();
    renderReaderSidebar();
    if (readerSecId && SECTION_MAP.has(readerSecId)) {
      const keepInlineCloze = preserveActiveSession && currentView === "reader" && readerMode === "cloze";
      if (keepInlineCloze) {
        const mSel = document.getElementById("readerMasterySelect");
        if (mSel) { const v = String(state.mastery[readerSecId] || 0); mSel.value = v; mSel.dataset.mastery = v; }
        document.getElementById("btnBookmarkSec")?.setAttribute("aria-pressed", state.bookmarks[readerSecId] ? "true" : "false");
        syncReaderSidebarDots();
      } else {
        renderReaderArticle(readerSecId, { skipHash: true, persistLastSec: false });
      }
    }
    const keepFc = preserveActiveSession && currentView === "practice" && practiceMode === "flashcards" && fcQueue.length > 0;
    if (!keepFc) buildFcQueue(false);
    const keepPCloze = preserveActiveSession && currentView === "practice" && practiceMode === "cloze";
    populatePracticeClozeSecSelect(document.getElementById("clozeDocSelect").value);
    if (!keepPCloze) renderPracticeCloze();
    if (!preserveActiveSession) startQuiz();
    renderBackupSummary();
    updateDueBadges();
  }

  function withCloudTimeout(promise, ms = CLOUD_OP_TIMEOUT_MS, opName = "firestore") {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Timeout ${ms}ms durante ${opName}`);
        err.code = "timeout";
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  function userMirrorKey(uid) {
    return `${STORAGE_KEY}_cloud_${uid}`;
  }

  function writeUserMirror(uid, s = state) {
    if (!uid) return;
    try { localStorage.setItem(userMirrorKey(uid), JSON.stringify(s)); } catch (_) { /* ignore */ }
  }

  function readUserMirror(uid) {
    try {
      const raw = localStorage.getItem(userMirrorKey(uid));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function applyRemoteState(nextState, reason) {
    const prevResetAt = state.resetAt || 0;
    cloudApplyingRemote = true;
    try {
      state = normalizeStateObject(nextState);
      saveState({ skipCloud: true, preserveTimestamp: true, silentLog: true });
      const wasRemoteReset = (state.resetAt || 0) > prevResetAt;
      applyFullStateToUI({ preserveActiveSession: !wasRemoteReset });
      if (reason) diagLog("CLOUD-MERGE", reason, summarizeStateForLog(state));
    } finally {
      cloudApplyingRemote = false;
    }
  }

  function scheduleCloudPush() {
    cloudPendingPush = true;
    if (!fbUser) return;
    if (cloudStatus !== "syncing") {
      cloudStatus = "syncing";
      updateCloudUI();
    }
    const now = Date.now();
    if (!pushDebounceFirstAt) pushDebounceFirstAt = now;
    const wait = Math.max(0, Math.min(PUSH_DEBOUNCE_MS, PUSH_MAX_WAIT_MS - (now - pushDebounceFirstAt)));
    if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
    pushDebounceTimer = setTimeout(() => {
      pushDebounceTimer = null;
      pushStateToCloud({ reason: "debounce" });
    }, wait);
  }

  function scheduleCloudRetry() {
    if (pushRetryTimer || !fbUser) return;
    const delay = Math.min(60000, 1000 * Math.pow(2, pushRetryAttempt));
    pushRetryAttempt++;
    diagLog("CLOUD-PUSH", `Nuovo tentativo programmato tra ${Math.round(delay / 1000)}s`, `tentativo #${pushRetryAttempt}`);
    pushRetryTimer = setTimeout(() => {
      pushRetryTimer = null;
      if (fbUser && cloudPendingPush) pushStateToCloud({ reason: "retry" });
    }, delay);
  }

  /** Pushes the full state to users/{uid}. Single-flight; returns true on server-acknowledged success. */
  async function pushStateToCloud({ immediate = false, reason = "" } = {}) {
    if (!fbUser || !fbDb || !fbModules) return false;
    if (pushDebounceTimer) { clearTimeout(pushDebounceTimer); pushDebounceTimer = null; }
    pushDebounceFirstAt = 0;
    if (pushInFlight) {
      pushQueued = true;
      return pushInFlight;
    }
    pushInFlight = doPushStateToCloud(immediate, reason);
    try {
      return await pushInFlight;
    } finally {
      pushInFlight = null;
      if (pushQueued) {
        pushQueued = false;
        if (cloudPendingPush) scheduleCloudPush();
      }
    }
  }

  async function doPushStateToCloud(immediate, reason) {
    const uid = fbUser.uid;
    if (!navigator.onLine) {
      cloudPendingPush = true;
      cloudStatus = "pending";
      updateCloudUI();
      diagLog("CLOUD-PUSH", "Offline — push in coda fino al ritorno della rete");
      return false;
    }
    cloudStatus = "syncing";
    updateCloudUI();

    const revAtStart = localRev;
    const snapshotState = JSON.parse(JSON.stringify(state));
    const payload = {
      studylab_v1: snapshotState,
      studylab_updatedAt: clampEpochMs(snapshotState.updatedAt || Date.now()),
      uid,
      email: (fbUser.email || "").slice(0, 320),
      displayName: (fbUser.displayName || "").slice(0, 200),
      schema: STATE_SCHEMA,
    };
    const payloadBytes = JSON.stringify(payload).length;
    const ref = fbModules.doc(fbDb, CLOUD_COLLECTION, uid);

    let tokenRefreshed = false;
    for (;;) {
      const t0 = performance.now();
      try {
        await withCloudTimeout(fbModules.setDoc(ref, payload, { merge: true }), CLOUD_OP_TIMEOUT_MS, "setDoc");
        if (fbUser?.uid !== uid) return false;
        const ms = Math.round(performance.now() - t0);
        if (localRev === revAtStart) cloudPendingPush = false;
        cloudLastSyncedAt = Date.now();
        cloudStatus = cloudPendingPush ? "syncing" : "online";
        pushRetryAttempt = 0;
        if (pushRetryTimer) { clearTimeout(pushRetryTimer); pushRetryTimer = null; }
        setCloudNotice("");
        writeUserMirror(uid, snapshotState);
        diagLog("CLOUD-PUSH", `OK -> '${CLOUD_COLLECTION}/${maskUid(uid)}' (${ms}ms, ${payloadBytes}B${reason ? `, ${reason}` : ""})`, summarizeStateForLog(snapshotState));
        updateCloudUI();
        if (immediate) showToast("Sincronizzato nel Cloud ✓");
        return true;
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        const code = err?.code || "err";
        diagLog("CLOUD-PUSH", `WARN '${CLOUD_COLLECTION}/${maskUid(uid)}' (${ms}ms)`, `code=${code} msg=${err?.message || err}`);
        if (code === "permission-denied" && !tokenRefreshed && fbUser?.uid === uid) {
          tokenRefreshed = true;
          try {
            await fbUser.getIdToken(true);
            await new Promise(r => setTimeout(r, 400));
            diagLog("AUTH", "Token ID aggiornato dopo permission-denied — ritento subito");
            continue;
          } catch (_) { /* fall through */ }
        }
        writeUserMirror(uid);
        cloudPendingPush = true;
        if (code === "timeout" || code === "unavailable") {
          cloudStatus = "pending";
          diagLog("CLOUD-PUSH", "Scrittura in coda (rete lenta/offline): verrà completata automaticamente");
        } else {
          cloudStatus = "error";
          if (code === "permission-denied") {
            setCloudNotice("Il Cloud ha rifiutato il salvataggio (permessi). I progressi sono al sicuro su questo dispositivo e verranno ritentati automaticamente.", true);
          }
        }
        updateCloudUI();
        scheduleCloudRetry();
        return false;
      }
    }
  }

  async function pullAndMergeFromCloud(uid, showNotification = false) {
    if (!fbDb || !fbModules || !uid) return;
    cloudStatus = "syncing";
    updateCloudUI();

    const ref = fbModules.doc(fbDb, CLOUD_COLLECTION, uid);
    let serverRemote = null;
    let remoteState = null;
    let tokenRefreshed = false;
    for (;;) {
      const t0 = performance.now();
      try {
        const snap = await withCloudTimeout(fbModules.getDoc(ref), CLOUD_OP_TIMEOUT_MS, "getDoc");
        const ms = Math.round(performance.now() - t0);
        const src = snap.metadata?.fromCache ? "cache locale" : "server";
        if (snap.exists() && snap.data()?.studylab_v1) {
          serverRemote = snap.data().studylab_v1;
          remoteState = serverRemote;
          diagLog("CLOUD-PULL", `Documento Cloud trovato (${ms}ms, ${src})`, summarizeStateForLog(remoteState));
        } else if (snap.exists()) {
          diagLog("CLOUD-PULL", `Documento presente ma senza studylab_v1 (${ms}ms)`);
        } else {
          diagLog("CLOUD-PULL", `Primo accesso (${ms}ms) — il documento verrà creato ora`);
        }
        break;
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        const code = err?.code || "err";
        diagLog("CLOUD-PULL", `WARN lettura (${ms}ms)`, `code=${code} msg=${err?.message || err}`);
        if (code === "permission-denied" && !tokenRefreshed && fbUser?.uid === uid) {
          tokenRefreshed = true;
          try {
            await fbUser.getIdToken(true);
            await new Promise(r => setTimeout(r, 400));
            diagLog("AUTH", "Token ID aggiornato dopo permission-denied — rileggo");
            continue;
          } catch (_) { /* fall through */ }
        }
        break;
      }
    }
    if (fbUser?.uid !== uid) return;

    // Merge per-user local mirror (data saved offline / before last logout)
    const mirror = readUserMirror(uid);
    if (mirror) remoteState = remoteState ? mergeCloudAndLocalState(mirror, remoteState) : mirror;

    if (remoteState) {
      const before = summarizeStateForLog(state);
      const merged = mergeCloudAndLocalState(state, remoteState);
      if (stableStringify(merged) !== stableStringify(state)) {
        applyRemoteState(merged, `Unione locale + Cloud completata — PRIMA=[${before}]`);
      } else {
        diagLog("CLOUD-MERGE", "Locale e Cloud già allineati");
      }
    }

    const needsPush = showNotification || !serverRemote || (stableStringify(state) !== stableStringify(normalizeStateObject(serverRemote)));
    if (needsPush) {
      cloudPendingPush = true;
      await pushStateToCloud({ immediate: showNotification, reason: showNotification ? "manual-sync" : "login-sync" });
    } else {
      cloudPendingPush = false;
      cloudLastSyncedAt = Date.now();
      cloudStatus = "online";
      writeUserMirror(uid, state);
      updateCloudUI();
      diagLog("CLOUD-PULL", "Nessuna scrittura necessaria: Cloud già aggiornato");
    }
    startRealtimeCloudListener(uid);
  }

  function stopRealtimeCloudListener() {
    if (fbLiveRestartTimer) { clearTimeout(fbLiveRestartTimer); fbLiveRestartTimer = null; }
    if (fbUnsubSnapshot) {
      try { fbUnsubSnapshot(); } catch (_) { /* ignore */ }
      fbUnsubSnapshot = null;
    }
    cloudLiveActive = false;
  }

  function startRealtimeCloudListener(uid) {
    stopRealtimeCloudListener();
    if (!fbDb || !fbModules || !uid) return;
    try {
      const ref = fbModules.doc(fbDb, CLOUD_COLLECTION, uid);
      fbUnsubSnapshot = fbModules.onSnapshot(ref, snap => {
        if (fbUser?.uid !== uid) return;
        if (!cloudLiveActive) {
          cloudLiveActive = true;
          diagLog("CLOUD-LIVE", `Listener real-time attivo su '${CLOUD_COLLECTION}/${maskUid(uid)}'`);
        }
        if (snap.metadata?.hasPendingWrites || !snap.exists()) return;
        const remote = snap.data()?.studylab_v1;
        if (!remote) return;
        const merged = mergeCloudAndLocalState(state, remote);
        if (stableStringify(merged) !== stableStringify(state)) {
          applyRemoteState(merged, "Aggiornamento live ricevuto dal Cloud");
          cloudLastSyncedAt = Date.now();
          if (!cloudPendingPush) cloudStatus = "online";
          updateCloudUI();
        }
        // Only push back if the snapshot came from server (not stale local cache) and we have newer local data
        if (!snap.metadata?.fromCache && stableStringify(merged) !== stableStringify(normalizeStateObject(remote))) {
          cloudPendingPush = true;
          scheduleCloudPush();
        }
      }, err => {
        cloudLiveActive = false;
        fbUnsubSnapshot = null;
        const code = err?.code || "err";
        diagLog("CLOUD-LIVE", "Listener interrotto — riavvio tra 5s", `code=${code} msg=${err?.message || err}`);
        updateCloudUI();
        fbLiveRestartTimer = setTimeout(async () => {
          fbLiveRestartTimer = null;
          if (fbUser?.uid !== uid) return;
          if (code === "permission-denied") {
            try { await fbUser.getIdToken(true); } catch (_) { /* ignore */ }
          }
          startRealtimeCloudListener(uid);
        }, 5000);
      });
    } catch (err) {
      diagLog("CLOUD-LIVE", "Impossibile avviare il listener", err?.message || String(err));
    }
  }

  // ---------- Analytics consent (GDPR) ----------
  function getAnalyticsConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
  }

  async function enableAnalyticsIfConsented() {
    if (getAnalyticsConsent() !== "granted" || !fbApp) return;
    try {
      if (!fbAnalyticsMod) {
        fbAnalyticsMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-analytics.js`);
      }
      if (!(await fbAnalyticsMod.isSupported())) return;
      if (!fbAnalytics) {
        fbAnalytics = fbAnalyticsMod.getAnalytics(fbApp);
        diagLog("ANALYTICS", "Google Analytics attivato (consenso dato)", FIREBASE_CONFIG.measurementId);
      } else {
        fbAnalyticsMod.setAnalyticsCollectionEnabled(fbAnalytics, true);
      }
    } catch (err) {
      diagLog("ANALYTICS", "Analytics non disponibile", err?.message || String(err));
    }
  }

  function setAnalyticsConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (_) { /* ignore */ }
    document.getElementById("consentBanner")?.classList.add("hidden");
    diagLog("ANALYTICS", `Consenso statistiche: ${value === "granted" ? "ACCETTATO" : "RIFIUTATO"}`);
    if (value === "granted") {
      enableAnalyticsIfConsented();
    } else if (fbAnalytics && fbAnalyticsMod) {
      try { fbAnalyticsMod.setAnalyticsCollectionEnabled(fbAnalytics, false); } catch (_) { /* ignore */ }
    }
    syncConsentLabel();
  }

  function syncConsentLabel() {
    const lbl = document.getElementById("consentStatusLabel");
    if (!lbl) return;
    const c = getAnalyticsConsent();
    lbl.textContent = c === "granted" ? "Statistiche anonime: attive" : (c === "denied" ? "Statistiche anonime: disattivate" : "Statistiche anonime: non scelto");
  }

  function initConsentBanner() {
    const banner = document.getElementById("consentBanner");
    if (banner && !getAnalyticsConsent()) banner.classList.remove("hidden");
    document.getElementById("btnConsentAccept")?.addEventListener("click", () => setAnalyticsConsent("granted"));
    document.getElementById("btnConsentDeny")?.addEventListener("click", () => setAnalyticsConsent("denied"));
    document.getElementById("btnConsentManage")?.addEventListener("click", () => {
      closeAllModals();
      const b = document.getElementById("consentBanner");
      if (b) {
        b.classList.remove("hidden");
        document.getElementById("btnConsentAccept")?.focus();
      }
    });
    syncConsentLabel();
  }

  // ---------- Account ownership (shared devices) ----------
  function claimLocalStateForUser(user) {
    const prevOwner = state.ownerUid;
    if (prevOwner && prevOwner !== user.uid) {
      writeUserMirror(prevOwner);
      diagLog("ACCOUNT", "Progressi locali appartenenti a un altro account messi da parte", `owner=${maskUid(prevOwner)} → nuovo=${maskUid(user.uid)}`);
      cloudApplyingRemote = true;
      try {
        state = freshStateKeepingPrefs();
      } finally {
        cloudApplyingRemote = false;
      }
      applyFullStateToUI();
      showToast("Progressi dell'altro account separati da questo");
    }
    if (state.ownerUid !== user.uid) {
      state.ownerUid = user.uid;
      saveState({ light: true });
    }
  }

  // ---------- Firebase bootstrap (memoized, safe to call many times) ----------
  function initFirebaseCloud() {
    if (!fbInitPromise) {
      fbInitPromise = doInitFirebaseCloud().then(ok => {
        if (!ok) fbInitPromise = null;
        return ok;
      });
    }
    return fbInitPromise;
  }

  async function doInitFirebaseCloud() {
    const t0 = performance.now();
    diagLog("FIREBASE-INIT", `Caricamento Firebase SDK v${FIREBASE_SDK_VERSION} (projectId=${FIREBASE_CONFIG.projectId})…`);
    try {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
      const [appMod, authMod, fsMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
      ]);

      fbApp = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
      fbAuth = authMod.getAuth(fbApp);
      try {
        fbDb = fsMod.initializeFirestore(fbApp, {
          localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
          experimentalAutoDetectLongPolling: true,
        });
        fbCacheMode = "persistent-indexeddb";
      } catch (_) {
        try {
          fbDb = fsMod.initializeFirestore(fbApp, { experimentalAutoDetectLongPolling: true });
          fbCacheMode = "memory";
        } catch (_) {
          fbDb = fsMod.getFirestore(fbApp);
          fbCacheMode = "default";
        }
      }
      fbModules = { ...authMod, ...fsMod };
      diagLog("FIREBASE-INIT", `SDK inizializzato in ${Math.round(performance.now() - t0)}ms`, `App + Auth + Firestore pronti (cache=${fbCacheMode})`);
      enableAnalyticsIfConsented();

      authMod.getRedirectResult(fbAuth).then(res => {
        if (res?.user) diagLog("AUTH", "Login via Redirect completato", `email=${maskEmail(res.user.email)} uid=${maskUid(res.user.uid)}`);
      }).catch(err => {
        diagLog("AUTH", "Errore getRedirectResult", `code=${err?.code} msg=${err?.message}`);
        if (err?.code === "auth/unauthorized-domain") {
          setCloudNotice(`Dominio non autorizzato in Firebase Auth: aggiungi "${location.hostname}" in Firebase Console → Authentication → Settings → Authorized domains.`, true);
        }
      });

      authMod.onAuthStateChanged(fbAuth, async user => {
        const prevUid = fbUser?.uid || null;
        fbUser = user || null;
        if (fbUser) {
          if (prevUid === fbUser.uid) return; // token refresh, same user
          diagLog("AUTH", "Utente autenticato", `email=${maskEmail(fbUser.email)} uid=${maskUid(fbUser.uid)}`);
          const isGoogleProvider = Array.isArray(fbUser.providerData) && fbUser.providerData.some(p => p?.providerId === "google.com");
          if (fbUser.emailVerified === false && !isGoogleProvider) {
            cloudStatus = "error";
            setCloudNotice("L'indirizzo email del tuo account non risulta verificato: verifica l'email per abilitare il backup Cloud.", true);
            updateCloudUI();
            return;
          }
          claimLocalStateForUser(fbUser);
          cloudStatus = "syncing";
          updateCloudUI();
          await pullAndMergeFromCloud(fbUser.uid, false);
        } else {
          diagLog("AUTH", "Nessun utente Google attivo (modalità locale)");
          stopRealtimeCloudListener();
          if (pushRetryTimer) { clearTimeout(pushRetryTimer); pushRetryTimer = null; }
          if (pushDebounceTimer) { clearTimeout(pushDebounceTimer); pushDebounceTimer = null; }
          cloudStatus = "idle";
          updateCloudUI();
        }
      });

      window.addEventListener("online", () => {
        diagLog("NETWORK", "Connessione tornata ONLINE");
        if (fbUser && cloudPendingPush) pushStateToCloud({ reason: "online" });
        if (fbUser && !fbUnsubSnapshot) startRealtimeCloudListener(fbUser.uid);
      });
      window.addEventListener("offline", () => {
        diagLog("NETWORK", "Dispositivo OFFLINE — salvataggio locale attivo, push Cloud in coda");
        cloudStatus = fbUser ? "pending" : cloudStatus;
        updateCloudUI();
      });
      const flushOnHide = () => {
        if (fbUser && cloudPendingPush) {
          diagLog("LIFECYCLE", "App in background — flush immediato al Cloud");
          writeUserMirror(fbUser.uid);
          pushStateToCloud({ reason: "background" });
        }
      };
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushOnHide(); });
      window.addEventListener("pagehide", flushOnHide);
      return true;
    } catch (err) {
      diagLog("ERROR", "Errore caricamento Firebase SDK", err?.message || String(err));
      return false;
    }
  }

  async function handleGoogleLogin() {
    diagLog("AUTH", "Click 'Accedi con Google'");
    if (!fbAuth || !fbModules) {
      showToast("Connessione a Firebase in corso…");
      const ok = await initFirebaseCloud();
      if (!ok || !fbAuth) {
        setCloudNotice("Impossibile caricare Firebase. Verifica la connessione internet e riprova.", true);
        return;
      }
    }
    setCloudNotice("");
    const provider = new fbModules.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      diagLog("AUTH", "Apertura popup signInWithPopup…");
      const res = await fbModules.signInWithPopup(fbAuth, provider);
      if (res?.user) {
        diagLog("AUTH", "signInWithPopup riuscito", `email=${maskEmail(res.user.email)}`);
        showToast(`Connesso come ${res.user.displayName || res.user.email}`);
      }
    } catch (err) {
      diagLog("AUTH", "WARN signInWithPopup", `code=${err?.code || "err"} msg=${err?.message || err}`);
      if (err?.code === "auth/popup-blocked" || err?.code === "auth/operation-not-supported-in-this-environment") {
        try {
          diagLog("AUTH", "Popup non disponibile — passo a signInWithRedirect…");
          await fbModules.signInWithRedirect(fbAuth, provider);
          return;
        } catch (e2) {
          diagLog("ERROR", "Errore signInWithRedirect", `code=${e2?.code} msg=${e2?.message}`);
          setCloudNotice(`Errore accesso Google: ${e2.message || e2.code}`, true);
        }
      } else if (err?.code === "auth/unauthorized-domain") {
        setCloudNotice(`Dominio "${location.hostname}" da autorizzare in Firebase Console → Authentication → Settings → Authorized domains.`, true);
        openModal("backupModal");
      } else if (err?.code !== "auth/popup-closed-by-user" && err?.code !== "auth/cancelled-popup-request") {
        setCloudNotice(`Accesso Google non riuscito (${err?.code || "errore"}).`, true);
        openModal("backupModal");
      }
    }
  }

  async function handleGoogleLogout() {
    if (!fbAuth || !fbModules || !fbUser) return;
    const uid = fbUser.uid;
    try {
      diagLog("AUTH", "Richiesta disconnessione Google…");
      let flushed = true;
      if (cloudPendingPush) flushed = await pushStateToCloud({ reason: "logout" });
      writeUserMirror(uid);
      stopRealtimeCloudListener();
      await fbModules.signOut(fbAuth);
      // Clear this device's working copy so the next person doesn't see / merge these progress data
      cloudApplyingRemote = true;
      try {
        state = freshStateKeepingPrefs();
        saveState({ light: true });
      } finally {
        cloudApplyingRemote = false;
      }
      cloudPendingPush = false;
      applyFullStateToUI();
      startQuiz();
      diagLog("AUTH", "Disconnessione completata", flushed ? "Cloud allineato" : "Ultime modifiche conservate in copia locale dell'account");
      showToast(flushed ? "Disconnesso · Progressi al sicuro nel Cloud" : "Disconnesso · Progressi salvati, verranno inviati al prossimo accesso");
    } catch (e) {
      diagLog("ERROR", "Errore signOut", e?.message || e);
    }
  }

  // ==================== UTILITIES ====================
  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isSafeAssetSrc(src) {
    return typeof src === "string" && /^assets\/[A-Za-z0-9._\/-]+$/.test(src) && !src.includes("..");
  }

  function norm(s) {
    return String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^€\s*/, "")
      .replace(/(\d)[,.](\d)/g, "$1.$2")
      .replace(/[’'“”".,;:()]/g, m => (m === "." ? "." : ""))
      .replace(/\.(?!\d)/g, "")
      .trim();
  }

  function searchNorm(s) {
    return String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’`´]/g, "'")
      .replace(/[“”]/g, '"');
  }

  function shuffleArray(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function debounce(fn, wait = 120) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, wait);
    };
  }

  function showToast(msg) {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    while (region.children.length >= 3) region.firstElementChild.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    region.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.2s";
      setTimeout(() => el.remove(), 220);
    }, 2200);
  }

  function getEuropeRomeOffsetMinutes(year, month, day, hour, min) {
    try {
      const guessUtc = Date.UTC(year, month - 1, day, hour, min, 0);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Rome",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).formatToParts(new Date(guessUtc));
      const p = {};
      for (const part of parts) p[part.type] = part.value;
      const h = Number(p.hour) === 24 ? 0 : Number(p.hour);
      const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, Number(p.minute), Number(p.second));
      return Math.round((asUtc - guessUtc) / 60000);
    } catch (_) {
      return 60; // fallback CET (+01:00)
    }
  }

  function parseItalianDate(str) {
    const m = String(str || "").match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+\(?~?(\d{1,2})(?::(\d{2}))?\)?)?/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const hasHour = m[4] !== undefined;
    const hour = hasHour ? Number(m[4]) : 23;
    const min = m[5] !== undefined ? Number(m[5]) : (hasHour ? 0 : 59);
    const sec = hasHour ? 0 : 59;
    const offsetMin = getEuropeRomeOffsetMinutes(year, month, day, hour, min);
    const utcMs = Date.UTC(year, month - 1, day, hour, min, sec) - offsetMin * 60000;
    const dt = new Date(utcMs);
    dt._itMonth = month - 1;
    dt._itDay = day;
    return dt;
  }

  function formatCountdown(ms) {
    if (ms <= 0) return "Scaduta";
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d > 0) return `Tra ${d}g ${h}h`;
    if (h > 0) return `Tra ${h}h ${m}m`;
    return `Tra ${Math.max(1, m)} min`;
  }

  function formatShortInterval(days) {
    if (days <= 0) return "Ora";
    return `${days}g`;
  }

  function formatSourceCitation(refId) {
    const sec = SECTION_MAP.get(refId);
    if (!sec) return "Apri norma";
    return `${DOC_SHORT[sec.doc]} ${sec.code}`;
  }

  function formatOperators(str) {
    return String(str)
      .replace(/\s*->\s*/g, "\u00A0→ ")
      .replace(/\s*→\s*/g, "\u00A0→ ")
      .replace(/([≥≤><])\s*(\d)/g, "$1\u00A0$2")
      .replace(/\([^)]{1,28}\)/g, m => m.replace(/ /g, "\u00A0"));
  }

  function formatArrows(str) {
    return String(str || "").replace(/\s*(?:->|→)\s*/g, "\u00A0→ ");
  }

  function highlightQuery(text, query) {
    const raw = String(text ?? "");
    const qNorm = searchNorm(query).trim();
    if (!qNorm) return esc(raw);
    // Map normalized chars back to raw indices so accents/curly quotes highlight accurately without corrupting HTML entities
    const rawChars = Array.from(raw);
    let normStr = "";
    const normToRaw = [];
    for (let i = 0; i < rawChars.length; i++) {
      const n = searchNorm(rawChars[i]);
      for (let k = 0; k < n.length; k++) {
        normStr += n[k];
        normToRaw.push(i);
      }
    }
    let out = "";
    let rawCursor = 0;
    let searchPos = 0;
    while (searchPos <= normStr.length - qNorm.length) {
      const idx = normStr.indexOf(qNorm, searchPos);
      if (idx === -1) break;
      const startRaw = normToRaw[idx];
      const endRaw = normToRaw[idx + qNorm.length - 1] + 1;
      if (startRaw >= rawCursor) {
        out += esc(rawChars.slice(rawCursor, startRaw).join(""));
        out += `<mark class="search-hit">${esc(rawChars.slice(startRaw, endRaw).join(""))}</mark>`;
        rawCursor = endRaw;
      }
      searchPos = idx + qNorm.length;
    }
    out += esc(rawChars.slice(rawCursor).join(""));
    return out;
  }

  function computeNextSM2(prev, quality) {
    let reps = Math.max(0, Math.round(Number(prev?.reps) || 0));
    let interval = Math.max(0, Math.round(Number(prev?.interval) || 0));
    const efIn = Number(prev?.ef);
    let ef = Number.isFinite(efIn) ? Math.max(1.3, efIn) : 2.5;
    if (quality < 3) {
      reps = 0;
      interval = 0;
    } else {
      if (reps === 0) {
        if (quality === 3) interval = 1;
        else if (quality === 4) interval = 3;
        else interval = 6;
      } else if (reps === 1) {
        if (quality === 3) interval = 2;
        else if (quality === 4) interval = 5;
        else interval = 9;
      } else {
        const hard = Math.max(interval + 1, Math.round(interval * 1.2));
        const bene = Math.max(hard + 1, Math.round(interval * ef));
        if (quality === 3) interval = hard;
        else if (quality === 4) interval = bene;
        else interval = Math.max(bene + 2, Math.round(bene * 1.3));
      }
      reps++;
    }
    ef = Math.max(1.3, ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    const now = Date.now();
    return { reps, interval, ef: Number(ef.toFixed(2)), lastReviewedAt: now, nextReview: now + interval * 86400000 };
  }

  // ==================== FOCUS TRAP ====================
  function getFocusable(container) {
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => {
      if (el.closest(".hidden")) return false;
      const st = getComputedStyle(el);
      return st.display !== "none" && st.visibility !== "hidden" && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
    });
  }

  function handleFocusTrap(e) {
    if (e.key !== "Tab" || !activeTrapContainer) return;
    const focusables = getFocusable(activeTrapContainer);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!activeTrapContainer.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ==================== INIT ====================
  async function init() {
    state = loadState();
    const tBoot = performance.now();
    diagLog("BOOT", `Avvio applicazione PoliNetwork Studio ${APP_VERSION}`, `${window.innerWidth}x${window.innerHeight} · theme=${state.theme}`);
    document.body.dataset.view = "overview";
    applyTheme(state.theme);
    applyReaderScale(state.readerScale);
    applySavedPrefsToControls();

    const [corpusRes, packRes] = await Promise.all([
      fetch(`data/corpus.json?v=${APP_VERSION}`),
      fetch(`data/study_pack.json?v=${APP_VERSION}`),
    ]);
    if (!corpusRes.ok) throw new Error(`Impossibile caricare corpus.json (HTTP ${corpusRes.status})`);
    if (!packRes.ok) throw new Error(`Impossibile caricare study_pack.json (HTTP ${packRes.status})`);
    CORPUS = await corpusRes.json();
    PACK = await packRes.json();

    ALL_SECTIONS = [];
    SECTION_MAP.clear();
    for (const doc of CORPUS.documents) {
      for (const s of doc.sections) {
        ALL_SECTIONS.push(s);
        SECTION_MAP.set(s.id, s);
      }
    }
    STUDYABLE_SECTIONS = ALL_SECTIONS.filter(s => s.text && s.text.trim().length > 0);
    CLOZEABLE_SECTIONS = STUDYABLE_SECTIONS.filter(s => s.text.trim().length > 20 && !NON_CLOZE_SECTIONS.has(s.id));

    // Pre-compute normalized search text once for instant accent/apostrophe-insensitive search
    searchIndex = ALL_SECTIONS.map(s => ({
      sec: s,
      codeNorm: searchNorm(s.code),
      titleNorm: searchNorm(s.title),
      textNorm: searchNorm(s.text || ""),
      flatText: s.text ? sanitizeSnippetText(s.text) : "",
    }));
    for (const item of searchIndex) {
      item.flatNorm = searchNorm(item.flatText);
    }

    diagLog("CORPUS", `Corpus e Study Pack caricati (${Math.round(performance.now() - tBoot)}ms)`, `${CORPUS.documents.length} doc · ${ALL_SECTIONS.length} sez (${STUDYABLE_SECTIONS.length} studiabili) · ${PACK.flashcards.length} flashcard · ${PACK.quizzes.length} quiz`);

    readerSecId = (state.lastSecId && SECTION_MAP.has(state.lastSecId))
      ? state.lastSecId
      : (STUDYABLE_SECTIONS[0]?.id || ALL_SECTIONS[0]?.id);
    practiceClozeSecId = CLOZEABLE_SECTIONS[0]?.id || readerSecId;

    // Platform-accurate keyboard shortcut hint (⌘ K on Apple vs Ctrl K elsewhere)
    const isApplePlatform = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    const kbdEl = document.querySelector("#btnSearchQuick .search-pill-kbd");
    if (kbdEl && !isApplePlatform) kbdEl.innerHTML = "<span>Ctrl</span><span>K</span>";

    syncDynamicOptionLabels();
    populateFcTagFilter();
    populatePracticeClozeSecSelect(document.getElementById("clozeDocSelect").value);
    bindAllEvents();

    renderOverview();
    renderReaderSidebar();
    if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true, persistLastSec: false });
    buildFcQueue(false);
    startQuiz();
    renderPracticeCloze();
    syncCsTabs();
    renderReference();

    applyRouteFromHash();
    window.addEventListener("hashchange", applyRouteFromHash);
    setInterval(() => { if (!document.hidden && currentView === "overview") renderDeadlineCard(); }, 60000);
    initConsentBanner();
    updateCloudUI();
    refreshDiagConsoleUI();
    initFirebaseCloud();
  }

  function applySavedPrefsToControls() {
    const p = state.prefs;
    syncNumsToggleUI(p.highlightNums !== false);
    document.getElementById("inlineClozeLevel").value = p.clozeLevel || "1";
    document.getElementById("clozeLevelSelect").value = p.clozeLevel || "1";
    document.getElementById("inlineClozeInput").value = p.clozeInputMode || "click";
    document.getElementById("clozeInputMode").value = p.clozeInputMode || "click";
    document.getElementById("fcDeckMode").value = p.fcDeckMode || "curated";
  }

  function syncNumsToggleUI(on) {
    const btn = document.getElementById("btnToggleNums");
    if (!btn) return;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const lbl = document.getElementById("numsToggleLabel");
    if (lbl) lbl.textContent = on ? "Numeri attivi" : "Numeri spenti";
    else btn.textContent = on ? "Numeri attivi" : "Numeri spenti";
  }

  function syncDynamicOptionLabels() {
    const nCur = PACK.flashcards.length;
    const nArt = CLOZEABLE_SECTIONS.length;
    const deckSel = document.getElementById("fcDeckMode");
    deckSel.options[0].textContent = `Schede chiave (${nCur})`;
    deckSel.options[1].textContent = `Tutti gli articoli (${nArt})`;
    deckSel.options[2].textContent = `Completo (${nCur + nArt})`;

    const nAll = PACK.quizzes.length;
    const nBlitz = PACK.quizzes.filter(q => q.mode === "blitz").length;
    const nMc = PACK.quizzes.filter(q => q.mode === "mc").length;
    const nScen = PACK.quizzes.filter(q => q.mode === "scenario").length;
    const qzSel = document.getElementById("qzModeFilter");
    qzSel.options[0].textContent = `Tutte (${nAll})`;
    qzSel.options[1].textContent = `Blitz Numeri (${nBlitz})`;
    qzSel.options[2].textContent = `Normativa (${nMc})`;
    qzSel.options[3].textContent = `Scenari (${nScen})`;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#000000" : "#f2f2f7");
    const svg = theme === "dark"
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    ["iconTheme", "iconThemeMobile"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = svg;
    });
  }

  function applyReaderScale(scale) {
    state.readerScale = Number(Math.max(0.88, Math.min(1.28, Number(scale) || 1)).toFixed(2));
    document.documentElement.style.setProperty("--reader-scale", state.readerScale);
    const valEl = document.getElementById("fontScaleVal");
    if (valEl) valEl.textContent = `${Math.round(state.readerScale * 100)}%`;
  }

  function closeFontPopover() {
    const pop = document.getElementById("fontPopover");
    const btn = document.getElementById("btnFontCycle");
    if (pop && !pop.classList.contains("hidden")) {
      pop.classList.add("hidden");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
  }

  // ==================== ROUTING & VIEW SYNC ====================
  function syncAllViewsForStateChange(affectedSecId = null) {
    updateDueBadges();
    if (affectedSecId) {
      if (readerStatusFilter !== "all") renderReaderSidebar();
      else syncReaderSidebarDots();
      if (readerSecId === affectedSecId) {
        const sel = document.getElementById("readerMasterySelect");
        if (sel) {
          const v = String(state.mastery[affectedSecId] || 0);
          sel.value = v;
          sel.dataset.mastery = v;
        }
      }
      const sec = SECTION_MAP.get(affectedSecId);
      if (sec && document.getElementById("clozeDocSelect").value === sec.doc) {
        populatePracticeClozeSecSelect(sec.doc);
      }
    }
  }

  function setHash(path) {
    const target = `#${path}`;
    if (location.hash !== target) history.replaceState(null, "", target);
  }

  function switchView(viewName, opts = {}) {
    if (!["overview", "reader", "practice", "reference"].includes(viewName)) viewName = "overview";
    if (currentView === "reader" && viewName !== "reader" && !opts.keepReturn) returnStack = [];
    currentView = viewName;
    document.body.dataset.view = viewName;
    closeFontPopover();

    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`)?.classList.add("active");

    document.querySelectorAll("#desktopNav .nav-tab, #mobileNav .fnav-btn").forEach(btn => {
      const act = btn.dataset.view === viewName;
      btn.classList.toggle("active", act);
      if (act) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });

    if (viewName === "overview") renderOverview();
    else if (viewName === "reader") syncReaderSidebarDots();
    else if (viewName === "practice") populatePracticeClozeSecSelect(document.getElementById("clozeDocSelect").value);

    if (!opts.skipHash) {
      if (viewName === "reader" && readerSecId) setHash(`reader/${readerSecId}${readerMode === "cloze" ? "/cloze" : ""}`);
      else if (viewName === "practice") setHash(`practice/${practiceMode}${practiceMode === "cloze" && practiceClozeSecId ? `/${practiceClozeSecId}` : ""}`);
      else if (viewName === "reference") setHash(`reference/${csTab}`);
      else setHash("overview");
    }
    if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
  }

  function switchPracticeMode(mode, opts = {}) {
    if (!["flashcards", "quiz", "cloze"].includes(mode)) mode = "flashcards";
    practiceMode = mode;
    document.querySelectorAll("#practiceModeSwitch .ios-seg-btn").forEach(b => {
      const act = b.dataset.pmode === mode;
      b.classList.toggle("active", act);
      b.setAttribute("aria-selected", act ? "true" : "false");
      b.tabIndex = act ? 0 : -1;
    });
    ["flashcards", "quiz", "cloze"].forEach(m => {
      document.getElementById(`pane-${m}`).classList.toggle("hidden", m !== mode);
    });
    if (mode === "cloze") populatePracticeClozeSecSelect(document.getElementById("clozeDocSelect").value);
    if (!opts.skipHash && currentView === "practice") {
      setHash(`practice/${practiceMode}${practiceMode === "cloze" && practiceClozeSecId ? `/${practiceClozeSecId}` : ""}`);
    }
    if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
  }

  function applyRouteFromHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) {
      if (currentView !== "overview") switchView("overview", { skipHash: true });
      return;
    }
    const [head, p1, p2] = raw.split("/");
    if (head === "overview" || head === "dashboard") {
      switchView("overview", { skipHash: true });
    } else if (head === "reader") {
      if (p1 && SECTION_MAP.has(p1)) openArticle(p1, { mode: p2 === "cloze" ? "cloze" : "read", skipHash: true });
      else switchView("reader", { skipHash: true });
    } else if (head === "practice") {
      switchPracticeMode(p1 || "flashcards", { skipHash: true });
      if (p1 === "cloze" && p2 && CLOZEABLE_SECTIONS.some(s => s.id === p2)) {
        openPracticeClozeArticle(p2, { skipHash: true });
      } else {
        switchView("practice", { skipHash: true });
      }
    } else if (head === "reference" || head === "cheatsheet") {
      if (p1 && VALID_CS_TABS.has(p1)) {
        csTab = p1;
        syncCsTabs();
        renderReference();
      }
      switchView("reference", { skipHash: true });
    } else if (head === "cloze") {
      if (p1 && SECTION_MAP.has(p1)) openArticle(p1, { mode: "cloze", skipHash: true });
      else { switchPracticeMode("cloze", { skipHash: true }); switchView("practice", { skipHash: true }); }
    } else if (head === "flashcards" || head === "quiz") {
      switchPracticeMode(head, { skipHash: true });
      switchView("practice", { skipHash: true });
    }
  }

  function openArticle(secId, opts = {}) {
    if (!SECTION_MAP.has(secId)) return;
    if (opts.returnTo) returnStack.push(opts.returnTo);
    else if (!opts.keepReturn) returnStack = [];

    if (readerDocFilter !== "all" && SECTION_MAP.get(secId).doc !== readerDocFilter) {
      readerDocFilter = "all";
      syncReaderDocPills();
    }
    if (readerStatusFilter !== "all") {
      readerStatusFilter = "all";
      document.getElementById("readerStatusFilter").value = "all";
    }
    const searchInp = document.getElementById("readerSearch");
    if (searchInp.value) searchInp.value = "";

    readerMode = opts.mode === "cloze" && CLOZEABLE_SECTIONS.some(s => s.id === secId) ? "cloze" : "read";
    renderReaderSidebar();
    renderReaderArticle(secId, opts);
    switchView("reader", opts);
  }

  function openPracticeClozeArticle(secId, opts = {}) {
    const sec = SECTION_MAP.get(secId);
    if (!sec || !CLOZEABLE_SECTIONS.some(s => s.id === secId)) {
      showToast("Seleziona un articolo normativo.");
      return;
    }
    practiceClozeSecId = secId;
    document.getElementById("clozeDocSelect").value = sec.doc;
    populatePracticeClozeSecSelect(sec.doc);
    document.getElementById("clozeSecSelect").value = secId;
    renderPracticeCloze();
    switchPracticeMode("cloze", opts);
    switchView("practice", opts);
  }

  // ==================== 1. STUDIO (HOME) ====================
  function getTrulyDueReviewedCards() {
    const now = Date.now();
    const allCards = getDeckCards("combined");
    return allCards.filter(c => state.sm2[c.id] && now >= state.sm2[c.id].nextReview);
  }

  function countTrulyDueReviewed() {
    return getTrulyDueReviewedCards().length;
  }

  function updateDueBadges() {
    const dueReviewed = countTrulyDueReviewed();
    const navB = document.getElementById("navDueBadge");
    if (navB) {
      navB.textContent = dueReviewed;
      navB.classList.toggle("hidden", dueReviewed === 0);
    }
    const mb = document.getElementById("mobileDueBadge");
    if (mb) mb.classList.toggle("hidden", dueReviewed === 0);
    return dueReviewed;
  }

  function renderDeadlineCard() {
    const now = Date.now();
    const list = PACK.cheatsheet.timeline2026;
    let nextItem = null;
    for (const item of list) {
      const dt = parseItalianDate(item.date);
      if (dt && dt.getTime() > now) {
        nextItem = { ...item, dt };
        break;
      }
    }
    const monthEl = document.getElementById("calMonth");
    const dayEl = document.getElementById("calDay");
    const titleEl = document.getElementById("deadlineText");
    const cdEl = document.getElementById("deadlineCountdown");
    const footRow = document.getElementById("deadlineFootRow");
    const artBtn = document.getElementById("btnDeadlineArticle");
    const artLbl = document.getElementById("deadlineArticleLabel");

    if (nextItem) {
      const mIdx = typeof nextItem.dt._itMonth === "number" ? nextItem.dt._itMonth : nextItem.dt.getMonth();
      const dNum = typeof nextItem.dt._itDay === "number" ? nextItem.dt._itDay : nextItem.dt.getDate();
      monthEl.textContent = MONTHS_IT[mIdx] || "NOV";
      dayEl.textContent = String(dNum);
      titleEl.textContent = nextItem.event;
      cdEl.textContent = formatCountdown(nextItem.dt.getTime() - now);
      if (nextItem.ref && SECTION_MAP.has(nextItem.ref)) {
        footRow.classList.remove("hidden");
        artLbl.textContent = `Norma · ${formatSourceCitation(nextItem.ref).replace(/Art\.\s+/, "Art.\u00A0")}`;
        artBtn.onclick = () => openArticle(nextItem.ref, {
          returnTo: { type: "overview", label: "Studio", reason: "Scadenza elettorale" },
        });
      } else {
        footRow.classList.add("hidden");
      }
    } else {
      monthEl.textContent = "NOV";
      dayEl.textContent = "21";
      titleEl.textContent = "Elezioni Direttivo 2026";
      cdEl.textContent = "Programma completo";
      footRow.classList.add("hidden");
    }
  }

  function renderOverview() {
    let scoreSum = 0, nLearned = 0, nMem = 0;
    let firstWipSec = null;
    for (const s of STUDYABLE_SECTIONS) {
      const m = state.mastery[s.id] || 0;
      scoreSum += m;
      if (m === 1 && !firstWipSec) firstWipSec = s;
      if (m === 2) nLearned++;
      if (m === 3) nMem++;
    }
    const pct = Math.round((scoreSum / (STUDYABLE_SECTIONS.length * 3 || 1)) * 100);
    const dueCards = getTrulyDueReviewedCards();
    const dueReviewed = updateDueBadges();
    const validQuizIds = new Set(PACK.quizzes.map(q => q.id));
    const qzMast = Object.keys(state.quizMastered).filter(k => state.quizMastered[k] && validQuizIds.has(k)).length;
    const bmCount = Object.keys(state.bookmarks).filter(k => state.bookmarks[k] && SECTION_MAP.has(k)).length;

    document.getElementById("overallPct").textContent = `${pct}%`;
    document.getElementById("overallProgressRingWrap")?.setAttribute("aria-valuenow", String(pct));
    const circ = 2 * Math.PI * 23;
    const ringEl = document.getElementById("overallRing");
    ringEl.style.strokeDashoffset = circ * (1 - pct / 100);
    ringEl.style.opacity = pct === 0 ? "0" : "1";

    const focusSec = firstWipSec || SECTION_MAP.get(readerSecId) || STUDYABLE_SECTIONS[0];
    const words = focusSec?.text ? focusSec.text.trim().split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(1, Math.ceil(words / 180));

    const kickerEl = document.getElementById("nextBestKicker");
    const titleEl = document.getElementById("nextBestTitle");
    const subEl = document.getElementById("nextBestSub");
    const nextBtn = document.getElementById("btnNextBestAction");
    const nextLbl = document.getElementById("nextBestLabel");

    if (dueReviewed > 0) {
      kickerEl.textContent = "Ripasso di oggi";
      titleEl.textContent = dueReviewed === 1 ? "1 flashcard pronta" : `${dueReviewed} flashcard pronte`;
      subEl.textContent = "Ripetizione dilazionata SM-2";
      nextLbl.textContent = "Avvia ripasso";
      nextBtn.onclick = () => {
        document.getElementById("fcDocFilter").value = "all";
        document.getElementById("fcTagFilter").value = "all";
        document.getElementById("fcOnlyDue").checked = true;
        buildFcQueue(false, dueCards, "Ripasso di oggi");
        switchPracticeMode("flashcards");
        switchView("practice");
      };
    } else if (firstWipSec) {
      kickerEl.textContent = "Continua da qui";
      titleEl.textContent = `${firstWipSec.code.replace(/\s+/g, "\u00A0")} ·\u00A0${firstWipSec.title}`;
      subEl.textContent = `${DOC_SHORT[firstWipSec.doc]} · ${mins} min`;
      nextLbl.textContent = "Riprendi lettura";
      nextBtn.onclick = () => openArticle(firstWipSec.id);
    } else if (focusSec) {
      kickerEl.textContent = "Prossimo passo";
      titleEl.textContent = `${focusSec.code.replace(/\s+/g, "\u00A0")} ·\u00A0${focusSec.title}`;
      subEl.textContent = `${DOC_SHORT[focusSec.doc]} · ${mins} min`;
      nextLbl.textContent = state.lastSecId ? "Riprendi lettura" : "Inizia lettura";
      nextBtn.onclick = () => openArticle(focusSec.id);
    }

    document.getElementById("statSections").textContent = `${nLearned + nMem} / ${STUDYABLE_SECTIONS.length}`;
    document.getElementById("statQuizMastered").textContent = `${qzMast} / ${PACK.quizzes.length}`;
    document.getElementById("statBookmarks").textContent = bmCount;

    renderDeadlineCard();

    const docIcons = {
      statuto: { cls: "blue", svg: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', subExtra: "" },
      rri: { cls: "indigo", svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>', subExtra: "" },
      elettorale: { cls: "green", svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>', subExtra: " · Schemi STV" },
    };

    const listEl = document.getElementById("docList");
    listEl.innerHTML = "";
    for (const doc of CORPUS.documents) {
      const secs = doc.sections.filter(s => s.text && s.text.trim().length > 0);
      const dScore = secs.reduce((acc, s) => acc + (state.mastery[s.id] || 0), 0);
      const dPct = Math.round((dScore / (secs.length * 3 || 1)) * 100);
      const ic = docIcons[doc.id] || docIcons.statuto;
      const unit = doc.id === "statuto" ? "articoli" : "sezioni";

      const row = document.createElement("button");
      row.type = "button";
      row.className = "doc-item";
      row.innerHTML = `
        <span class="doc-sq ${ic.cls}" aria-hidden="true"><svg class="ic sm" viewBox="0 0 24 24">${ic.svg}</svg></span>
        <span class="doc-info">
          <span class="doc-name">${esc(DOC_CLEAN[doc.id] || doc.title)}</span>
          <span class="doc-sub">${secs.length} ${unit}${ic.subExtra}</span>
        </span>
        <span class="doc-right">
          ${dPct > 0 ? `<span class="doc-pct">${dPct}%</span>` : ""}
          <svg class="ic chev-right" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      `;
      row.addEventListener("click", () => {
        readerDocFilter = doc.id;
        readerStatusFilter = "all";
        document.getElementById("readerStatusFilter").value = "all";
        syncReaderDocPills();
        const first = ALL_SECTIONS.find(s => s.doc === doc.id && s.text?.trim()) || ALL_SECTIONS.find(s => s.doc === doc.id);
        if (first) openArticle(first.id, { mode: "read" });
      });
      listEl.appendChild(row);
    }
  }

  // ==================== 2. NORME (READER + INLINE CLOZE) ====================
  function syncReaderDocPills() {
    document.querySelectorAll("#readerDocPills .ios-seg-btn").forEach(b => {
      const act = b.dataset.doc === readerDocFilter;
      b.classList.toggle("active", act);
      b.setAttribute("aria-pressed", act ? "true" : "false");
    });
  }

  function syncReaderModeTabs() {
    const canCloze = CLOZEABLE_SECTIONS.some(s => s.id === readerSecId);
    const clozeTab = document.getElementById("tabInlineCloze");
    clozeTab.disabled = !canCloze;
    if (!canCloze) readerMode = "read";

    document.querySelectorAll("#readerModeSwitch .ios-seg-btn").forEach(b => {
      const act = b.dataset.rmode === readerMode;
      b.classList.toggle("active", act);
      b.setAttribute("aria-selected", act ? "true" : "false");
      b.tabIndex = act ? 0 : -1;
    });
    document.getElementById("readerReadPane").classList.toggle("hidden", readerMode !== "read");
    document.getElementById("readerClozePane").classList.toggle("hidden", readerMode !== "cloze");
    document.getElementById("btnToggleNums").classList.toggle("hidden", readerMode !== "read");
    document.getElementById("btnSwitchInlineCloze").textContent =
      readerMode === "read" ? "Allenati in Cloze" : "Torna alla lettura";
  }

  function getFilteredReaderSections() {
    const q = searchNorm(document.getElementById("readerSearch").value || "").trim();
    return searchIndex.filter(entry => {
      const s = entry.sec;
      if (readerDocFilter !== "all" && s.doc !== readerDocFilter) return false;
      const m = state.mastery[s.id] || 0;
      if (readerStatusFilter === "bookmarked" && !state.bookmarks[s.id]) return false;
      if (readerStatusFilter === "unstudied" && (!s.text || m !== 0)) return false;
      if (readerStatusFilter === "inprogress" && m !== 1) return false;
      if (readerStatusFilter === "memorized" && m !== 3) return false;
      if (!q) return true;
      return entry.codeNorm.includes(q) || entry.titleNorm.includes(q) || entry.textNorm.includes(q);
    }).map(e => e.sec);
  }

  function updateReaderPager(secId = readerSecId) {
    if (!secId) return;
    const filteredStudyable = getFilteredReaderSections().filter(s => s.text && s.text.trim().length > 0);
    const pool = filteredStudyable.some(s => s.id === secId) ? filteredStudyable : STUDYABLE_SECTIONS;
    const idx = pool.findIndex(s => s.id === secId);
    let prev = null, next = null;
    if (idx >= 0) {
      prev = idx > 0 ? pool[idx - 1] : null;
      next = idx < pool.length - 1 ? pool[idx + 1] : null;
    } else {
      const allIdx = ALL_SECTIONS.findIndex(s => s.id === secId);
      for (let i = allIdx - 1; i >= 0; i--) if (ALL_SECTIONS[i].text?.trim()) { prev = ALL_SECTIONS[i]; break; }
      for (let i = allIdx + 1; i < ALL_SECTIONS.length; i++) if (ALL_SECTIONS[i].text?.trim()) { next = ALL_SECTIONS[i]; break; }
    }
    const btnPrev = document.getElementById("btnPrevSec");
    const btnNext = document.getElementById("btnNextSec");
    btnPrev.disabled = !prev;
    btnNext.disabled = !next;
    btnPrev.dataset.target = prev ? prev.id : "";
    btnNext.dataset.target = next ? next.id : "";
    document.getElementById("prevSecTitle").textContent = prev ? `${prev.code} · ${prev.title}` : "Inizio";
    document.getElementById("nextSecTitle").textContent = next ? `${next.code} · ${next.title}` : "Fine";
  }

  function renderReaderSidebar() {
    const list = document.getElementById("readerTocList");
    const secs = getFilteredReaderSections();
    const studyableCount = secs.filter(s => s.text && s.text.trim().length > 0).length;
    document.getElementById("readerMatchCount").textContent = `${studyableCount} sez.`;
    list.innerHTML = "";

    if (!secs.length) {
      list.innerHTML = `<p class="muted small" style="padding:1rem;">Nessun articolo trovato.</p>`;
      return;
    }

    const showDocHeaders = readerDocFilter === "all";
    const docStudyCounts = {};
    if (showDocHeaders) {
      for (const s of secs) {
        if (s.text && s.text.trim().length > 0) docStudyCounts[s.doc] = (docStudyCounts[s.doc] || 0) + 1;
      }
    }

    const frag = document.createDocumentFragment();
    let lastDoc = null;
    for (const s of secs) {
      if (showDocHeaders && s.doc !== lastDoc) {
        lastDoc = s.doc;
        const hdr = document.createElement("div");
        hdr.className = "toc-doc-header";
        hdr.setAttribute("role", "presentation");
        hdr.innerHTML = `<span>${esc(DOC_CLEAN[s.doc] || s.doc)}</span><span>${docStudyCounts[s.doc] || 0}</span>`;
        frag.appendChild(hdr);
      }
      const m = state.mastery[s.id] || 0;
      const isContainer = !s.text || !s.text.trim();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.secId = s.id;
      btn.className = `toc-item lvl-${s.level} ${isContainer ? "is-group" : ""} ${s.id === readerSecId ? "active" : ""}`;
      btn.innerHTML = `
        <span class="toc-dot ${isContainer ? "" : `s${m}`}" aria-hidden="true"></span>
        <span class="toc-code">${esc(s.num || s.code)}</span>
        <span class="toc-title" title="${esc(s.title)}">${esc(s.title)}</span>
        ${state.bookmarks[s.id] ? '<span class="toc-star" aria-label="Salvato">★</span>' : ""}
      `;
      btn.addEventListener("click", () => {
        returnStack = [];
        renderReaderArticle(s.id);
        closeTocDrawer();
      });
      frag.appendChild(btn);
    }
    list.appendChild(frag);
  }

  function syncReaderSidebarDots() {
    const list = document.getElementById("readerTocList");
    list.querySelectorAll(".toc-item").forEach(el => {
      const id = el.dataset.secId;
      const sec = SECTION_MAP.get(id);
      const isTarget = id === readerSecId;
      el.classList.toggle("active", isTarget);
      if (sec?.text?.trim()) {
        const dot = el.querySelector(".toc-dot");
        if (dot) dot.className = `toc-dot s${state.mastery[id] || 0}`;
      }
      const isBm = !!state.bookmarks[id];
      let star = el.querySelector(".toc-star");
      if (isBm && !star) {
        star = document.createElement("span");
        star.className = "toc-star";
        star.setAttribute("aria-label", "Salvato");
        star.textContent = "★";
        el.appendChild(star);
      } else if (!isBm && star) {
        star.remove();
      }
      if (isTarget && currentView === "reader") el.scrollIntoView({ block: "nearest" });
    });
  }

  function openTocDrawer() {
    lastFocusedEl = document.activeElement;
    const sidebar = document.getElementById("readerSidebar");
    sidebar.classList.add("open");
    document.getElementById("tocBackdrop").classList.remove("hidden");
    document.getElementById("btnOpenTocDrawer").setAttribute("aria-expanded", "true");
    document.body.classList.add("modal-open");
    activeTrapContainer = sidebar;
    document.getElementById("readerSearch").focus();
  }

  function closeTocDrawer() {
    const sidebar = document.getElementById("readerSidebar");
    if (!sidebar.classList.contains("open")) return;
    sidebar.classList.remove("open");
    document.getElementById("tocBackdrop").classList.add("hidden");
    document.getElementById("btnOpenTocDrawer").setAttribute("aria-expanded", "false");
    document.body.classList.remove("modal-open");
    if (activeTrapContainer === sidebar) activeTrapContainer = null;
    if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
      lastFocusedEl.focus();
      lastFocusedEl = null;
    }
  }

  function formatLegalText(rawText, currentDoc) {
    let html = esc(rawText);
    if (state.prefs.highlightNums !== false) {
      // Avoid lookbehind for Safari < 16.4 compatibility; capture optional leading separator instead
      const numPattern = /(^|[^\p{L}\p{N}])(\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}:\d{2}|€\s?\d+(?:,\d{2})?|\d+(?:,\d+)?\s*(?:giorni|giorno|ore|ora|mesi|mese|anni|anno|minuti|minuto|settimane|settimana|crediti|credito|ammonizioni|deleghe|seggi|membri|persone|candidati|semestri|semestre|volte)|maggioranza assoluta|maggioranza semplice|unanimità|tre quarti|due terzi|un terzo|un sesto|metà più uno|⅔|½|⅙|⅓|¼|¾|3\/4|2\/3|1\/3|1\/2|(?:trenta|novanta|sette|dieci|quindici|ventiquattro|quarantotto|cinque|sei|nove|dodici|quattro|tre|due)\s+(?:giorni|ore|mesi|anni|minuti|settimane|ammonizioni|deleghe|crediti))(?![\p{L}\p{N}])/giu;
      html = html.replace(numPattern, '$1<span class="num-hl">$2</span>');
    }

    html = html.replace(/\b(articolo|art\.)\s+(A\.\d+(?:\.\d+)?)\b/gi, (m, _p1, code) => {
      const id = `el-${code.toLowerCase().replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${esc(id)}">${m}</button>` : m;
    });
    html = html.replace(/\b(articolo|art\.)\s+(\d{1,2})(?:\.\d+)?\b(?=[^.;]{0,45}\b(?:dello Statuto|del presente Statuto)\b)/gi, (m, _p1, num) => {
      const id = `statuto-art-${num}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${esc(id)}">${m}</button>` : m;
    });
    html = html.replace(/\b(articolo|art\.)\s+(\d+\.\d+(?:\.\d+)*)\b(?![^<]*<\/button>)/gi, (m, _p1, code) => {
      const id = `rri-${code.replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${esc(id)}">${m}</button>` : m;
    });
    if (currentDoc === "statuto") {
      // Only link internal Statuto articles; explicitly exclude external Italian/EU law citations (D.Lgs., Codice, GDPR)
      html = html.replace(/\b(articolo|art\.)\s+(\d{1,2})\b(?![^<]*<\/button>)(?![^.;]{0,75}\b(?:D\.\s?Lgs|Decreto\s+Legislativo|Codice\s+Civile|c\.c\.|GDPR|Regolamento\s+UE)\b)/gi, (m, _p1, num) => {
        const id = `statuto-art-${num}`;
        return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${esc(id)}">${m}</button>` : m;
      });
    }
    return html;
  }

  function buildBreadcrumb(sec) {
    const parts = [DOC_SHORT[sec.doc] || sec.doc];
    const chain = [];
    const visited = new Set([sec.id]);
    let pId = sec.parent;
    while (pId && SECTION_MAP.has(pId) && !visited.has(pId)) {
      visited.add(pId);
      const p = SECTION_MAP.get(pId);
      chain.unshift(`${p.code} ${p.title}`);
      pId = p.parent;
    }
    chain.push(`${sec.code} · ${sec.title}`);
    return [...parts, ...chain].join(" › ");
  }

  function renderReaderArticle(secId, opts = {}) {
    const sec = SECTION_MAP.get(secId);
    if (!sec) return;
    readerSecId = secId;
    if (opts.persistLastSec !== false && state.lastSecId !== secId) {
      state.lastSecId = secId;
      saveState({ light: true });
    }

    syncReaderSidebarDots();
    syncReaderModeTabs();
    if (!opts.skipHash && currentView === "reader") {
      setHash(`reader/${secId}${readerMode === "cloze" ? "/cloze" : ""}`);
    }

    const retBar = document.getElementById("returnBanner");
    if (returnStack.length > 0) {
      const top = returnStack[returnStack.length - 1];
      document.getElementById("returnReason").textContent = top.reason;
      document.getElementById("returnLabel").textContent = top.label;
      retBar.classList.remove("hidden");
    } else {
      retBar.classList.add("hidden");
    }

    document.getElementById("readerBreadcrumb").textContent = buildBreadcrumb(sec);
    document.getElementById("readerArtKicker").textContent = `${DOC_SHORT[sec.doc]} · ${sec.code}`;

    const words = sec.text ? sec.text.trim().split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(1, Math.ceil(words / 180));
    document.getElementById("readerReadTime").textContent = words ? `· Pag. ${sec.page} · ${mins} min` : `· Pag. ${sec.page}`;
    document.getElementById("readerArtTitle").textContent = sec.title;

    document.getElementById("btnBookmarkSec").setAttribute("aria-pressed", state.bookmarks[sec.id] ? "true" : "false");

    const isStudyable = !!(sec.text && sec.text.trim().length > 0);
    document.getElementById("readerMasteryWrap").classList.toggle("hidden", !isStudyable);
    const mSel = document.getElementById("readerMasterySelect");
    const mVal = String(state.mastery[sec.id] || 0);
    mSel.value = mVal;
    mSel.dataset.mastery = mVal;

    const bodyEl = document.getElementById("readerArtBody");
    bodyEl.innerHTML = "";
    if (!isStudyable) {
      const children = ALL_SECTIONS.filter(s => s.parent === sec.id);
      for (const ch of children) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "prose-child-link";
        btn.innerHTML = `<span><strong>${esc(ch.code)}</strong> · ${esc(ch.title)}</span><svg class="ic chev-right" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`;
        btn.addEventListener("click", () => renderReaderArticle(ch.id));
        bodyEl.appendChild(btn);
      }
    } else if (sec.id === "el-b-1") {
      const pre = document.createElement("div");
      pre.className = "prose-block code-block";
      pre.textContent = sec.text;
      bodyEl.appendChild(pre);
    } else {
      let currentSublist = null;
      for (const blk of sec.blocks) {
        const div = document.createElement("div");
        div.className = `prose-block ${blk.type}`;
        div.innerHTML = formatLegalText(blk.text, sec.doc);
        if (blk.type === "subitem") {
          if (!currentSublist) {
            currentSublist = document.createElement("div");
            currentSublist.className = "prose-sublist";
            bodyEl.appendChild(currentSublist);
          }
          currentSublist.appendChild(div);
        } else {
          currentSublist = null;
          bodyEl.appendChild(div);
        }
      }
    }

    bodyEl.querySelectorAll(".xref-link").forEach(btn => {
      btn.addEventListener("click", () => {
        openArticle(btn.dataset.jump, {
          returnTo: { type: "article", target: sec.id, label: `${sec.code} (${DOC_SHORT[sec.doc]})`, reason: "Rimando" },
        });
      });
    });

    const imgWrap = document.getElementById("readerArtImages");
    imgWrap.innerHTML = "";
    const safeImgs = (sec.images || []).filter(isSafeAssetSrc);
    if (safeImgs.length) {
      const gallery = safeImgs.map(src => ({ src, cap: `${sec.code} — ${sec.title}` }));
      safeImgs.forEach((src, i) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "pdf-card";
        card.innerHTML = `<img src="${esc(src)}" alt="Schema PDF ${esc(sec.code)}" loading="lazy" /><span class="pdf-card-cap">Apri schema · ${esc(src.split("/").pop())}</span>`;
        card.addEventListener("click", () => openLightbox(gallery, i));
        imgWrap.appendChild(card);
      });
    }

    if (readerMode === "cloze" && CLOZEABLE_SECTIONS.some(s => s.id === sec.id)) {
      renderInlineCloze();
    }

    const canCloze = CLOZEABLE_SECTIONS.some(s => s.id === sec.id);
    const relFcs = PACK.flashcards.filter(c => c.ref === sec.id);
    const relQzs = PACK.quizzes.filter(q => q.ref === sec.id);
    document.getElementById("articleConnections").classList.toggle("hidden", !canCloze && !relFcs.length && !relQzs.length);
    document.getElementById("btnSwitchInlineCloze").classList.toggle("hidden", !canCloze);
    document.getElementById("btnArticleFlashcards").classList.toggle("hidden", relFcs.length === 0);
    document.getElementById("artFcCount").textContent = relFcs.length;
    document.getElementById("btnArticleQuiz").classList.toggle("hidden", relQzs.length === 0);
    document.getElementById("artQzCount").textContent = relQzs.length;

    updateReaderPager(secId);
  }

  // ==================== CLOZE ENGINE ====================
  function shouldBlankToken(word, level, idx) {
    const clean = word.replace(/^[^\p{L}\p{N}€]+|[^\p{L}\p{N}%]+$/gu, "");
    if (!clean) return false;
    const low = clean.toLowerCase();
    const isKey =
      /\d/.test(clean) ||
      /^(trenta|novanta|sette|dieci|quindici|ventiquattro|quarantotto|cinque|sei|nove|dodici|quattro|tre|due|primo|seconda|terza|unanimità|assoluta|semplice|segreto|palese|decano|probiviri|direttivo|assemblea|presidente|vicepresidente|segretario|tesoriere|droop|delega|deleghe|ricorso|ricorsi|quorum|scadenza|proroga|incompatibili|decadenza|espulsione|ammonizioni)$/i.test(clean);

    if (level === 1) return isKey;
    if (level === 2) return isKey || (clean.length >= 5 && !STOPWORDS.has(low) && idx % 3 === 0);
    if (level === 3) return isKey || (clean.length >= 3 && !STOPWORDS.has(low) && idx % 3 !== 1);
    if (level === 4) return clean.length >= 2;
    return false;
  }

  function syncClozeLevelControls(levelStr) {
    state.prefs.clozeLevel = levelStr;
    const inlineSel = document.getElementById("inlineClozeLevel");
    const pracSel = document.getElementById("clozeLevelSelect");
    if (inlineSel) inlineSel.value = levelStr;
    if (pracSel) pracSel.value = levelStr;
  }

  function renderClozeInto({ secId, levelSel, modeSel, bodyEl, counterEl, barEl, barRevEl, noticeEl, hintBtn, revealBtn, resetBtn, onRestart }) {
    const sec = SECTION_MAP.get(secId);
    if (!sec) return { hintOne: () => {}, revealAll: () => {} };
    const level = Number(levelSel.value) || 1;
    const mode = modeSel.value;
    const triggerRestart = () => {
      if (typeof onRestart === "function") onRestart();
      else renderClozeInto({ secId, levelSel, modeSel, bodyEl, counterEl, barEl, barRevEl, noticeEl, hintBtn, revealBtn, resetBtn, onRestart });
    };

    bodyEl.innerHTML = "";
    noticeEl.classList.add("hidden");
    noticeEl.classList.remove("ok");

    const items = [];
    let recalled = 0;
    let revealed = 0;
    let tokenIndex = 0;

    const focusNextFrom = idx => {
      for (let i = idx + 1; i < items.length; i++) {
        if (!items[i].done && items[i].inputEl) { items[i].inputEl.focus(); return; }
      }
      for (let i = 0; i < idx; i++) {
        if (!items[i].done && items[i].inputEl) { items[i].inputEl.focus(); return; }
      }
    };

    const updateProgress = () => {
      const total = items.length;
      const done = recalled + revealed;
      if (mode === "type") {
        const revWord = revealed === 1 ? "rivelata" : "rivelate";
        counterEl.textContent = revealed > 0 ? `${recalled}/${total} · ${revealed} ${revWord}` : `${recalled} / ${total}`;
      } else {
        counterEl.textContent = revealed > 0 ? `${recalled}/${total} · ${revealed} mostrate` : `${recalled} / ${total}`;
      }
      barEl.style.width = `${(total > 0 ? (recalled / total) * 100 : 0).toFixed(2)}%`;
      if (barRevEl) barRevEl.style.width = `${(total > 0 ? (revealed / total) * 100 : 0).toFixed(2)}%`;
      if (resetBtn) resetBtn.disabled = done === 0;
      if (hintBtn) hintBtn.disabled = done >= total;
      if (revealBtn) revealBtn.disabled = done >= total;

      if (total > 0 && done >= total) {
        const recallPct = Math.round((recalled / total) * 100);
        if (recalled === 0) {
          noticeEl.classList.remove("ok", "hidden");
          noticeEl.innerHTML = `
            <span><strong>Testo mostrato.</strong> Ricomincia per provarlo senza aiuti.</span>
            <div class="notice-actions"><button type="button" class="btn-apple soft sm" data-clz-retry>Ricomincia</button></div>
          `;
          noticeEl.querySelector("[data-clz-retry]").addEventListener("click", triggerRestart);
        } else {
          if ((state.mastery[secId] || 0) === 0 && recallPct >= 50) {
            state.mastery[secId] = 1;
            ensureTs();
            state._ts.mastery[secId] = Date.now();
            saveState();
            syncAllViewsForStateChange(secId);
          }
          noticeEl.classList.toggle("ok", recallPct >= 50);
          noticeEl.classList.remove("hidden");
          const nextLv = level < 4 ? `<button type="button" class="btn-apple soft sm" data-clz-lvup>Livello ${level + 1}</button>` : "";
          noticeEl.innerHTML = `
            <span><strong>Completato:</strong> ${recalled}/${total} (${recallPct}%)</span>
            <div class="notice-actions">${nextLv}<button type="button" class="btn-apple primary sm" data-clz-mem>A memoria</button></div>
          `;
          noticeEl.querySelector("[data-clz-lvup]")?.addEventListener("click", () => {
            syncClozeLevelControls(String(level + 1));
            saveState();
            triggerRestart();
          });
          noticeEl.querySelector("[data-clz-mem]")?.addEventListener("click", () => {
            state.mastery[secId] = 3;
            ensureTs();
            state._ts.mastery[secId] = Date.now();
            diagLog("ACTION", `Cloze segnato a memoria (${secId})`, "level=3");
            saveState();
            syncAllViewsForStateChange(secId);
            showToast(`${sec.code} segnato a memoria`);
          });
        }
      }
    };

    const elisionRe = /^((?:dell|all|dall|nell|sull|un|l|d)['’])(.+)$/i;

    for (const blk of sec.blocks) {
      const p = document.createElement("div");
      p.className = "cloze-para";
      const tokens = blk.text.split(/(\s+)/);
      let paraWordIdx = 0;

      for (const tok of tokens) {
        if (/^\s+$/.test(tok)) { p.appendChild(document.createTextNode(tok)); continue; }
        tokenIndex++;
        paraWordIdx++;
        if (paraWordIdx === 1 && (/^\d+\.$/.test(tok) || /^\([a-z]\)$/.test(tok))) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }
        const m = tok.match(/^([^\p{L}\p{N}€]*)([\p{L}\p{N}€.,\/:%'’-]+?)([^\p{L}\p{N}%]*)$/u);
        if (!m) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }
        let [, lead, core, trail] = m;
        // Separate Italian elided article/preposition (L’Assemblea -> lead="L’", core="Assemblea")
        const em = core.match(elisionRe);
        if (em && em[2].length >= 2) {
          lead += em[1];
          core = em[2];
        }
        if (!shouldBlankToken(core, level, tokenIndex)) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }
        if (lead) p.appendChild(document.createTextNode(lead));

        const isShortNumeric = core.length <= 2 || /^[€\d.,\/:%]+$/.test(core);
        const itemIdx = items.length;

        if (mode === "click") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cloze-blank";
          btn.textContent = isShortNumeric
            ? "···"
            : (level === 4 ? `${core[0]} ${"·".repeat(Math.min(core.length - 1, 5))}` : `${core[0]} ···`);
          btn.setAttribute("aria-label", isShortNumeric ? "Scopri valore numerico" : `Scopri parola che inizia per ${core[0]}`);
          const entry = {
            done: false,
            inputEl: null,
            revealPassively: (batch = false) => {
              if (entry.done) return;
              entry.done = true;
              btn.classList.add("peeked");
              btn.textContent = core;
              btn.disabled = true;
              revealed++;
              if (!batch) updateProgress();
            },
          };
          btn.addEventListener("click", () => {
            if (entry.done) return;
            entry.done = true;
            btn.classList.add("revealed");
            btn.textContent = core;
            btn.disabled = true;
            recalled++;
            updateProgress();
          });
          items.push(entry);
          p.appendChild(btn);
          if (trail) p.appendChild(document.createTextNode(trail));
        } else {
          const wrap = document.createElement("span");
          wrap.className = "cloze-input-wrap";
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "cloze-input";
          inp.placeholder = isShortNumeric ? "#" : `${core[0]}…`;
          inp.setAttribute("aria-label", isShortNumeric ? "Scrivi il numero o valore" : `Scrivi parola che inizia per ${core[0]}`);
          inp.style.width = `${Math.max(72, Math.min(168, core.length * 9.2 + 20))}px`;

          const peek = document.createElement("button");
          peek.type = "button";
          peek.className = "cloze-peek";
          peek.textContent = "?";
          peek.setAttribute("aria-label", "Mostra questa parola");

          const replaceWithChip = (cls, label) => {
            const chip = document.createElement("span");
            chip.className = cls;
            chip.textContent = core;
            chip.setAttribute("aria-label", `${core} (${label})`);
            wrap.replaceWith(chip);
          };

          const entry = {
            done: false,
            inputEl: inp,
            revealPassively: (batch = false) => {
              if (entry.done) return;
              entry.done = true;
              entry.inputEl = null;
              replaceWithChip("cloze-chip-peeked", "rivelata");
              revealed++;
              if (!batch) {
                updateProgress();
                focusNextFrom(itemIdx);
              }
            },
          };
          const markRecalled = () => {
            if (entry.done) return;
            entry.done = true;
            entry.inputEl = null;
            replaceWithChip("cloze-chip-ok", "corretta");
            recalled++;
            updateProgress();
            focusNextFrom(itemIdx);
          };

          inp.addEventListener("input", () => {
            if (norm(inp.value) === norm(core)) markRecalled();
            else wrap.classList.toggle("is-bad", inp.value.length >= core.length);
          });
          inp.addEventListener("keydown", e => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (norm(inp.value) === norm(core)) markRecalled();
              else wrap.classList.add("is-bad");
            }
          });
          peek.addEventListener("click", () => entry.revealPassively(false));
          items.push(entry);
          wrap.appendChild(inp);
          wrap.appendChild(peek);
          if (trail) {
            const group = document.createElement("span");
            group.className = "cloze-token-group";
            const tr = document.createElement("span");
            tr.className = "cloze-trail";
            tr.textContent = trail;
            group.appendChild(wrap);
            group.appendChild(tr);
            p.appendChild(group);
          } else {
            p.appendChild(wrap);
          }
        }
      }
      bodyEl.appendChild(p);
    }

    if (items.length === 0) {
      const targetLv = Math.min(4, level + 1);
      noticeEl.classList.remove("hidden");
      noticeEl.innerHTML = `
        <span>Nessun termine oscurabile al Livello ${level} per questo articolo.</span>
        ${level < 4 ? `<button type="button" class="btn-apple primary sm" data-jump-lv2>Passa a Livello ${targetLv}</button>` : ""}
      `;
      noticeEl.querySelector("[data-jump-lv2]")?.addEventListener("click", () => {
        syncClozeLevelControls(String(targetLv));
        saveState();
        triggerRestart();
      });
    }
    updateProgress();

    return {
      hintOne: () => { const next = items.find(it => !it.done); if (next) next.revealPassively(false); },
      revealAll: () => {
        let changed = false;
        for (const it of items) {
          if (!it.done) { it.revealPassively(true); changed = true; }
        }
        if (changed) updateProgress();
      },
    };
  }

  function renderInlineCloze() {
    inlineClozeCtrl = renderClozeInto({
      secId: readerSecId,
      levelSel: document.getElementById("inlineClozeLevel"),
      modeSel: document.getElementById("inlineClozeInput"),
      bodyEl: document.getElementById("inlineClozeBody"),
      counterEl: document.getElementById("inlineClozeCounter"),
      barEl: document.getElementById("inlineClozeBar"),
      barRevEl: document.getElementById("inlineClozeBarRev"),
      noticeEl: document.getElementById("inlineClozeNotice"),
      hintBtn: document.getElementById("btnInlineHint"),
      revealBtn: document.getElementById("btnInlineRevealAll"),
      resetBtn: document.getElementById("btnInlineReset"),
      onRestart: renderInlineCloze,
    });
  }

  function populatePracticeClozeSecSelect(docId) {
    const sel = document.getElementById("clozeSecSelect");
    const secs = CLOZEABLE_SECTIONS.filter(s => s.doc === docId);
    sel.innerHTML = "";
    for (const s of secs) {
      const m = state.mastery[s.id] || 0;
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.code} — ${s.title}${m === 3 ? " ★" : ""}`;
      sel.appendChild(opt);
    }
    if (!secs.some(s => s.id === practiceClozeSecId) && secs.length) practiceClozeSecId = secs[0].id;
    sel.value = practiceClozeSecId;
  }

  function renderPracticeCloze() {
    const sec = SECTION_MAP.get(practiceClozeSecId);
    if (!sec) return;
    document.getElementById("pClozeCode").textContent = `${DOC_SHORT[sec.doc]} · ${sec.code}`;
    document.getElementById("pClozeTitle").textContent = sec.title;
    document.getElementById("clozeQueueSummary").textContent = `${DOC_SHORT[sec.doc]} · ${sec.code}`;

    const idx = CLOZEABLE_SECTIONS.findIndex(s => s.id === practiceClozeSecId);
    document.getElementById("btnPClozePrev").disabled = idx <= 0;
    document.getElementById("btnPClozeNext").disabled = idx >= CLOZEABLE_SECTIONS.length - 1;

    practiceClozeCtrl = renderClozeInto({
      secId: practiceClozeSecId,
      levelSel: document.getElementById("clozeLevelSelect"),
      modeSel: document.getElementById("clozeInputMode"),
      bodyEl: document.getElementById("pClozeBody"),
      counterEl: document.getElementById("pClozeCounter"),
      barEl: document.getElementById("pClozeBar"),
      barRevEl: document.getElementById("pClozeBarRev"),
      noticeEl: document.getElementById("pClozeNotice"),
      hintBtn: document.getElementById("btnPClozeHint"),
      revealBtn: document.getElementById("btnPClozeRevealAll"),
      resetBtn: document.getElementById("btnPClozeReset"),
      onRestart: renderPracticeCloze,
    });
  }

  // ==================== 3A. FLASHCARD ====================
  function getArticleFlashcards() {
    return CLOZEABLE_SECTIONS.map(s => ({
      id: `auto-${s.id}`, doc: s.doc, ref: s.id,
      refLabel: `${DOC_SHORT[s.doc]} ${s.code}`,
      tag: "Articoli",
      q: `[${DOC_SHORT[s.doc]}] Cosa dispone ${s.code} — «${s.title}»?`,
      a: s.text,
    }));
  }

  function getDeckCards(mode) {
    if (mode === "curated") return [...PACK.flashcards];
    if (mode === "all_articles") return getArticleFlashcards();
    return [...PACK.flashcards, ...getArticleFlashcards()];
  }

  function isCardDue(id) {
    const rec = state.sm2[id];
    return !rec || Date.now() >= rec.nextReview;
  }

  function populateFcTagFilter() {
    const sel = document.getElementById("fcTagFilter");
    const prevVal = sel.value || "all";
    const deckMode = document.getElementById("fcDeckMode")?.value || state.prefs.fcDeckMode || "curated";
    sel.innerHTML = '<option value="all">Tutti gli argomenti</option>';
    const tags = deckMode === "all_articles"
      ? ["Articoli"]
      : Array.from(new Set(PACK.flashcards.map(c => c.tag))).sort().concat(deckMode === "combined" ? ["Articoli"] : []);
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
    sel.value = tags.includes(prevVal) ? prevVal : "all";
  }

  function buildFcQueue(shuffle = false, customCards = null, customLabel = null) {
    fcCustomCards = customCards ? [...customCards] : null;
    fcCustomContext = customLabel;
    const mode = document.getElementById("fcDeckMode").value;
    const docF = document.getElementById("fcDocFilter").value;
    const tagF = document.getElementById("fcTagFilter").value;
    const onlyDue = document.getElementById("fcOnlyDue").checked;

    let cards = fcCustomCards ? [...fcCustomCards] : getDeckCards(mode).filter(c => {
      if (docF !== "all" && c.doc !== docF) return false;
      if (tagF !== "all" && c.tag !== tagF) return false;
      if (onlyDue && !isCardDue(c.id)) return false;
      return true;
    });

    cards = cards.map(c => ({ ...c, _retry: false }));
    if (shuffle) {
      cards = shuffleArray(cards);
    } else if (onlyDue && !fcCustomCards) {
      // Prioritize truly due reviewed cards ahead of never-seen cards
      const now = Date.now();
      cards.sort((a, b) => {
        const aRev = state.sm2[a.id] && now >= state.sm2[a.id].nextReview ? 0 : 1;
        const bRev = state.sm2[b.id] && now >= state.sm2[b.id].nextReview ? 0 : 1;
        return aRev - bRev;
      });
    }

    fcQueue = cards;
    fcTotalSession = cards.length;
    fcCompletedSession = 0;
    fcFlipped = false;
    fcLastAction = null;
    document.getElementById("btnFcUndo").classList.add("hidden");
    document.getElementById("btnFcClearFocus").classList.toggle("hidden", !fcCustomContext);
    renderFlashcard();
  }

  function renderFlashcard() {
    const cardEl = document.getElementById("flashcardEl");
    const emptyEl = document.getElementById("fcEmptyState");
    const dockEl = document.getElementById("fcThumbDock");
    const revealWrap = document.getElementById("fcRevealWrap");
    const ratingWrap = document.getElementById("fcRatingWrap");

    const pct = fcTotalSession > 0 ? Math.round((fcCompletedSession / fcTotalSession) * 100) : 0;
    document.getElementById("fcBarFill").style.width = `${pct}%`;

    if (!fcQueue.length) {
      cardEl.classList.add("hidden");
      dockEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
      const onlyDue = document.getElementById("fcOnlyDue").checked;
      const hasFilters = onlyDue || document.getElementById("fcDocFilter").value !== "all" || document.getElementById("fcTagFilter").value !== "all" || !!fcCustomContext;
      document.getElementById("fcQueueInfo").textContent = fcTotalSession > 0 ? `${fcCompletedSession} di ${fcTotalSession}` : "0 schede";
      document.getElementById("fcEmptyTitle").textContent = fcTotalSession > 0 ? "Sessione completata" : "Nessuna scheda da ripassare";
      document.getElementById("fcEmptyDesc").textContent = onlyDue
        ? "Sei in pari con il ripasso programmato."
        : "Modifica i filtri o avvia un nuovo ciclo.";
      document.getElementById("btnFcShowAll").classList.toggle("hidden", !hasFilters);
      return;
    }

    cardEl.classList.remove("hidden");
    dockEl.classList.remove("hidden");
    emptyEl.classList.add("hidden");

    const card = fcQueue[0];
    const rec = state.sm2[card.id];
    const currentIdx = Math.min(fcCompletedSession + 1, fcTotalSession);
    document.getElementById("fcQueueInfo").textContent = `${currentIdx} di ${fcTotalSession}`;
    document.getElementById("fcMetaLine").textContent = `${DOC_SHORT[card.doc] || card.doc} · ${card.tag}`;
    document.getElementById("fcCardMeta").textContent = !rec ? "Nuova" : (rec.reps === 0 ? "Ripetizione" : `Rivista ${rec.reps}×`);
    document.getElementById("fcRetryBadge").classList.toggle("hidden", !card._retry);

    document.getElementById("fcQuestion").textContent = formatArrows(card.q);
    document.getElementById("fcAnswer").textContent = formatArrows(card.a);
    document.getElementById("fcRefLabel").textContent = card.refLabel;

    document.getElementById("int1").textContent = "Ora";
    document.getElementById("int2").textContent = formatShortInterval(computeNextSM2(rec, 3).interval);
    document.getElementById("int3").textContent = formatShortInterval(computeNextSM2(rec, 4).interval);
    document.getElementById("int4").textContent = formatShortInterval(computeNextSM2(rec, 5).interval);

    fcFlipped = false;
    document.getElementById("fcBack").classList.add("hidden");
    ratingWrap.classList.add("hidden");
    revealWrap.classList.remove("hidden");
  }

  function flipFlashcard() {
    if (!fcQueue.length || fcFlipped) return;
    fcFlipped = true;
    document.getElementById("fcBack").classList.remove("hidden");
    document.getElementById("fcRatingWrap").classList.remove("hidden");
    document.getElementById("fcRevealWrap").classList.add("hidden");
  }

  function rateFlashcard(quality) {
    if (!fcQueue.length) return;
    const card = fcQueue.shift();
    const prevRec = state.sm2[card.id] ? { ...state.sm2[card.id] } : null;

    fcLastAction = { card, prevRec, prevCompleted: fcCompletedSession, queueSnapshot: [...fcQueue] };
    state.sm2[card.id] = computeNextSM2(prevRec, quality);
    diagLog("ACTION", `Flashcard valutata (${card.id})`, `q=${quality} · nextInterval=${state.sm2[card.id].interval}g`);
    saveState();
    updateDueBadges();

    if (quality < 3) fcQueue.splice(Math.min(fcQueue.length, 3), 0, { ...card, _retry: true });
    else fcCompletedSession++;

    document.getElementById("btnFcUndo").classList.remove("hidden");
    renderFlashcard();
  }

  function undoLastFlashcard() {
    if (!fcLastAction) return;
    const { card, prevRec, prevCompleted, queueSnapshot } = fcLastAction;
    const now = Date.now();
    const ts = ensureTs();
    if (prevRec) {
      state.sm2[card.id] = { ...prevRec, _editedAt: now };
    } else {
      delete state.sm2[card.id];
      ts.sm2Del[card.id] = now;
    }
    diagLog("ACTION", `Voto flashcard annullato (${card.id})`, prevRec ? "Ripristinato stato precedente" : "Rimosso (tombstone)");
    saveState();
    updateDueBadges();
    fcQueue = [card, ...queueSnapshot];
    fcCompletedSession = prevCompleted;
    fcLastAction = null;
    document.getElementById("btnFcUndo").classList.add("hidden");
    renderFlashcard();
    showToast("Voto annullato");
  }

  // ==================== 3B. QUIZ ====================
  function getFilteredQuizPool() {
    const modeF = document.getElementById("qzModeFilter").value;
    const docF = document.getElementById("qzDocFilter").value;
    const onlyUnm = document.getElementById("qzOnlyUnmastered").checked;
    return PACK.quizzes.filter(q => {
      if (modeF !== "all" && q.mode !== modeF) return false;
      if (docF !== "all" && q.doc !== docF) return false;
      if (onlyUnm && state.quizMastered[q.id]) return false;
      return true;
    });
  }

  function shuffleQuizItemOptions(rawItem) {
    const tagged = rawItem.options.map((text, idx) => ({ text, isCorrect: idx === rawItem.correct }));
    const mixed = shuffleArray(tagged);
    return {
      ...rawItem,
      options: mixed.map(x => x.text),
      correct: mixed.findIndex(x => x.isCorrect),
    };
  }

  function startQuiz(customList = null, customLabel = null) {
    qzCustomContext = customLabel;
    const list = customList || getFilteredQuizPool();
    qzQueue = shuffleArray(list).map(shuffleQuizItemOptions);
    qzIdx = 0;
    qzCorrect = 0;
    qzWrong = [];
    qzAnswered = false;

    document.getElementById("btnRetryWrong").classList.add("hidden");
    document.getElementById("btnQzClearFocus").classList.toggle("hidden", !qzCustomContext);
    document.getElementById("quizSummary").classList.add("hidden");
    renderQuizQuestion();
  }

  function renderQuizScoreLive() {
    document.getElementById("qzScoreLive").innerHTML =
      `<span class="score-ok">✓ ${qzCorrect}</span> · <span class="score-bad">✕ ${qzWrong.length}</span>`;
  }

  function renderQuizQuestion() {
    const qBox = document.getElementById("quizBox");
    const qEmpty = document.getElementById("quizEmptyState");
    const paneQuiz = document.getElementById("pane-quiz");
    const mobileDock = document.getElementById("qzMobileDock");
    const kbdHint = document.getElementById("qzKbdHint");

    if (mobileDock) {
      mobileDock.classList.add("hidden");
      mobileDock.classList.remove("ok", "bad");
    }
    if (paneQuiz) paneQuiz.classList.remove("has-answer", "show-all-opts");
    const expBtn = document.getElementById("btnQzExpandOpts");
    if (expBtn) {
      expBtn.classList.add("hidden");
      expBtn.setAttribute("aria-expanded", "false");
      const lbl = document.getElementById("qzExpandLabel");
      if (lbl) lbl.textContent = "Mostra tutte le opzioni";
    }

    if (!qzQueue.length) {
      qBox.classList.add("hidden");
      if (kbdHint) kbdHint.classList.add("hidden");
      qEmpty.classList.remove("hidden");
      document.getElementById("qzCounter").textContent = "0 domande";
      document.getElementById("qzBarFill").style.width = "0%";
      return;
    }
    qEmpty.classList.add("hidden");
    qBox.classList.remove("hidden");
    if (kbdHint) kbdHint.classList.remove("hidden");

    if (qzIdx >= qzQueue.length) {
      showQuizSummary();
      return;
    }

    const item = qzQueue[qzIdx];
    qzAnswered = false;
    document.getElementById("qzCounter").textContent = `${qzIdx + 1} di ${qzQueue.length}`;
    renderQuizScoreLive();
    document.getElementById("qzBarFill").style.width = `${(qzIdx / qzQueue.length) * 100}%`;
    document.getElementById("qzMetaLine").textContent = `${DOC_SHORT[item.doc] || item.doc} · ${MODE_LABELS[item.mode] || item.mode}`;
    document.getElementById("qzQuestion").textContent = formatArrows(item.q);

    const optsEl = document.getElementById("qzOptions");
    optsEl.innerHTML = "";
    item.options.forEach((txt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-opt";
      btn.innerHTML = `<span class="opt-key">${String.fromCharCode(65 + i)}</span><span class="opt-text">${esc(formatArrows(txt))}</span>`;
      btn.addEventListener("click", () => handleQuizAnswer(i));
      optsEl.appendChild(btn);
    });

    const fb = document.getElementById("qzFeedback");
    fb.classList.add("hidden");
    fb.classList.remove("ok", "bad");
  }

  function handleQuizAnswer(chosenIdx) {
    if (qzAnswered || !qzQueue[qzIdx]) return;
    qzAnswered = true;
    const item = qzQueue[qzIdx];
    document.querySelectorAll("#qzOptions .quiz-opt").forEach((b, i) => {
      b.disabled = true;
      if (i === item.correct) {
        b.classList.add("correct");
        b.insertAdjacentHTML("beforeend", '<span class="opt-status" aria-label="Risposta corretta">✓</span>');
      }
      if (i === chosenIdx && i !== item.correct) {
        b.classList.add("wrong");
        b.insertAdjacentHTML("beforeend", '<span class="opt-status" aria-label="Risposta errata">✕</span>');
      }
    });

    const ok = chosenIdx === item.correct;
    if (ok) qzCorrect++;
    else qzWrong.push(item);
    recordQuizAnswer(item.id, ok);
    diagLog("ACTION", `Risposta Quiz (${item.id})`, `${ok ? "CORRETTA" : "ERRATA"} · Scelta=${String.fromCharCode(65 + chosenIdx)} · Tot=${state.quizStats.correct}/${state.quizStats.total}`);
    saveState();

    renderQuizScoreLive();
    document.getElementById("qzBarFill").style.width = `${((qzIdx + 1) / qzQueue.length) * 100}%`;

    const fb = document.getElementById("qzFeedback");
    fb.classList.toggle("ok", ok);
    fb.classList.toggle("bad", !ok);
    const verdictText = ok ? "Risposta corretta" : "Risposta errata";
    const nextLabel = qzIdx + 1 >= qzQueue.length ? "Riepilogo ›" : "Prossima ›";
    const openRef = () => openArticle(item.ref, { returnTo: { type: "practice", sub: "quiz", label: "Quiz", reason: "Verifica domanda" } });

    const cleanExplain = formatArrows(item.explanation);
    document.getElementById("qzFbTitle").textContent = verdictText;
    const fbIc = document.getElementById("qzFbIcon");
    if (fbIc) fbIc.textContent = ok ? "✓" : "✕";
    document.getElementById("qzFbText").textContent = cleanExplain;
    document.getElementById("qzRefLabel").textContent = item.refLabel;
    document.getElementById("btnQzSource").onclick = openRef;
    document.getElementById("btnQzNext").textContent = nextLabel;
    fb.classList.remove("hidden");

    const mobileDock = document.getElementById("qzMobileDock");
    if (mobileDock) {
      mobileDock.classList.toggle("ok", ok);
      mobileDock.classList.toggle("bad", !ok);
      const mIc = document.getElementById("qmdIcon");
      if (mIc) mIc.textContent = ok ? "✓" : "✕";
      const vEl = document.getElementById("qmdVerdict");
      vEl.textContent = verdictText;
      vEl.className = `qmd-verdict ${ok ? "ok" : "bad"}`;
      const mSrc = document.getElementById("btnQzMobileSource");
      mSrc.textContent = `Apri ${item.refLabel} ›`;
      mSrc.onclick = openRef;
      const mExp = document.getElementById("qmdExplain");
      if (mExp) mExp.textContent = cleanExplain;
      document.getElementById("btnQzMobileNext").textContent = nextLabel;
      mobileDock.classList.remove("hidden");
    }
    document.getElementById("pane-quiz")?.classList.add("has-answer");
    const hiddenOpts = Math.max(0, item.options.length - (ok ? 1 : 2));
    const expBtn = document.getElementById("btnQzExpandOpts");
    if (expBtn && hiddenOpts > 0) {
      const lbl = document.getElementById("qzExpandLabel");
      if (lbl) lbl.textContent = `Mostra le altre ${hiddenOpts} opzioni`;
      expBtn.setAttribute("aria-expanded", "false");
      expBtn.classList.remove("hidden");
    }

    document.getElementById("btnRetryWrong").classList.toggle("hidden", qzWrong.length === 0);
    document.getElementById("wrongInlineCount").textContent = qzWrong.length;
  }

  function showQuizSummary() {
    document.getElementById("quizBox").classList.add("hidden");
    document.getElementById("qzMobileDock")?.classList.add("hidden");
    document.getElementById("qzKbdHint")?.classList.add("hidden");
    document.getElementById("pane-quiz")?.classList.remove("has-answer");
    const sum = document.getElementById("quizSummary");
    sum.classList.remove("hidden");
    const pct = Math.round((qzCorrect / (qzQueue.length || 1)) * 100);
    document.getElementById("qzSumScore").textContent = `${qzCorrect} / ${qzQueue.length} (${pct}%)`;
    document.getElementById("qzSumMsg").textContent =
      pct >= 90 ? "Ottima padronanza." :
      pct >= 70 ? "Buona base: ripeti subito gli errori." :
      "Rivedi le norme collegate agli errori qui sotto.";

    const missed = document.getElementById("qzMissedList");
    missed.innerHTML = "";
    if (qzWrong.length) {
      missed.classList.remove("hidden");
      for (const w of qzWrong) {
        const row = document.createElement("div");
        row.className = "missed-row";
        row.innerHTML = `<span><strong>${esc(w.refLabel)}:</strong> ${esc(w.q)}</span><button type="button" class="text-action">Apri ›</button>`;
        row.querySelector("button").addEventListener("click", () => {
          openArticle(w.ref, { returnTo: { type: "practice", sub: "quiz", label: "Quiz", reason: "Approfondimento" } });
        });
        missed.appendChild(row);
      }
    } else {
      missed.classList.add("hidden");
    }
    document.getElementById("btnQzRetryWrong2").classList.toggle("hidden", qzWrong.length === 0);
  }

  // ==================== 4. SINOSSI ====================
  function syncCsTabs() {
    document.querySelectorAll("#csTabs .ref-pill").forEach(t => {
      const act = t.dataset.cs === csTab;
      t.classList.toggle("active", act);
      t.setAttribute("aria-selected", act ? "true" : "false");
      t.tabIndex = act ? 0 : -1;
    });
    const contentEl = document.getElementById("csContent");
    if (contentEl) contentEl.setAttribute("aria-labelledby", `csTab-${csTab}`);
    const filterBar = document.getElementById("csFilterBar");
    const inp = document.getElementById("csSearch");
    if (filterBar) filterBar.classList.toggle("hidden", csTab === "hierarchy");
    if (inp && CS_PLACEHOLDERS[csTab]) inp.placeholder = CS_PLACEHOLDERS[csTab];
  }

  function renderReference() {
    const wrap = document.getElementById("csContent");
    const inp = document.getElementById("csSearch");
    const clearBtn = document.getElementById("btnClearCsSearch");
    const rawQ = (inp.value || "").trim();
    if (clearBtn) clearBtn.classList.toggle("hidden", !rawQ.length);
    const q = searchNorm(rawQ);
    const cs = PACK.cheatsheet;
    const matchFields = fields => !q || fields.some(f => searchNorm(f).includes(q));

    if (csTab === "timeline") {
      const now = Date.now();
      const nextGlobalRow = cs.timeline2026.find(r => {
        const dt = parseItalianDate(r.date);
        return dt && dt.getTime() > now;
      });
      const rows = cs.timeline2026.filter(r => matchFields([r.date, r.event, formatSourceCitation(r.ref)]));
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Data / Ora</th><th>Adempimento</th><th class="col-source">Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const dt = parseItalianDate(r.date);
              let cls = "";
              if (r.date.startsWith("21/11/2026") && r.event.includes("ASSEMBLEA")) cls = "tl-election";
              else if (dt && dt.getTime() < now) cls = "tl-past";
              else if (r === nextGlobalRow) cls = "tl-next";
              return `<tr class="${cls}">
                <td data-label="Data / Ora"><span class="num-hl">${esc(r.date)}</span></td>
                <td data-label="Adempimento">${esc(r.event)}</td>
                <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${esc(r.ref)}">${esc(formatSourceCitation(r.ref))} ›</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun risultato per «${esc(rawQ)}».</p>`;
    } else if (csTab === "quorums") {
      const rows = cs.quorums.filter(r => matchFields([r.context, r.costitutivo, r.deliberativo, formatSourceCitation(r.ref)]));
      const formatQuorumContext = raw => {
        const clean = formatOperators(String(raw).replace(/\bconv\./g, "convocazione"));
        const parts = clean.split(/\s+—\s+/);
        if (parts.length > 1) {
          return `<strong class="q-organ">${esc(parts[0])}</strong><span class="q-sub">${esc(parts.slice(1).join(" · "))}</span>`;
        }
        return `<strong class="q-organ">${esc(clean)}</strong>`;
      };
      const formatQuorumMetric = raw => {
        const safe = esc(formatOperators(String(raw).replace(/\bconv\./g, "convocazione")));
        return safe.replace(/(&gt;\s*50%|&gt;\s*2\/3|≥\s*\d+h?|2\/3|1\/3|50%|24h|unanimità)/gi, '<span class="q-num">$1</span>');
      };
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Organo / Seduta</th><th>Costitutivo</th><th>Deliberativo</th><th class="col-source">Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Organo / Seduta">${formatQuorumContext(r.context)}</td>
              <td data-label="Costitutivo">${formatQuorumMetric(r.costitutivo)}</td>
              <td data-label="Deliberativo">${formatQuorumMetric(r.deliberativo)}</td>
              <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${esc(r.ref)}">${esc(formatSourceCitation(r.ref))} ›</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun quorum trovato.</p>`;
    } else if (csTab === "organs") {
      const rows = cs.organs.filter(r => matchFields([r.name, r.composition, r.term, r.powers, formatSourceCitation(r.ref)]));
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Organo</th><th>Composizione</th><th>Durata</th><th>Poteri</th><th class="col-source">Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Organo"><strong>${esc(formatOperators(r.name))}</strong></td>
              <td data-label="Composizione">${esc(formatOperators(r.composition))}</td>
              <td data-label="Durata">${esc(formatOperators(r.term))}</td>
              <td data-label="Poteri">${esc(formatOperators(r.powers))}</td>
              <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${esc(r.ref)}">${esc(formatSourceCitation(r.ref))} ›</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun organo trovato.</p>`;
    } else if (csTab === "deadlines") {
      const rows = cs.keyDeadlines.filter(r => matchFields([r.term, r.value, formatSourceCitation(r.ref)]));
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Procedura</th><th>Termine</th><th class="col-source">Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Procedura"><strong>${esc(formatOperators(r.term))}</strong></td>
              <td data-label="Termine">${esc(formatOperators(r.value))}</td>
              <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${esc(r.ref)}">${esc(formatSourceCitation(r.ref))} ›</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun termine trovato.</p>`;
    } else if (csTab === "hierarchy") {
      wrap.innerHTML = `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Grado</th><th>Fonte</th><th>Prevalenza e note</th></tr></thead>
          <tbody>
            ${cs.hierarchy.map(r => `<tr>
              <td data-label="Grado"><span class="num-hl">#${esc(r.rank)}</span></td>
              <td data-label="Fonte"><strong>${esc(r.source)}</strong></td>
              <td data-label="Note">${esc(r.note)} ${r.ref ? `<button type="button" class="text-action" data-ref-jump="${esc(r.ref)}">${esc(formatSourceCitation(r.ref))} ›</button>` : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        <div class="stv-box">
          <h3>Sistema Elettorale STV (Art. A.16 – A.17)</h3>
          <div class="stv-formula">Quota di Droop = ⌊ schede_valide / (seggi + 1) ⌋ + 1</div>
          <p class="muted small" style="line-height:1.68;">
            <strong>Seggi:</strong> &gt;6 candidati → 7 seggi · 5–6 candidati → 5 seggi · &lt;5 candidati → rinvio (max 14 giorni).<br/>
            <strong>1ª Votazione (STV):</strong> eccedenza trasferita con fattore <code>(voti − quota) / voti</code>; altrimenti si esclude il meno votato.<br/>
            <strong>2ª Votazione (Cariche):</strong> solo fra gli eletti; quota = maggioranza assoluta per posizione.<br/>
            <strong>Parità (Art. A.16.4):</strong> 1° Anzianità → 2° Il più giovane → 3° Sorteggio.
          </p>
        </div>`;
    } else if (csTab === "diagrams") {
      const elDoc = CORPUS.documents.find(d => d.id === "elettorale");
      const entries = Object.entries(elDoc?.visualPagesRendered || {})
        .filter(([, src]) => isSafeAssetSrc(src))
        .map(([p, src]) => ({ p, src, cap: `${DIAGRAM_LABELS[p] || `Pagina ${p}`} (Pag. ${p})` }))
        .filter(item => matchFields([item.cap]));
      wrap.innerHTML = entries.length ? `<div class="pdf-gallery">${entries.map((it, i) => `
        <button type="button" class="pdf-card" data-lb-idx="${i}">
          <img src="${esc(it.src)}" alt="${esc(it.cap)}" loading="lazy" />
          <span class="pdf-card-cap">${esc(it.cap)}</span>
        </button>
      `).join("")}</div>` : `<p class="muted">Nessuno schema trovato.</p>`;
      wrap.querySelectorAll("[data-lb-idx]").forEach(el => {
        el.addEventListener("click", () => openLightbox(entries, Number(el.dataset.lbIdx)));
      });
    }

    wrap.querySelectorAll("[data-ref-jump]").forEach(btn => {
      btn.addEventListener("click", () => {
        openArticle(btn.dataset.refJump, { returnTo: { type: "reference", sub: csTab, label: "Sinossi", reason: "Da Sinossi" } });
      });
    });
  }

  // ==================== MODALS, SEARCH & LIGHTBOX ====================
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    // Close TOC drawer or any OTHER open modal without overwriting original non-modal lastFocusedEl
    const sidebar = document.getElementById("readerSidebar");
    if (sidebar?.classList.contains("open")) {
      sidebar.classList.remove("open");
      document.getElementById("tocBackdrop")?.classList.add("hidden");
      document.getElementById("btnOpenTocDrawer")?.setAttribute("aria-expanded", "false");
    }
    const alreadyInModal = !!activeTrapContainer;
    ["searchModal", "backupModal", "lightboxModal"].forEach(mid => {
      if (mid !== id) document.getElementById(mid)?.classList.add("hidden");
    });
    if (!alreadyInModal) {
      lastFocusedEl = document.activeElement;
    }
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    activeTrapContainer = modal;
    if (!modal.contains(document.activeElement)) {
      getFocusable(modal)[0]?.focus();
    }
  }

  function closeAllModals() {
    let anyOpen = false;
    ["searchModal", "backupModal", "lightboxModal"].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) { el.classList.add("hidden"); anyOpen = true; }
    });
    document.getElementById("resetConfirmBox")?.classList.add("hidden");
    document.getElementById("lightboxImg")?.removeAttribute("src");
    if (anyOpen) {
      document.body.classList.remove("modal-open");
      activeTrapContainer = null;
      if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
        lastFocusedEl.focus();
        lastFocusedEl = null;
      }
    }
  }

  function openLightbox(gallery, idx = 0) {
    lbGallery = gallery;
    lbIdx = idx;
    updateLightbox();
    openModal("lightboxModal");
    document.getElementById("closeLightbox").focus();
  }

  function updateLightbox() {
    if (!lbGallery.length) return;
    const item = lbGallery[lbIdx];
    const imgEl = document.getElementById("lightboxImg");
    if (isSafeAssetSrc(item.src)) imgEl.src = item.src;
    imgEl.alt = item.cap || "Schema ufficiale PDF";
    document.getElementById("lightboxCap").textContent = `${item.cap} (${lbIdx + 1}/${lbGallery.length})`;
    document.getElementById("btnLbPrev").disabled = lbGallery.length <= 1;
    document.getElementById("btnLbNext").disabled = lbGallery.length <= 1;
  }

  function sanitizeSnippetText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/(^|\s)(?:(?:s[iì]|no)(?=\s|$)\s*){2,}/gi, "$1· ")
      .replace(/(?:\s*·\s*){2,}/g, " · ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function sliceCleanSnippet(text, matchPos) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return "Sezione";
    let start = matchPos >= 0 ? Math.max(0, matchPos - 46) : 0;
    if (start > 0) {
      const nextSpace = clean.indexOf(" ", start);
      if (nextSpace !== -1 && nextSpace < matchPos) start = nextSpace + 1;
    }
    let end = Math.min(clean.length, start + 148);
    if (end < clean.length) {
      const lastSpace = clean.lastIndexOf(" ", end);
      if (lastSpace > start + 40) end = lastSpace;
    }
    return (start > 0 ? "…" : "") + clean.slice(start, end).trim() + (end < clean.length ? "…" : "");
  }

  function renderGlobalSearch(query) {
    const res = document.getElementById("globalSearchResults");
    const clearBtn = document.getElementById("btnClearGlobalSearch");
    const countEl = document.getElementById("searchResultCount");
    const inp = document.getElementById("globalSearchInput");
    if (clearBtn) clearBtn.classList.toggle("hidden", !query.length);

    const q = searchNorm(query).trim();
    gsResults = [];
    gsActiveIdx = -1;
    inp?.removeAttribute("aria-activedescendant");

    if (!q) {
      res.innerHTML = `<p class="muted small">Cerca articoli, quorum, date o termini (es. <em>Droop</em>, <em>delega</em>, <em>90 giorni</em>).</p>`;
      if (countEl) countEl.textContent = "Ricerca rapida";
      return;
    }

    const scoredArticles = [];
    for (const entry of searchIndex) {
      const inCode = entry.codeNorm.includes(q);
      const inTitle = entry.titleNorm.includes(q);
      const pos = entry.flatNorm.indexOf(q);
      const inBody = pos !== -1 || entry.textNorm.includes(q);
      if (!inCode && !inTitle && !inBody) continue;
      const score = (inCode ? 100 : 0) + (inTitle ? 50 : 0) + (inBody ? 10 : 0);
      scoredArticles.push({ entry, pos, score });
    }
    scoredArticles.sort((a, b) => b.score - a.score);

    const artMatches = scoredArticles.slice(0, 24).map(({ entry, pos }) => ({
      kind: "article",
      meta: `${DOC_SHORT[entry.sec.doc]} · ${entry.sec.code}`,
      title: entry.sec.title,
      snip: entry.flatText ? sliceCleanSnippet(entry.flatText, pos) : "Sezione",
      target: entry.sec.id,
    }));

    const sinMatches = [];
    PACK.cheatsheet.quorums.forEach(r => {
      if ([r.context, r.costitutivo, r.deliberativo].some(f => searchNorm(f).includes(q))) {
        sinMatches.push({ kind: "reference", meta: "Sinossi · Quorum", title: r.context, snip: `${r.costitutivo} · ${r.deliberativo}`, target: "quorums" });
      }
    });
    PACK.cheatsheet.timeline2026.forEach(r => {
      if ([r.date, r.event].some(f => searchNorm(f).includes(q))) {
        sinMatches.push({ kind: "reference", meta: `Sinossi · ${r.date}`, title: "Cronoprogramma 2026", snip: r.event, target: "timeline" });
      }
    });
    PACK.cheatsheet.organs.forEach(r => {
      if ([r.name, r.composition, r.term, r.powers].some(f => searchNorm(f).includes(q))) {
        sinMatches.push({ kind: "reference", meta: "Sinossi · Organi", title: r.name, snip: r.powers, target: "organs" });
      }
    });
    PACK.cheatsheet.keyDeadlines.forEach(r => {
      if ([r.term, r.value].some(f => searchNorm(f).includes(q))) {
        sinMatches.push({ kind: "reference", meta: "Sinossi · Scadenze", title: r.term, snip: r.value, target: "deadlines" });
      }
    });

    const combined = [...artMatches, ...sinMatches.slice(0, 8)];
    if (!combined.length) {
      res.innerHTML = `<p class="muted small">Nessun risultato per «${esc(query)}».</p>`;
      if (countEl) countEl.textContent = "0 risultati";
      return;
    }

    if (countEl) countEl.textContent = combined.length === 1 ? "1 risultato" : `${combined.length} risultati`;
    gsResults = combined;
    gsActiveIdx = 0;
    res.innerHTML = "";
    combined.forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `srOpt-${idx}`;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", idx === 0 ? "true" : "false");
      btn.className = `sr-item ${idx === 0 ? "active" : ""}`;
      btn.innerHTML = `
        <span class="sr-item-meta">${esc(item.meta)}</span>
        <span class="sr-item-title">${highlightQuery(item.title, query)}</span>
        <span class="sr-item-snip">${highlightQuery(item.snip, query)}</span>
      `;
      btn.addEventListener("click", () => executeSearchResult(item));
      res.appendChild(btn);
    });
    inp?.setAttribute("aria-activedescendant", "srOpt-0");
  }

  function executeSearchResult(item) {
    closeAllModals();
    if (item.kind === "article") openArticle(item.target);
    else {
      const csInp = document.getElementById("csSearch");
      if (csInp) csInp.value = "";
      csTab = item.target;
      syncCsTabs();
      renderReference();
      switchView("reference");
    }
  }

  function renderBackupSummary() {
    const studied = STUDYABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) >= 2).length;
    const sm2Count = Object.keys(state.sm2).length;
    const bmCount = Object.keys(state.bookmarks).filter(k => state.bookmarks[k] && SECTION_MAP.has(k)).length;
    document.getElementById("backupSummary").textContent =
      `Sezioni: ${studied}/${STUDYABLE_SECTIONS.length} · Flashcard: ${sm2Count} · Salvati: ${bmCount} · Quiz: ${state.quizStats.total}`;
  }

  // ==================== EVENT WIRING ====================
  function bindAllEvents() {
    document.getElementById("brandHome").addEventListener("click", () => switchView("overview"));
    document.querySelectorAll("#desktopNav .nav-tab, #mobileNav .fnav-btn").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    document.querySelectorAll("[data-proxy-click]").forEach(btn => {
      btn.addEventListener("click", () => document.getElementById(btn.dataset.proxyClick)?.click());
    });

    document.getElementById("btnQuickFlashcards").addEventListener("click", () => {
      switchPracticeMode("flashcards");
      switchView("practice");
    });
    document.getElementById("btnQuickBlitz").addEventListener("click", () => {
      qzCustomContext = null;
      document.getElementById("qzModeFilter").value = "blitz";
      document.getElementById("qzDocFilter").value = "all";
      document.getElementById("qzOnlyUnmastered").checked = false;
      startQuiz();
      switchPracticeMode("quiz");
      switchView("practice");
    });
    document.getElementById("btnOpenTimeline").addEventListener("click", () => {
      csTab = "timeline";
      syncCsTabs();
      renderReference();
      switchView("reference");
    });
    document.getElementById("metricNormativa").addEventListener("click", () => {
      const target = readerSecId || STUDYABLE_SECTIONS[0]?.id;
      if (target) openArticle(target);
    });
    document.getElementById("metricQuiz").addEventListener("click", () => { switchPracticeMode("quiz"); switchView("practice"); });
    document.getElementById("metricBookmarks").addEventListener("click", () => {
      returnStack = [];
      readerDocFilter = "all";
      syncReaderDocPills();
      document.getElementById("readerSearch").value = "";
      readerStatusFilter = "bookmarked";
      document.getElementById("readerStatusFilter").value = "bookmarked";
      renderReaderSidebar();
      const firstBm = getFilteredReaderSections()[0];
      if (firstBm) renderReaderArticle(firstBm.id);
      switchView("reader");
    });

    document.getElementById("btnTheme").addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      applyTheme(state.theme);
      saveState();
    });

    // WAI-ARIA APG keyboard navigation for role="tablist"
    ["readerModeSwitch", "practiceModeSwitch", "csTabs"].forEach(listId => {
      const list = document.getElementById(listId);
      if (!list) return;
      list.addEventListener("keydown", e => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        const tabs = Array.from(list.querySelectorAll('[role="tab"]:not([disabled])'));
        const cur = tabs.indexOf(document.activeElement);
        if (cur === -1 || !tabs.length) return;
        e.preventDefault();
        let next = cur;
        if (e.key === "ArrowRight") next = (cur + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (cur - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        tabs[next].focus();
        tabs[next].click();
      });
    });

    // Reader & TOC
    document.getElementById("btnOpenTocDrawer").addEventListener("click", openTocDrawer);
    document.getElementById("btnCloseTocDrawer").addEventListener("click", closeTocDrawer);
    document.getElementById("tocBackdrop").addEventListener("click", closeTocDrawer);

    document.querySelectorAll("#readerDocPills .ios-seg-btn").forEach(b => {
      b.addEventListener("click", () => {
        readerDocFilter = b.dataset.doc;
        syncReaderDocPills();
        renderReaderSidebar();
        updateReaderPager();
      });
    });
    document.getElementById("readerSearch").addEventListener("input", debounce(() => {
      renderReaderSidebar();
      updateReaderPager();
    }, 110));
    document.getElementById("readerStatusFilter").addEventListener("change", e => {
      readerStatusFilter = e.target.value;
      renderReaderSidebar();
      updateReaderPager();
    });

    document.querySelectorAll("#readerModeSwitch .ios-seg-btn").forEach(b => {
      b.addEventListener("click", () => {
        if (b.disabled || b.dataset.rmode === readerMode) return;
        readerMode = b.dataset.rmode;
        syncReaderModeTabs();
        if (readerMode === "cloze") renderInlineCloze();
        setHash(`reader/${readerSecId}${readerMode === "cloze" ? "/cloze" : ""}`);
      });
    });
    document.getElementById("btnSwitchInlineCloze").addEventListener("click", () => {
      readerMode = readerMode === "read" ? "cloze" : "read";
      syncReaderModeTabs();
      if (readerMode === "cloze") renderInlineCloze();
      setHash(`reader/${readerSecId}${readerMode === "cloze" ? "/cloze" : ""}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.getElementById("inlineClozeLevel").addEventListener("change", e => {
      syncClozeLevelControls(e.target.value);
      saveState();
      renderInlineCloze();
    });
    document.getElementById("inlineClozeInput").addEventListener("change", e => {
      state.prefs.clozeInputMode = e.target.value;
      document.getElementById("clozeInputMode").value = e.target.value;
      saveState();
      renderInlineCloze();
    });
    document.getElementById("btnInlineHint").addEventListener("click", () => inlineClozeCtrl?.hintOne());
    document.getElementById("btnInlineRevealAll").addEventListener("click", () => inlineClozeCtrl?.revealAll());
    document.getElementById("btnInlineReset").addEventListener("click", renderInlineCloze);

    document.getElementById("btnFontCycle").addEventListener("click", e => {
      e.stopPropagation();
      const pop = document.getElementById("fontPopover");
      const open = pop.classList.toggle("hidden") === false;
      e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.getElementById("fontPopover").addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", closeFontPopover);
    document.getElementById("btnFontDec").addEventListener("click", () => {
      const prev = state.readerScale;
      applyReaderScale(prev - 0.08);
      if (state.readerScale !== prev) saveState();
    });
    document.getElementById("btnFontInc").addEventListener("click", () => {
      const prev = state.readerScale;
      applyReaderScale(prev + 0.08);
      if (state.readerScale !== prev) saveState();
    });

    document.getElementById("btnToggleNums").addEventListener("click", () => {
      state.prefs.highlightNums = !(state.prefs.highlightNums !== false);
      saveState();
      syncNumsToggleUI(state.prefs.highlightNums);
      if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
    });

    document.getElementById("readerMasterySelect").addEventListener("change", e => {
      if (!readerSecId) return;
      const val = Number(e.target.value);
      if (val > 0) state.mastery[readerSecId] = val;
      else delete state.mastery[readerSecId];
      ensureTs();
      state._ts.mastery[readerSecId] = Date.now();
      diagLog("ACTION", `Stato articolo aggiornato (${readerSecId})`, `${STATUS_LABELS[val]} (level=${val})`);
      saveState();
      syncAllViewsForStateChange(readerSecId);
      showToast(`Stato: ${STATUS_LABELS[val]}`);
    });

    document.getElementById("btnBookmarkSec").addEventListener("click", () => {
      if (!readerSecId) return;
      ensureTs();
      state._ts.bookmarks[readerSecId] = Date.now();
      const active = !state.bookmarks[readerSecId];
      if (active) { state.bookmarks[readerSecId] = true; showToast("Salvato"); }
      else { delete state.bookmarks[readerSecId]; showToast("Rimosso dai salvati"); }
      diagLog("ACTION", `Segnalibro articolo (${readerSecId})`, active ? "Aggiunto" : "Rimosso");
      saveState();
      document.getElementById("btnBookmarkSec").setAttribute("aria-pressed", active ? "true" : "false");
      if (readerStatusFilter === "bookmarked") {
        renderReaderSidebar();
        updateReaderPager();
      } else {
        syncReaderSidebarDots();
      }
    });

    document.getElementById("btnContextReturn").addEventListener("click", () => {
      const top = returnStack.pop();
      if (!top) return;
      if (top.type === "article") renderReaderArticle(top.target);
      else if (top.type === "overview") switchView("overview");
      else if (top.type === "practice") { switchPracticeMode(top.sub || "flashcards"); switchView("practice"); }
      else if (top.type === "reference") { csTab = top.sub || "timeline"; syncCsTabs(); renderReference(); switchView("reference"); }
    });

    document.getElementById("btnArticleFlashcards").addEventListener("click", () => {
      const sec = SECTION_MAP.get(readerSecId);
      const rel = PACK.flashcards.filter(c => c.ref === readerSecId);
      if (!rel.length) return;
      buildFcQueue(false, rel, sec.code);
      switchPracticeMode("flashcards");
      switchView("practice");
    });
    document.getElementById("btnArticleQuiz").addEventListener("click", () => {
      const sec = SECTION_MAP.get(readerSecId);
      const rel = PACK.quizzes.filter(q => q.ref === readerSecId);
      if (!rel.length) return;
      startQuiz(rel, sec.code);
      switchPracticeMode("quiz");
      switchView("practice");
    });

    ["btnPrevSec", "btnNextSec"].forEach(id => {
      document.getElementById(id).addEventListener("click", e => {
        const target = e.currentTarget.dataset.target;
        if (target) {
          returnStack = [];
          renderReaderArticle(target);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });

    // Practice
    document.querySelectorAll("#practiceModeSwitch .ios-seg-btn").forEach(b => {
      b.addEventListener("click", () => switchPracticeMode(b.dataset.pmode));
    });

    const wireTrayToggle = (btnId, trayId) => {
      const btn = document.getElementById(btnId);
      const tray = document.getElementById(trayId);
      btn.addEventListener("click", () => {
        const open = tray.classList.toggle("hidden") === false;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    };
    wireTrayToggle("btnToggleFcFilters", "fcFilterTray");
    wireTrayToggle("btnToggleQzFilters", "qzFilterTray");
    wireTrayToggle("btnToggleClozeFilters", "clozeFilterTray");

    document.getElementById("fcDeckMode").addEventListener("change", e => {
      state.prefs.fcDeckMode = e.target.value;
      populateFcTagFilter();
      saveState();
      buildFcQueue(false);
    });
    ["fcDocFilter", "fcTagFilter", "fcOnlyDue"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => buildFcQueue(false));
    });
    document.getElementById("btnFcClearFocus").addEventListener("click", () => buildFcQueue(false));
    document.getElementById("btnFcShuffle").addEventListener("click", () => {
      buildFcQueue(true, fcCustomCards, fcCustomContext);
      showToast("Mazzo mescolato");
    });
    document.getElementById("btnFcUndo").addEventListener("click", undoLastFlashcard);
    const fcCardEl = document.getElementById("flashcardEl");
    fcCardEl.addEventListener("click", flipFlashcard);
    fcCardEl.addEventListener("keydown", e => {
      if (e.target === fcCardEl && (e.key === "Enter" || e.code === "Space")) {
        e.preventDefault();
        flipFlashcard();
      }
    });
    document.getElementById("btnFcReveal").addEventListener("click", flipFlashcard);
    document.getElementById("btnFcSource").addEventListener("click", e => {
      e.stopPropagation();
      const card = fcQueue[0];
      if (card?.ref) {
        openArticle(card.ref, { returnTo: { type: "practice", sub: "flashcards", label: "Flashcard", reason: "Verifica scheda" } });
      }
    });
    document.querySelectorAll("#fcRatingBar .sm2-pill").forEach(b => {
      b.addEventListener("click", () => rateFlashcard(Number(b.dataset.q)));
    });
    document.getElementById("btnFcShowAll").addEventListener("click", () => {
      document.getElementById("fcOnlyDue").checked = false;
      document.getElementById("fcDocFilter").value = "all";
      document.getElementById("fcTagFilter").value = "all";
      buildFcQueue(false);
    });
    document.getElementById("btnFcRestartSession").addEventListener("click", () => buildFcQueue(true, fcCustomCards, fcCustomContext));

    // Quiz
    ["qzModeFilter", "qzDocFilter", "qzOnlyUnmastered"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => startQuiz());
    });
    document.getElementById("btnQzClearFocus").addEventListener("click", () => startQuiz());
    document.getElementById("btnQzShowAll").addEventListener("click", () => {
      document.getElementById("qzOnlyUnmastered").checked = false;
      startQuiz();
    });
    document.getElementById("btnStartQuiz").addEventListener("click", () => startQuiz());
    document.getElementById("btnQzRestart").addEventListener("click", () => startQuiz());
    document.getElementById("btnRetryWrong").addEventListener("click", () => startQuiz([...qzWrong], "Errori"));
    document.getElementById("btnQzRetryWrong2").addEventListener("click", () => startQuiz([...qzWrong], "Errori"));
    const advanceQuizQuestion = () => {
      qzIdx++;
      renderQuizQuestion();
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    document.getElementById("btnQzNext").addEventListener("click", advanceQuizQuestion);
    document.getElementById("btnQzMobileNext").addEventListener("click", advanceQuizQuestion);
    document.getElementById("btnQzExpandOpts").addEventListener("click", e => {
      const pane = document.getElementById("pane-quiz");
      const expanded = pane.classList.toggle("show-all-opts");
      const item = qzQueue[qzIdx];
      const hiddenCount = item ? Math.max(0, item.options.length - (document.querySelectorAll("#qzOptions .quiz-opt.correct, #qzOptions .quiz-opt.wrong").length)) : 2;
      e.currentTarget.setAttribute("aria-expanded", expanded ? "true" : "false");
      const lbl = document.getElementById("qzExpandLabel");
      if (lbl) lbl.textContent = expanded ? "Nascondi altre opzioni" : `Mostra le altre ${hiddenCount} opzioni`;
    });

    // Dynamic stuck state for sticky inline Cloze strip (rAF-throttled)
    let stickyRaf = 0;
    const syncClozeStickyState = () => {
      if (stickyRaf) return;
      stickyRaf = requestAnimationFrame(() => {
        stickyRaf = 0;
        const bar = document.getElementById("inlineClozeStickyBar");
        if (!bar || bar.closest(".hidden") || currentView !== "reader") return;
        const stickyTop = window.innerWidth <= 900 ? 52 : 108;
        const stuck = window.scrollY > 12 && bar.getBoundingClientRect().top <= stickyTop + 2;
        bar.classList.toggle("is-stuck", stuck);
      });
    };
    window.addEventListener("scroll", syncClozeStickyState, { passive: true });
    window.addEventListener("resize", syncClozeStickyState, { passive: true });

    // Practice Cloze
    document.getElementById("clozeDocSelect").addEventListener("change", e => {
      populatePracticeClozeSecSelect(e.target.value);
      renderPracticeCloze();
      if (currentView === "practice" && practiceMode === "cloze" && practiceClozeSecId) {
        setHash(`practice/cloze/${practiceClozeSecId}`);
      }
    });
    document.getElementById("clozeSecSelect").addEventListener("change", e => {
      practiceClozeSecId = e.target.value;
      renderPracticeCloze();
      if (currentView === "practice" && practiceMode === "cloze" && practiceClozeSecId) {
        setHash(`practice/cloze/${practiceClozeSecId}`);
      }
    });
    document.getElementById("clozeLevelSelect").addEventListener("change", e => {
      syncClozeLevelControls(e.target.value);
      saveState();
      renderPracticeCloze();
    });
    document.getElementById("clozeInputMode").addEventListener("change", e => {
      state.prefs.clozeInputMode = e.target.value;
      document.getElementById("inlineClozeInput").value = e.target.value;
      saveState();
      renderPracticeCloze();
    });
    document.getElementById("btnPClozeHint").addEventListener("click", () => practiceClozeCtrl?.hintOne());
    document.getElementById("btnPClozeRevealAll").addEventListener("click", () => practiceClozeCtrl?.revealAll());
    document.getElementById("btnPClozeReset").addEventListener("click", renderPracticeCloze);
    document.getElementById("btnPClozeMarkMem").addEventListener("click", () => {
      if (!practiceClozeSecId) return;
      state.mastery[practiceClozeSecId] = 3;
      ensureTs();
      state._ts.mastery[practiceClozeSecId] = Date.now();
      diagLog("ACTION", `Cloze segnato a memoria (${practiceClozeSecId})`, "level=3");
      saveState();
      syncAllViewsForStateChange(practiceClozeSecId);
      showToast("Segnato a memoria");
    });
    document.getElementById("btnPClozeOpenReader").addEventListener("click", () => {
      if (practiceClozeSecId) openArticle(practiceClozeSecId, { returnTo: { type: "practice", sub: "cloze", label: "Cloze", reason: "Lettura articolo" } });
    });
    document.getElementById("btnPClozePrev").addEventListener("click", () => {
      const idx = CLOZEABLE_SECTIONS.findIndex(s => s.id === practiceClozeSecId);
      if (idx > 0) openPracticeClozeArticle(CLOZEABLE_SECTIONS[idx - 1].id);
    });
    document.getElementById("btnPClozeNext").addEventListener("click", () => {
      const idx = CLOZEABLE_SECTIONS.findIndex(s => s.id === practiceClozeSecId);
      if (idx >= 0 && idx < CLOZEABLE_SECTIONS.length - 1) openPracticeClozeArticle(CLOZEABLE_SECTIONS[idx + 1].id);
    });
    document.getElementById("btnClozeRandom").addEventListener("click", () => {
      let pool = CLOZEABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) < 3 && s.id !== practiceClozeSecId);
      if (!pool.length) pool = CLOZEABLE_SECTIONS.filter(s => s.id !== practiceClozeSecId);
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : CLOZEABLE_SECTIONS[0];
      if (pick) openPracticeClozeArticle(pick.id);
    });

    // Reference
    document.querySelectorAll("#csTabs .ref-pill").forEach(t => {
      t.addEventListener("click", () => {
        csTab = t.dataset.cs;
        syncCsTabs();
        renderReference();
        setHash(`reference/${csTab}`);
        window.scrollTo({ top: 0, behavior: "instant" });
      });
    });
    document.getElementById("csSearch").addEventListener("input", debounce(renderReference, 110));
    document.getElementById("btnClearCsSearch").addEventListener("click", () => {
      const inp = document.getElementById("csSearch");
      inp.value = "";
      renderReference();
      inp.focus();
    });

    // Search Modal
    document.getElementById("btnSearchQuick").addEventListener("click", () => {
      openModal("searchModal");
      const inp = document.getElementById("globalSearchInput");
      inp.focus();
      inp.select();
      renderGlobalSearch(inp.value);
    });
    document.getElementById("closeSearchModal").addEventListener("click", closeAllModals);
    document.getElementById("searchModal").addEventListener("click", e => { if (e.target.id === "searchModal") closeAllModals(); });
    document.getElementById("globalSearchInput").addEventListener("input", debounce(e => renderGlobalSearch(e.target.value), 100));
    document.getElementById("btnClearGlobalSearch").addEventListener("click", () => {
      const inp = document.getElementById("globalSearchInput");
      inp.value = "";
      renderGlobalSearch("");
      inp.focus();
    });
    document.getElementById("globalSearchInput").addEventListener("keydown", e => {
      if (!gsResults.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        gsActiveIdx = e.key === "ArrowDown" ? (gsActiveIdx + 1) % gsResults.length : (gsActiveIdx - 1 + gsResults.length) % gsResults.length;
        const els = document.querySelectorAll("#globalSearchResults .sr-item");
        els.forEach((el, i) => {
          const act = i === gsActiveIdx;
          el.classList.toggle("active", act);
          el.setAttribute("aria-selected", act ? "true" : "false");
        });
        if (els[gsActiveIdx]?.id) {
          document.getElementById("globalSearchInput")?.setAttribute("aria-activedescendant", els[gsActiveIdx].id);
        }
        els[gsActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && gsActiveIdx >= 0) {
        e.preventDefault();
        executeSearchResult(gsResults[gsActiveIdx]);
      }
    });

    // Backup & Firebase Cloud Sync Modal
    const openBackupModalWithDiag = (scrollToConsole = false) => {
      renderBackupSummary();
      updateCloudUI();
      syncConsentLabel();
      refreshDiagConsoleUI();
      openModal("backupModal");
      if (scrollToConsole) {
        setTimeout(() => {
          document.getElementById("diagConsoleSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
          document.getElementById("btnDiagCopyAll")?.focus();
        }, 60);
      } else {
        const focusTarget = fbUser ? document.getElementById("btnCloudSyncNow") : document.getElementById("btnModalGoogleLogin");
        (focusTarget || document.getElementById("btnExportProgress"))?.focus();
      }
    };
    document.getElementById("btnBackup").addEventListener("click", () => openBackupModalWithDiag(false));
    document.getElementById("btnHomeOpenLogOut")?.addEventListener("click", () => openBackupModalWithDiag(true));
    document.getElementById("btnHomeOpenLogIn")?.addEventListener("click", () => openBackupModalWithDiag(true));
    document.getElementById("btnDiagTestCloud")?.addEventListener("click", () => runFullCloudAndAppDiagnostic());
    document.getElementById("btnDiagCopyAll")?.addEventListener("click", () => copyDiagnosticReportToClipboard());
    document.getElementById("btnDiagClear")?.addEventListener("click", () => {
      diagEvents = [];
      diagSeq = 0;
      saveDiagEvents();
      diagLog("CONSOLE", "Log svuotato dall'utente", summarizeStateForLog(state));
    });
    document.getElementById("btnHomeGoogleLogin")?.addEventListener("click", handleGoogleLogin);
    document.getElementById("btnModalGoogleLogin")?.addEventListener("click", handleGoogleLogin);
    document.getElementById("btnHomeCloudManage")?.addEventListener("click", () => openBackupModalWithDiag(false));
    document.getElementById("btnCloudSyncNow")?.addEventListener("click", () => {
      if (fbUser) pullAndMergeFromCloud(fbUser.uid, true);
    });
    document.getElementById("btnGoogleLogout")?.addEventListener("click", handleGoogleLogout);

    document.getElementById("closeBackupModal").addEventListener("click", closeAllModals);
    document.getElementById("backupModal").addEventListener("click", e => { if (e.target.id === "backupModal") closeAllModals(); });
    document.getElementById("btnImportProgress").addEventListener("click", () => {
      document.getElementById("inputImportProgress").click();
    });
    document.getElementById("btnExportProgress").addEventListener("click", () => {
      diagLog("BACKUP", "Esportazione file JSON locale avviata", summarizeStateForLog(state));
      // Strip ownerUid from exported JSON so sharing/importing on another account never triggers ownership wipe
      const exportObj = { ...normalizeStateObject(state), ownerUid: null };
      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `polinetwork_studio_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast("Backup esportato");
    });
    document.getElementById("inputImportProgress").addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        showToast("File troppo grande (max 2 MB)");
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => {
        diagLog("BACKUP-ERR", "Errore lettura file JSON", reader.error?.message || "read error");
        showToast("Impossibile leggere il file");
        e.target.value = "";
      };
      reader.onload = () => {
        try {
          const imp = JSON.parse(reader.result);
          if (!imp || typeof imp !== "object" || Array.isArray(imp)) throw new Error("Formato non valido");
          const hasKnownKeys = ["mastery", "bookmarks", "sm2", "quizStats", "quizMastered", "prefs"].some(k => k in imp);
          if (!hasKnownKeys) throw new Error("Il file non sembra un backup di PoliNetwork Studio");
          // Sanitize & neutralize ownerUid and resetAt so manual import merges safely without wiping local data
          const safeImp = normalizeStateObject(imp);
          safeImp.ownerUid = null;
          safeImp.resetAt = 0;
          const beforeSum = summarizeStateForLog(state);
          state = mergeCloudAndLocalState(state, safeImp);
          diagLog("BACKUP", `File JSON importato e unito (${file.name})`, `Prima=[${beforeSum}] → Dopo=[${summarizeStateForLog(state)}]`);
          saveState();
          applyFullStateToUI({ preserveActiveSession: false });
          closeAllModals();
          showToast("Progressi uniti e sincronizzati");
        } catch (err) {
          diagLog("BACKUP-ERR", "Errore importazione file JSON", err?.message || String(err));
          showToast("File JSON non valido");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    document.getElementById("btnResetAsk").addEventListener("click", () => document.getElementById("resetConfirmBox").classList.remove("hidden"));
    document.getElementById("btnResetCancel").addEventListener("click", () => document.getElementById("resetConfirmBox").classList.add("hidden"));
    document.getElementById("btnResetConfirm").addEventListener("click", () => {
      const theme = state.theme;
      const now = Date.now();
      state = normalizeStateObject({ ...defaultState(), theme, updatedAt: now, resetAt: now, ownerUid: fbUser?.uid || state.ownerUid || null });
      if (fbUser) {
        try { localStorage.removeItem(userMirrorKey(fbUser.uid)); } catch (_) {}
      }
      diagLog("RESET", "Progressi azzerati dall'utente", `resetAt=${new Date(now).toISOString()}`);
      saveState({ preserveTimestamp: true });
      applyFullStateToUI({ preserveActiveSession: false });
      closeAllModals();
      showToast("Progressi azzerati");
    });

    // Lightbox
    document.getElementById("closeLightbox").addEventListener("click", closeAllModals);
    document.getElementById("lightboxModal").addEventListener("click", e => { if (e.target.id === "lightboxModal") closeAllModals(); });
    document.getElementById("btnLbPrev").addEventListener("click", () => {
      if (lbGallery.length > 1) { lbIdx = (lbIdx - 1 + lbGallery.length) % lbGallery.length; updateLightbox(); }
    });
    document.getElementById("btnLbNext").addEventListener("click", () => {
      if (lbGallery.length > 1) { lbIdx = (lbIdx + 1) % lbGallery.length; updateLightbox(); }
    });

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", e => {
      if (activeTrapContainer) handleFocusTrap(e);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("btnSearchQuick").click();
        return;
      }
      if (e.key === "Escape") { closeAllModals(); closeTocDrawer(); closeFontPopover(); return; }
      if (!document.getElementById("lightboxModal").classList.contains("hidden")) {
        if (e.key === "ArrowLeft") document.getElementById("btnLbPrev").click();
        if (e.key === "ArrowRight") document.getElementById("btnLbNext").click();
        return;
      }
      // Never fire view-level shortcuts while any modal/drawer is open, with Ctrl/Cmd/Alt pressed, or inside form/interactive controls
      if (activeTrapContainer || e.ctrlKey || e.metaKey || e.altKey) return;
      const activeEl = document.activeElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(activeEl?.tagName)) return;
      const onInteractive = !!activeEl?.closest('button, a[href], summary, [role="button"], [role="tab"]');

      if (currentView === "practice" && practiceMode === "flashcards") {
        if (e.code === "Space" && !onInteractive) { e.preventDefault(); flipFlashcard(); }
        else if (e.key.toLowerCase() === "z" && fcLastAction) undoLastFlashcard();
        else if (fcFlipped) {
          if (e.key === "1") rateFlashcard(1);
          if (e.key === "2") rateFlashcard(3);
          if (e.key === "3") rateFlashcard(4);
          if (e.key === "4") rateFlashcard(5);
        }
      } else if (currentView === "practice" && practiceMode === "quiz" && !document.getElementById("quizBox").classList.contains("hidden")) {
        if (!qzAnswered) {
          const map = { a: 0, b: 1, c: 2, d: 3, "1": 0, "2": 1, "3": 2, "4": 3 };
          const k = e.key.toLowerCase();
          if (map[k] !== undefined && qzQueue[qzIdx]?.options[map[k]] !== undefined) handleQuizAnswer(map[k]);
        } else if ((e.key === "Enter" && !onInteractive) || e.key === "ArrowRight") {
          e.preventDefault();
          advanceQuizQuestion();
        }
      }
    });
  }

  init().catch(err => {
    diagLog("ERROR", "Errore fatale init()", err?.stack || err?.message || String(err));
    console.error("Init error:", err);
    document.getElementById("mainContent").innerHTML = `
      <div class="ios-container"><div class="apple-card">
        <h2>Errore di caricamento</h2>
        <p class="muted small" style="margin-top:0.5rem;">${esc(String(err))}</p>
      </div></div>`;
  });
})();
