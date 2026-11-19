(() => {
  "use strict";

  const STORAGE_KEY = "polinetwork_studylab_v1";

  let CORPUS = null;
  let PACK = null;
  let ALL_SECTIONS = [];
  let STUDYABLE_SECTIONS = [];
  let CLOZEABLE_SECTIONS = [];
  let SECTION_MAP = new Map();

  let state = loadState();
  let currentView = "overview";
  let readerDocFilter = "all";
  let readerStatusFilter = "all";
  let readerSecId = null;
  let readerMode = "read"; // "read" | "cloze"
  let returnStack = [];

  // Practice hub state
  let practiceMode = "flashcards";
  let practiceClozeSecId = null;

  // Active Cloze controller handles (separate recalled vs passively revealed!)
  let inlineClozeCtrl = null;
  let practiceClozeCtrl = null;

  // Flashcards state
  let fcQueue = [];
  let fcTotalSession = 0;
  let fcCompletedSession = 0;
  let fcFlipped = false;
  let fcLastAction = null;
  let fcCustomContext = null;

  // Quiz state
  let qzQueue = [];
  let qzIdx = 0;
  let qzCorrect = 0;
  let qzWrong = [];
  let qzAnswered = false;
  let qzCustomContext = null;

  // Reference & Lightbox state
  let csTab = "timeline";
  let lbGallery = [];
  let lbIdx = 0;

  // Search & Focus Trap state
  let gsResults = [];
  let gsActiveIdx = -1;
  let lastFocusedEl = null;
  let activeTrapContainer = null;

  const DOC_SHORT = { statuto: "Statuto", rri: "RRI", elettorale: "Elettorale" };
  const STATUS_LABELS = ["Da studiare", "In corso", "Imparato", "A memoria"];
  const MODE_LABELS = { all: "Tutte", blitz: "Blitz Numeri", mc: "Normativa", scenario: "Scenari" };

  const DIAGRAM_LABELS = {
    "21": "Allegato D — Modulo Candidatura Direttivo",
    "24": "Allegato G — Timeline dei Tempi (1/4)",
    "25": "Allegato G — Timeline dei Tempi (2/4)",
    "26": "Allegato G — Timeline dei Tempi (3/4)",
    "27": "Allegato G — Timeline dei Tempi (4/4)",
    "28": "Allegato H — Schema dello Scrutinio STV (1/2)",
    "29": "Allegato H — Schema dello Scrutinio STV (2/2)",
    "32": "Allegato K — Processo Elettorale per Attore (1/2)",
    "33": "Allegato K — Processo Elettorale per Attore (2/2)",
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

  // ==================== PERSISTENCE ====================
  function defaultState() {
    return {
      mastery: {},
      bookmarks: {},
      sm2: {},
      quizStats: { total: 0, correct: 0 },
      quizMastered: {},
      theme: "light",
      readerScale: 1,
      lastSecId: null,
      prefs: {
        highlightNums: true,
        clozeLevel: "1",
        clozeInputMode: "click",
        fcDeckMode: "curated",
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const def = defaultState();
        return {
          ...def,
          ...p,
          mastery: p.mastery || {},
          bookmarks: p.bookmarks || {},
          sm2: p.sm2 || {},
          quizStats: p.quizStats || { total: 0, correct: 0 },
          quizMastered: p.quizMastered || {},
          prefs: { ...def.prefs, ...(p.prefs || {}) },
        };
      }
    } catch (_) { /* ignore */ }
    return defaultState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* ignore */ }
  }

  // ==================== UTILITIES ====================
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’'“”".,;:()]/g, "").trim();
  }

  function showToast(msg, kind = "info") {
    const region = document.getElementById("toastRegion");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    region.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.2s";
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  function parseItalianDate(str) {
    const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:~)?(\d{1,2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const hour = m[4] !== undefined ? Number(m[4]) : 23;
    const min = m[5] !== undefined ? Number(m[5]) : (m[4] !== undefined ? 0 : 59);
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), hour, min, 0);
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

  function formatInterval(days) {
    if (days <= 0) return "Rivedi ora";
    return days === 1 ? "1 giorno" : `${days} giorni`;
  }

  // ==================== PURE SM-2 ENGINE ====================
  function computeNextSM2(prev, quality) {
    const base = prev || { reps: 0, interval: 0, ef: 2.5 };
    let { reps, interval, ef } = base;
    if (quality < 3) {
      reps = 0;
      interval = 0;
    } else {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 3;
      else interval = Math.round(interval * ef);
      if (quality === 5) interval = Math.max(interval, 6);
      reps++;
    }
    ef = Math.max(1.3, ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    return { reps, interval, ef: Number(ef.toFixed(2)), nextReview: Date.now() + interval * 86400000 };
  }

  // ==================== FOCUS TRAP (WCAG 2.2 AA) ====================
  function getFocusable(container) {
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }

  function handleFocusTrap(e) {
    if (e.key !== "Tab" || !activeTrapContainer) return;
    const focusables = getFocusable(activeTrapContainer);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ==================== INIT ====================
  async function init() {
    applyTheme(state.theme);
    applyReaderScale(state.readerScale);
    applySavedPrefsToControls();

    const [corpusRes, packRes] = await Promise.all([
      fetch("data/corpus.json"),
      fetch("data/study_pack.json"),
    ]);
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
    CLOZEABLE_SECTIONS = STUDYABLE_SECTIONS.filter(s => s.text.trim().length > 20 && s.id !== "el-b-1");

    readerSecId = (state.lastSecId && SECTION_MAP.has(state.lastSecId))
      ? state.lastSecId
      : (STUDYABLE_SECTIONS[0]?.id || ALL_SECTIONS[0]?.id);
    practiceClozeSecId = CLOZEABLE_SECTIONS[0]?.id || readerSecId;

    syncDynamicOptionLabels();
    populateFcTagFilter();
    populatePracticeClozeSecSelect(document.getElementById("clozeDocSelect").value);
    bindAllEvents();

    renderOverview();
    renderReaderSidebar();
    if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
    buildFcQueue(false);
    startQuiz();
    renderPracticeCloze();
    renderReference();

    applyRouteFromHash();
    window.addEventListener("hashchange", applyRouteFromHash);
    setInterval(renderDeadlineStrip, 60000);
  }

  function applySavedPrefsToControls() {
    const p = state.prefs;
    document.getElementById("toggleHighlightNums").checked = p.highlightNums !== false;
    document.getElementById("inlineClozeLevel").value = p.clozeLevel || "1";
    document.getElementById("clozeLevelSelect").value = p.clozeLevel || "1";
    document.getElementById("inlineClozeInput").value = p.clozeInputMode || "click";
    document.getElementById("clozeInputMode").value = p.clozeInputMode || "click";
    document.getElementById("fcDeckMode").value = p.fcDeckMode || "curated";
  }

  function syncDynamicOptionLabels() {
    const nCur = PACK.flashcards.length;
    const nArt = CLOZEABLE_SECTIONS.length;
    const deckSel = document.getElementById("fcDeckMode");
    deckSel.options[0].textContent = `Alta Resa (${nCur} schede)`;
    deckSel.options[1].textContent = `Tutti gli Articoli (${nArt} sezioni)`;
    deckSel.options[2].textContent = `Mazzo Completo (${nCur + nArt} schede)`;

    const nAll = PACK.quizzes.length;
    const nBlitz = PACK.quizzes.filter(q => q.mode === "blitz").length;
    const nMc = PACK.quizzes.filter(q => q.mode === "mc").length;
    const nScen = PACK.quizzes.filter(q => q.mode === "scenario").length;
    const qzSel = document.getElementById("qzModeFilter");
    qzSel.options[0].textContent = `Tutte le modalità (${nAll})`;
    qzSel.options[1].textContent = `Blitz Numeri & Quorum (${nBlitz})`;
    qzSel.options[2].textContent = `Normativa (${nMc})`;
    qzSel.options[3].textContent = `Scenari Pratici (${nScen})`;

    const cs = PACK.cheatsheet;
    const map = {
      quorums: `Quorum (${cs.quorums.length})`,
      organs: `Organi (${cs.organs.length})`,
      deadlines: `Scadenze (${cs.keyDeadlines.length})`,
    };
    document.querySelectorAll("#csTabs .rail-tab").forEach(t => {
      if (map[t.dataset.cs]) t.textContent = map[t.dataset.cs];
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0d1017" : "#f6f5f0");
    const icon = document.getElementById("iconTheme");
    if (icon) {
      icon.innerHTML = theme === "dark"
        ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  }

  function applyReaderScale(scale) {
    state.readerScale = Number(Math.max(0.85, Math.min(1.3, Number(scale) || 1)).toFixed(2));
    document.documentElement.style.setProperty("--reader-scale", state.readerScale);
  }

  // ==================== CROSS-VIEW SYNC & ROUTING ====================
  function syncAllViewsForStateChange(affectedSecId = null) {
    updateDueBadges();
    if (affectedSecId) {
      syncReaderSidebarDots();
      if (readerSecId === affectedSecId) {
        const cur = state.mastery[affectedSecId] || 0;
        document.querySelectorAll("#readerMasteryBtns .m-chip").forEach(b => {
          const act = Number(b.dataset.status) === cur;
          b.classList.toggle("active", act);
          b.setAttribute("aria-pressed", act ? "true" : "false");
        });
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
    currentView = viewName;

    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`)?.classList.add("active");

    document.querySelectorAll("#desktopNav .nav-tab, #mobileNav .bnav-btn").forEach(btn => {
      const act = btn.dataset.view === viewName;
      btn.classList.toggle("active", act);
      if (act) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });

    if (viewName === "overview") renderOverview();
    else if (viewName === "reader") syncReaderSidebarDots();
    else if (viewName === "practice") {
      populatePracticeClozeSecSelect(document.getElementById("clozeDocSelect").value);
    }

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
    document.querySelectorAll("#practiceModeSwitch .seg-btn").forEach(b => {
      const act = b.dataset.pmode === mode;
      b.classList.toggle("active", act);
      b.setAttribute("aria-selected", act ? "true" : "false");
    });
    ["flashcards", "quiz", "cloze"].forEach(m => {
      document.getElementById(`pane-${m}`).classList.toggle("hidden", m !== mode);
    });
    if (mode === "cloze") populatePracticeClozeSecSelect(document.getElementById("clozeDocSelect").value);
    if (!opts.skipHash && currentView === "practice") {
      setHash(`practice/${practiceMode}${practiceMode === "cloze" && practiceClozeSecId ? `/${practiceClozeSecId}` : ""}`);
    }
  }

  function applyRouteFromHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return;
    const [head, p1, p2] = raw.split("/");
    if (head === "overview" || head === "dashboard") {
      switchView("overview", { skipHash: true });
    } else if (head === "reader") {
      if (p1 && SECTION_MAP.has(p1)) openArticle(p1, { mode: p2 === "cloze" ? "cloze" : "read", skipHash: true });
      else switchView("reader", { skipHash: true });
    } else if (head === "practice") {
      switchPracticeMode(p1 || "flashcards", { skipHash: true });
      if (p1 === "cloze" && p2 && SECTION_MAP.has(p2)) openPracticeClozeArticle(p2, { skipHash: true });
      else switchView("practice", { skipHash: true });
    } else if (head === "reference" || head === "cheatsheet") {
      if (p1 && document.querySelector(`#csTabs .rail-tab[data-cs="${p1}"]`)) {
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
      showToast("Seleziona un articolo normativo.", "warn");
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

  // ==================== 1. PANORAMICA ====================
  function updateDueBadges() {
    const due = countDueCards("curated");
    document.getElementById("navDueBadge").textContent = due;
    document.getElementById("practiceDuePill").textContent = due;
    const mb = document.getElementById("mobileDueBadge");
    mb.textContent = due;
    mb.classList.toggle("hidden", due === 0);
    return due;
  }

  function renderDeadlineStrip() {
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
    const kicker = document.getElementById("deadlineKicker");
    const text = document.getElementById("deadlineText");
    const cd = document.getElementById("deadlineCountdown");
    const artBtn = document.getElementById("btnDeadlineArticle");

    if (nextItem) {
      const isElec = nextItem.date.startsWith("21/11/2026") && nextItem.event.includes("ASSEMBLEA");
      kicker.textContent = isElec ? "ASSEMBLEA ELETTIVA · 21/11/2026" : `PROSSIMA SCADENZA · ${nextItem.date}`;
      text.textContent = nextItem.event;
      cd.textContent = formatCountdown(nextItem.dt.getTime() - now);
      if (nextItem.ref && SECTION_MAP.has(nextItem.ref)) {
        artBtn.classList.remove("hidden");
        artBtn.onclick = () => openArticle(nextItem.ref, {
          returnTo: { type: "overview", label: "Panoramica", reason: "Scadenza elettorale" },
        });
      } else {
        artBtn.classList.add("hidden");
      }
    } else {
      kicker.textContent = "CRONOPROGRAMMA ELEZIONI 2026";
      text.textContent = "Tutte le scadenze del ciclo elettorale 2026 risultano concluse.";
      cd.textContent = "Concluso";
      artBtn.classList.add("hidden");
    }
  }

  function renderOverview() {
    let scoreSum = 0, nTodo = 0, nWip = 0, nLearned = 0, nMem = 0;
    let firstWipSec = null;
    for (const s of STUDYABLE_SECTIONS) {
      const m = state.mastery[s.id] || 0;
      scoreSum += m;
      if (m === 0) nTodo++;
      else if (m === 1) { nWip++; if (!firstWipSec) firstWipSec = s; }
      else if (m === 2) nLearned++;
      else nMem++;
    }
    const pct = Math.round((scoreSum / (STUDYABLE_SECTIONS.length * 3 || 1)) * 100);
    const due = updateDueBadges();
    const qzMast = Object.keys(state.quizMastered).filter(k => state.quizMastered[k]).length;
    const bmCount = Object.keys(state.bookmarks).filter(k => state.bookmarks[k] && SECTION_MAP.has(k)).length;

    document.getElementById("overviewEyebrow").textContent =
      `CORPUS UFFICIALE · 3 DOCUMENTI · ${STUDYABLE_SECTIONS.length} SEZIONI NORMATIVE`;
    document.getElementById("corpusTotalsMeta").textContent =
      `${CORPUS.documents.reduce((a, d) => a + d.pages, 0)} pagine · ${ALL_SECTIONS.length} voci d'indice`;

    document.getElementById("overallPct").textContent = `${pct}%`;
    const circ = 2 * Math.PI * 50;
    const ringEl = document.getElementById("overallRing");
    ringEl.style.strokeDashoffset = circ * (1 - pct / 100);
    ringEl.style.opacity = pct === 0 ? "0" : "1";

    document.getElementById("legMem").textContent = nMem;
    document.getElementById("legLearned").textContent = nLearned;
    document.getElementById("legWip").textContent = nWip;
    document.getElementById("legTodo").textContent = nTodo;

    const nextBtn = document.getElementById("btnNextBestAction");
    const nextLbl = document.getElementById("nextBestLabel");
    const advice = document.getElementById("briefingAdvice");
    const hasStarted = (nWip + nLearned + nMem > 0) || state.quizStats.total > 0 || Object.keys(state.sm2).length > 0;

    if (firstWipSec) {
      nextLbl.textContent = `Continua ${firstWipSec.code}`;
      advice.textContent = `Hai in corso «${firstWipSec.code} — ${firstWipSec.title}» (${DOC_SHORT[firstWipSec.doc]}). Riprendi la lettura o passa al testo a scomparsa per fissarlo a memoria.`;
      nextBtn.onclick = () => openArticle(firstWipSec.id);
    } else if (hasStarted && due > 0) {
      nextLbl.textContent = `Ripassa ${due} flashcards`;
      advice.textContent = `Hai ${due} schede pronte per il ripasso programmato oggi: rivederle ora rafforza la memoria a lungo termine.`;
      nextBtn.onclick = () => {
        document.getElementById("fcOnlyDue").checked = true;
        buildFcQueue(false);
        switchPracticeMode("flashcards");
        switchView("practice");
      };
    } else if (hasStarted) {
      nextLbl.textContent = "Apri Normativa";
      advice.textContent = `${nLearned + nMem} sezioni consolidate su ${STUDYABLE_SECTIONS.length} e ${qzMast}/${PACK.quizzes.length} domande quiz superate.`;
      nextBtn.onclick = () => openArticle(readerSecId || STUDYABLE_SECTIONS[0].id);
    } else {
      nextLbl.textContent = "Inizia dallo Statuto";
      advice.textContent = "Consulta il testo ufficiale con numeri e quorum evidenziati, esercitati con il testo a scomparsa sullo stesso articolo e consolida con flashcards e quiz.";
      nextBtn.onclick = () => openArticle(STUDYABLE_SECTIONS[0].id);
    }

    document.getElementById("statSections").textContent = `${nLearned + nMem} / ${STUDYABLE_SECTIONS.length}`;
    document.getElementById("statSectionsHint").textContent = `${nMem} a memoria · ${nWip} in corso`;

    document.getElementById("statDue").textContent = due;
    document.getElementById("statDueHint").textContent = `Su ${PACK.flashcards.length} chiave + ${CLOZEABLE_SECTIONS.length} articoli`;

    document.getElementById("statQuizMastered").textContent = `${qzMast} / ${PACK.quizzes.length}`;
    if (state.quizStats.total > 0) {
      const acc = Math.round((state.quizStats.correct / state.quizStats.total) * 100);
      document.getElementById("statQuizAcc").textContent = `Precisione storica ${acc}% (${state.quizStats.correct}/${state.quizStats.total})`;
    } else {
      document.getElementById("statQuizAcc").textContent = "0 risposte registrate";
    }

    document.getElementById("statBookmarks").textContent = bmCount;
    document.getElementById("statBookmarksHint").textContent = bmCount > 0
      ? "Apri gli articoli contrassegnati"
      : "Segna gli articoli chiave";

    renderDeadlineStrip();

    const listEl = document.getElementById("docList");
    listEl.innerHTML = "";
    for (const doc of CORPUS.documents) {
      const secs = doc.sections.filter(s => s.text && s.text.trim().length > 0);
      const dWip = secs.filter(s => (state.mastery[s.id] || 0) === 1).length;
      const dOk = secs.filter(s => (state.mastery[s.id] || 0) === 2).length;
      const dMem = secs.filter(s => (state.mastery[s.id] || 0) === 3).length;
      const dPct = Math.round(((dWip + dOk * 2 + dMem * 3) / (secs.length * 3 || 1)) * 100);
      const firstSec = secs[0]?.id;
      const firstCloze = secs.find(s => s.text.trim().length > 20 && s.id !== "el-b-1")?.id || firstSec;

      const row = document.createElement("div");
      row.className = "doc-row";
      row.innerHTML = `
        <div>
          <div class="doc-row-title">${esc(doc.title)}</div>
          <div class="doc-row-meta">${doc.pages} pagine · ${secs.length} sezioni normative · ${dMem} a memoria</div>
        </div>
        <div class="doc-row-prog">
          <div class="doc-prog-head"><span>Avanzamento</span><strong>${dPct}%</strong></div>
          <div class="stacked-bar">
            <div class="seg-mem" style="width:${(dMem / secs.length) * 100}%"></div>
            <div class="seg-ok" style="width:${(dOk / secs.length) * 100}%"></div>
            <div class="seg-wip" style="width:${(dWip / secs.length) * 100}%"></div>
          </div>
        </div>
        <div class="doc-row-actions">
          <button type="button" class="btn small secondary" data-doc-read="${doc.id}">Leggi</button>
          <button type="button" class="btn small secondary" data-doc-cloze="${firstCloze}">A memoria</button>
          <button type="button" class="btn small ghost" data-doc-quiz="${doc.id}">Quiz</button>
        </div>
      `;
      listEl.appendChild(row);
    }

    listEl.querySelectorAll("[data-doc-read]").forEach(b => {
      b.addEventListener("click", () => {
        const docId = b.dataset.docRead;
        readerDocFilter = docId;
        readerStatusFilter = "all";
        document.getElementById("readerStatusFilter").value = "all";
        syncReaderDocPills();
        renderReaderSidebar();
        const first = ALL_SECTIONS.find(s => s.doc === docId && s.text?.trim()) || ALL_SECTIONS.find(s => s.doc === docId);
        if (first) openArticle(first.id, { mode: "read" });
      });
    });
    listEl.querySelectorAll("[data-doc-cloze]").forEach(b => {
      b.addEventListener("click", () => openArticle(b.dataset.docCloze, { mode: "cloze" }));
    });
    listEl.querySelectorAll("[data-doc-quiz]").forEach(b => {
      b.addEventListener("click", () => {
        qzCustomContext = null;
        document.getElementById("qzDocFilter").value = b.dataset.docQuiz;
        document.getElementById("qzModeFilter").value = "all";
        document.getElementById("qzOnlyUnmastered").checked = false;
        startQuiz();
        switchPracticeMode("quiz");
        switchView("practice");
      });
    });
  }

  // ==================== 2. NORMATIVA (READER + INLINE A MEMORIA) ====================
  function syncReaderDocPills() {
    document.querySelectorAll("#readerDocPills .seg-btn").forEach(b => {
      const act = b.dataset.doc === readerDocFilter;
      b.classList.toggle("active", act);
      b.setAttribute("aria-selected", act ? "true" : "false");
    });
  }

  function syncReaderModeTabs() {
    const canCloze = CLOZEABLE_SECTIONS.some(s => s.id === readerSecId);
    const clozeTab = document.getElementById("tabInlineCloze");
    clozeTab.disabled = !canCloze;
    if (!canCloze) readerMode = "read";

    document.querySelectorAll("#readerModeSwitch .seg-btn").forEach(b => {
      const act = b.dataset.rmode === readerMode;
      b.classList.toggle("active", act);
      b.setAttribute("aria-selected", act ? "true" : "false");
    });
    document.getElementById("readerReadPane").classList.toggle("hidden", readerMode !== "read");
    document.getElementById("readerClozePane").classList.toggle("hidden", readerMode !== "cloze");
    document.getElementById("readOnlyTools").classList.toggle("hidden", readerMode !== "read");
    document.getElementById("btnSwitchInlineCloze").textContent =
      readerMode === "read" ? "Testo a scomparsa" : "Torna a Lettura";
  }

  function getFilteredReaderSections() {
    const q = (document.getElementById("readerSearch").value || "").trim().toLowerCase();
    return ALL_SECTIONS.filter(s => {
      if (readerDocFilter !== "all" && s.doc !== readerDocFilter) return false;
      const m = state.mastery[s.id] || 0;
      if (readerStatusFilter === "bookmarked" && !state.bookmarks[s.id]) return false;
      if (readerStatusFilter === "unstudied" && (!s.text || m !== 0)) return false;
      if (readerStatusFilter === "inprogress" && m !== 1) return false;
      if (readerStatusFilter === "memorized" && m !== 3) return false;
      if (!q) return true;
      return s.code.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || (s.text && s.text.toLowerCase().includes(q));
    });
  }

  function renderReaderSidebar() {
    const list = document.getElementById("readerTocList");
    const secs = getFilteredReaderSections();
    document.getElementById("readerMatchCount").textContent = `${secs.length}`;
    list.innerHTML = "";

    if (!secs.length) {
      list.innerHTML = `<p class="muted small" style="padding:1rem;">Nessun articolo corrisponde ai filtri attivi.</p>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const s of secs) {
      const m = state.mastery[s.id] || 0;
      const isContainer = !s.text || !s.text.trim();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.secId = s.id;
      btn.className = `toc-item lvl-${s.level} ${isContainer ? "is-group" : ""} ${s.id === readerSecId ? "active" : ""}`;
      btn.innerHTML = `
        <span class="${isContainer ? "dot" : `dot s${m}`}" aria-hidden="true"></span>
        <span class="toc-code">${esc(s.num || s.code)}</span>
        <span class="toc-title" title="${esc(s.title)}">${esc(s.title)}</span>
        ${state.bookmarks[s.id] ? '<span class="toc-star" aria-label="Segnalibro">★</span>' : ""}
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
        const dot = el.querySelector(".dot");
        if (dot) dot.className = `dot s${state.mastery[id] || 0}`;
      }
      const isBm = !!state.bookmarks[id];
      let star = el.querySelector(".toc-star");
      if (isBm && !star) {
        star = document.createElement("span");
        star.className = "toc-star";
        star.textContent = "★";
        el.appendChild(star);
      } else if (!isBm && star) {
        star.remove();
      }
      if (isTarget) el.scrollIntoView({ block: "nearest" });
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
    if (document.getElementById("toggleHighlightNums")?.checked) {
      const numPattern = /(\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}:\d{2}\b|€\s?\d+(?:,\d{2})?|\b\d+(?:,\d+)?\s*(?:giorni|giorno|ore|ora|mesi|mese|anni|anno|minuti|minuto|settimane|settimana|crediti|credito|ammonizioni|deleghe|seggi|membri|persone|candidati|semestri|semestre|volte)\b|\b(?:maggioranza assoluta|maggioranza semplice|unanimità|tre quarti|due terzi|un terzo|un sesto|metà più uno|⅔|½|⅙|3\/4|2\/3|1\/3|1\/2)\b|\b(?:trenta|novanta|sette|dieci|quindici|ventiquattro|quarantotto|cinque|sei|nove|dodici|quattro|tre|due)\s+(?:giorni|ore|mesi|anni|minuti|settimane|ammonizioni|deleghe|crediti)\b)/gi;
      html = html.replace(numPattern, '<span class="num-hl">$1</span>');
    }

    html = html.replace(/\b(articolo|art\.)\s+(A\.\d+(?:\.\d+)?)\b/gi, (m, _p1, code) => {
      const id = `el-${code.toLowerCase().replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
    });
    html = html.replace(/\b(articolo|art\.)\s+(\d{1,2})(?:\.\d+)?\b(?=[^.;]{0,45}\b(?:dello Statuto|del presente Statuto)\b)/gi, (m, _p1, num) => {
      const id = `statuto-art-${num}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
    });
    html = html.replace(/\b(articolo|art\.)\s+(\d+\.\d+(?:\.\d+)*)\b/gi, (m, _p1, code) => {
      const id = `rri-${code.replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
    });
    if (currentDoc === "statuto") {
      html = html.replace(/\b(articolo|art\.)\s+(\d{1,2})\b(?![^<]*<\/button>)/gi, (m, _p1, num) => {
        const id = `statuto-art-${num}`;
        return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
      });
    }
    return html;
  }

  function buildBreadcrumb(sec) {
    const parts = [DOC_SHORT[sec.doc] || sec.doc];
    const chain = [];
    let pId = sec.parent;
    while (pId && SECTION_MAP.has(pId)) {
      const p = SECTION_MAP.get(pId);
      chain.unshift(`${p.code} ${p.title}`);
      pId = p.parent;
    }
    return [...parts, ...chain].join(" › ");
  }

  function renderReaderArticle(secId, opts = {}) {
    const sec = SECTION_MAP.get(secId);
    if (!sec) return;
    readerSecId = secId;
    state.lastSecId = secId;
    saveState();

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
    document.getElementById("readerArtCode").textContent = sec.code;
    document.getElementById("mobileCurrentCode").textContent = sec.code;
    document.getElementById("readerArtPage").textContent = `Pag. ${sec.page}`;

    const words = sec.text ? sec.text.trim().split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(1, Math.ceil(words / 180));
    document.getElementById("readerReadTime").textContent = words ? `~${mins} min · ${words} parole` : "Indice sezione";
    document.getElementById("readerArtTitle").textContent = sec.title;

    document.getElementById("btnBookmarkSec").setAttribute("aria-pressed", state.bookmarks[sec.id] ? "true" : "false");

    const isStudyable = !!(sec.text && sec.text.trim().length > 0);
    document.getElementById("readerMasteryWrap").classList.toggle("hidden", !isStudyable);
    const curStatus = state.mastery[sec.id] || 0;
    document.querySelectorAll("#readerMasteryBtns .m-chip").forEach(b => {
      const act = Number(b.dataset.status) === curStatus;
      b.classList.toggle("active", act);
      b.setAttribute("aria-pressed", act ? "true" : "false");
    });

    const bodyEl = document.getElementById("readerArtBody");
    bodyEl.innerHTML = "";
    if (!isStudyable) {
      const children = ALL_SECTIONS.filter(s => s.parent === sec.id);
      const intro = document.createElement("p");
      intro.className = "muted small";
      intro.style.marginBottom = "0.75rem";
      intro.textContent = "Sezione strutturale. Seleziona un articolo o sottosezione:";
      bodyEl.appendChild(intro);
      for (const ch of children) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "prose-child-link";
        btn.innerHTML = `<span class="code-chip">${esc(ch.code)}</span><strong>${esc(ch.title)}</strong>`;
        btn.addEventListener("click", () => renderReaderArticle(ch.id));
        bodyEl.appendChild(btn);
      }
    } else if (sec.id === "el-b-1") {
      const pre = document.createElement("div");
      pre.className = "prose-block code-block";
      pre.textContent = sec.text;
      bodyEl.appendChild(pre);
    } else {
      for (const blk of sec.blocks) {
        const div = document.createElement("div");
        div.className = `prose-block ${blk.type}`;
        div.innerHTML = formatLegalText(blk.text, sec.doc);
        bodyEl.appendChild(div);
      }
    }

    bodyEl.querySelectorAll(".xref-link").forEach(btn => {
      btn.addEventListener("click", () => {
        openArticle(btn.dataset.jump, {
          returnTo: { type: "article", target: sec.id, label: `${sec.code} (${DOC_SHORT[sec.doc]})`, reason: "Rimando normativo" },
        });
      });
    });

    const imgWrap = document.getElementById("readerArtImages");
    imgWrap.innerHTML = "";
    if (sec.images && sec.images.length) {
      const gallery = sec.images.map(src => ({ src, cap: `${sec.code} — ${sec.title}` }));
      sec.images.forEach((src, i) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "pdf-card";
        card.innerHTML = `<img src="${src}" alt="Schema pagina PDF ${sec.code}" loading="lazy" /><div class="pdf-card-cap">Ingrandisci schema — ${src.split("/").pop()}</div>`;
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

    // Prev / Next skip empty structural container headings for smooth continuous reading!
    const filteredStudyable = getFilteredReaderSections().filter(s => s.text && s.text.trim().length > 0);
    const pool = filteredStudyable.some(s => s.id === secId) ? filteredStudyable : STUDYABLE_SECTIONS;
    const idx = pool.findIndex(s => s.id === secId);
    let prev = null, next = null;
    if (idx >= 0) {
      prev = idx > 0 ? pool[idx - 1] : null;
      next = idx < pool.length - 1 ? pool[idx + 1] : null;
    } else {
      // Currently on an empty container: next goes to first child article
      const allIdx = ALL_SECTIONS.findIndex(s => s.id === secId);
      for (let i = allIdx - 1; i >= 0; i--) if (ALL_SECTIONS[i].text?.trim()) { prev = ALL_SECTIONS[i]; break; }
      for (let i = allIdx + 1; i < ALL_SECTIONS.length; i++) if (ALL_SECTIONS[i].text?.trim()) { next = ALL_SECTIONS[i]; break; }
    }

    const btnPrev = document.getElementById("btnPrevSec");
    const btnNext = document.getElementById("btnNextSec");
    const btnMPrev = document.getElementById("btnMobilePrev");
    const btnMNext = document.getElementById("btnMobileNext");
    btnPrev.disabled = btnMPrev.disabled = !prev;
    btnNext.disabled = btnMNext.disabled = !next;
    btnPrev.dataset.target = btnMPrev.dataset.target = prev ? prev.id : "";
    btnNext.dataset.target = btnMNext.dataset.target = next ? next.id : "";
    document.getElementById("prevSecTitle").textContent = prev ? `${prev.code} · ${prev.title}` : "Inizio";
    document.getElementById("nextSecTitle").textContent = next ? `${next.code} · ${next.title}` : "Fine";
  }

  // ==================== EPISTEMICALLY HONEST CLOZE ENGINE ====================
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

  /**
   * Epistemically separates:
   * - recalled: actively typed without peek (type mode) OR individually self-checked (click mode)
   * - revealed: passively shown via "Suggerisci 1", "Mostra testo", or "?" peek
   * Never falsely claims recall or auto-promotes mastery when text is merely revealed!
   */
  function renderClozeInto({ secId, levelSel, modeSel, bodyEl, counterEl, barEl, noticeEl, onMasteryChange }) {
    const sec = SECTION_MAP.get(secId);
    if (!sec) return { hintOne: () => {}, revealAll: () => {} };
    const level = Number(levelSel.value);
    const mode = modeSel.value;

    bodyEl.innerHTML = "";
    noticeEl.classList.add("hidden");
    noticeEl.classList.remove("ok");

    const items = []; // [{ isDone, revealPassively }]
    let recalled = 0;
    let revealed = 0;
    let tokenIndex = 0;

    const updateProgress = () => {
      const total = items.length;
      const done = recalled + revealed;
      if (mode === "type") {
        counterEl.textContent = revealed > 0
          ? `Ricordate ${recalled}/${total} · Rivelate ${revealed}`
          : `Ricordate ${recalled}/${total}`;
      } else {
        counterEl.textContent = revealed > 0
          ? `${recalled} verificate · ${revealed} mostrate / ${total}`
          : `${recalled} / ${total}`;
      }
      barEl.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";

      if (total > 0 && done >= total) {
        if (recalled === 0) {
          // Pure passive reveal: do NOT claim completion or alter mastery!
          noticeEl.classList.remove("ok", "hidden");
          noticeEl.innerHTML = `
            <span><strong>Testo mostrato per la consultazione.</strong> Premi <em>Ricomincia</em> per metterti alla prova senza aiuti.</span>
            <div class="notice-actions">
              <button type="button" class="btn small secondary" data-clz-retry>Ricomincia</button>
            </div>
          `;
          noticeEl.querySelector("[data-clz-retry]").addEventListener("click", () => {
            renderClozeInto({ secId, levelSel, modeSel, bodyEl, counterEl, barEl, noticeEl, onMasteryChange });
          });
        } else {
          // Genuine active engagement -> safely promote unstudied (0) to In corso (1)
          if ((state.mastery[secId] || 0) === 0) {
            state.mastery[secId] = 1;
            saveState();
            syncAllViewsForStateChange(secId);
            if (onMasteryChange) onMasteryChange();
          }
          const recallPct = Math.round((recalled / total) * 100);
          noticeEl.classList.add("ok");
          noticeEl.classList.remove("hidden");
          const nextLvHtml = level < 4 ? `<button type="button" class="btn small secondary" data-clz-lvup>Livello ${level + 1}</button>` : "";
          const summaryMsg = mode === "type"
            ? `Ricordate ${recalled}/${total} parole (${recallPct}%)${revealed > 0 ? `, ${revealed} con suggerimento` : ""}.`
            : (revealed > 0
              ? `Verifica terminata (${recalled} scoperte singolarmente, ${revealed} mostrate).`
              : `Tutte le ${total} parti verificate.`);
          noticeEl.innerHTML = `
            <span><strong>Esercizio terminato.</strong> ${summaryMsg}</span>
            <div class="notice-actions">
              ${nextLvHtml}
              <button type="button" class="btn small primary" data-clz-mem>Segna A Memoria</button>
            </div>
          `;
          noticeEl.querySelector("[data-clz-lvup]")?.addEventListener("click", () => {
            levelSel.value = String(level + 1);
            state.prefs.clozeLevel = levelSel.value;
            saveState();
            renderClozeInto({ secId, levelSel, modeSel, bodyEl, counterEl, barEl, noticeEl, onMasteryChange });
          });
          noticeEl.querySelector("[data-clz-mem]")?.addEventListener("click", () => {
            state.mastery[secId] = 3;
            saveState();
            syncAllViewsForStateChange(secId);
            if (onMasteryChange) onMasteryChange();
            showToast(`${sec.code} segnato A MEMORIA.`, "ok");
          });
        }
      }
    };

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
        const m = tok.match(/^([^\p{L}\p{N}€]*)([\p{L}\p{N}€.,\/:%'-]+?)([^\p{L}\p{N}%]*)$/u);
        if (!m || !shouldBlankToken(m[2], level, tokenIndex)) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }
        const [, lead, core, trail] = m;
        if (lead) p.appendChild(document.createTextNode(lead));

        if (mode === "click") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cloze-blank";
          btn.textContent = level === 4 ? `${core[0]}${"·".repeat(Math.min(core.length - 1, 5))}` : `${core[0]}___`;
          btn.setAttribute("aria-label", `Scopri parola che inizia per ${core[0]}`);
          const entry = {
            done: false,
            revealPassively: () => {
              if (entry.done) return;
              entry.done = true;
              btn.classList.add("peeked");
              btn.textContent = core;
              btn.disabled = true;
              revealed++;
              updateProgress();
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
        } else {
          const wrap = document.createElement("span");
          wrap.className = "cloze-input-wrap";
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "cloze-input";
          inp.placeholder = `${core[0]}…`;
          inp.setAttribute("aria-label", `Scrivi parola che inizia per ${core[0]}`);
          inp.style.width = `${Math.max(68, Math.min(176, core.length * 9.5 + 18))}px`;

          const peek = document.createElement("button");
          peek.type = "button";
          peek.className = "cloze-peek";
          peek.textContent = "?";
          peek.title = "Mostra questa parola (conta come rivelata)";
          peek.setAttribute("aria-label", "Mostra questa parola");

          const entry = {
            done: false,
            revealPassively: () => {
              if (entry.done) return;
              entry.done = true;
              inp.classList.remove("bad");
              inp.classList.add("peeked");
              inp.value = core;
              inp.readOnly = true;
              peek.remove();
              revealed++;
              updateProgress();
              bodyEl.querySelector(".cloze-input:not([readonly])")?.focus();
            },
          };
          const markRecalled = () => {
            if (entry.done) return;
            entry.done = true;
            inp.classList.remove("bad");
            inp.classList.add("ok");
            inp.value = core;
            inp.readOnly = true;
            peek.remove();
            recalled++;
            updateProgress();
            bodyEl.querySelector(".cloze-input:not([readonly])")?.focus();
          };

          inp.addEventListener("input", () => {
            if (norm(inp.value) === norm(core)) markRecalled();
            else inp.classList.toggle("bad", inp.value.length >= core.length);
          });
          inp.addEventListener("keydown", e => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (norm(inp.value) === norm(core)) markRecalled();
              else inp.classList.add("bad");
            }
          });
          peek.addEventListener("click", entry.revealPassively);
          items.push(entry);
          wrap.appendChild(inp);
          wrap.appendChild(peek);
          p.appendChild(wrap);
        }
        if (trail) p.appendChild(document.createTextNode(trail));
      }
      bodyEl.appendChild(p);
    }

    if (items.length === 0) {
      noticeEl.classList.remove("hidden");
      noticeEl.innerHTML = `
        <span>Questa sezione non contiene numeri o termini chiave per il Livello 1.</span>
        <button type="button" class="btn small primary" data-jump-lv2>Passa al Livello 2</button>
      `;
      noticeEl.querySelector("[data-jump-lv2]").addEventListener("click", () => {
        levelSel.value = "2";
        state.prefs.clozeLevel = "2";
        saveState();
        renderClozeInto({ secId, levelSel, modeSel, bodyEl, counterEl, barEl, noticeEl, onMasteryChange });
      });
    }
    updateProgress();

    return {
      hintOne: () => {
        const next = items.find(it => !it.done);
        if (next) next.revealPassively();
      },
      revealAll: () => {
        for (const it of items) if (!it.done) it.revealPassively();
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
      noticeEl: document.getElementById("inlineClozeNotice"),
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
      opt.textContent = `[${STATUS_LABELS[m]}] ${s.code} — ${s.title}`;
      sel.appendChild(opt);
    }
    if (!secs.some(s => s.id === practiceClozeSecId) && secs.length) practiceClozeSecId = secs[0].id;
    sel.value = practiceClozeSecId;
  }

  function renderPracticeCloze() {
    const sec = SECTION_MAP.get(practiceClozeSecId);
    if (!sec) return;
    document.getElementById("pClozeCode").textContent = sec.code;
    document.getElementById("pClozeTitle").textContent = sec.title;

    const lv = document.getElementById("clozeLevelSelect").value;
    const im = document.getElementById("clozeInputMode").value === "click" ? "Tocca" : "Scrivi";
    document.getElementById("clozeQueueSummary").textContent = `${DOC_SHORT[sec.doc]} · ${sec.code} · Lv. ${lv} · ${im}`;

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
      noticeEl: document.getElementById("pClozeNotice"),
    });
  }

  // ==================== 3A. FLASHCARDS ====================
  function getArticleFlashcards() {
    return CLOZEABLE_SECTIONS.map(s => ({
      id: `auto-${s.id}`, doc: s.doc, ref: s.id,
      refLabel: `${DOC_SHORT[s.doc]} ${s.code}`,
      tag: "Articoli 1:1",
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

  function countDueCards(mode = "curated") {
    return getDeckCards(mode).filter(c => isCardDue(c.id)).length;
  }

  function populateFcTagFilter() {
    const sel = document.getElementById("fcTagFilter");
    const tags = Array.from(new Set(PACK.flashcards.map(c => c.tag))).sort();
    tags.push("Articoli 1:1");
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
  }

  function updateFcSummaryText() {
    const clearChip = document.getElementById("btnFcClearFocus");
    clearChip.classList.toggle("hidden", !fcCustomContext);
    if (fcCustomContext) {
      document.getElementById("fcActiveSummary").textContent = `Focus ${fcCustomContext} · ${fcTotalSession} schede`;
      return;
    }
    const modeNames = { curated: "Alta Resa", all_articles: "Articoli 1:1", combined: "Completo" };
    const mode = modeNames[document.getElementById("fcDeckMode").value];
    const docVal = document.getElementById("fcDocFilter").value;
    const docTxt = docVal === "all" ? "Tutti" : DOC_SHORT[docVal];
    const dueTxt = document.getElementById("fcOnlyDue").checked ? " · Solo oggi" : "";
    document.getElementById("fcActiveSummary").textContent = `${mode} · ${docTxt}${dueTxt} · ${fcTotalSession} schede`;
  }

  function buildFcQueue(shuffle = false, customCards = null, customLabel = null) {
    fcCustomContext = customLabel;
    const mode = document.getElementById("fcDeckMode").value;
    const docF = document.getElementById("fcDocFilter").value;
    const tagF = document.getElementById("fcTagFilter").value;
    const onlyDue = document.getElementById("fcOnlyDue").checked;

    let cards = customCards || getDeckCards(mode).filter(c => {
      if (docF !== "all" && c.doc !== docF) return false;
      if (tagF !== "all" && c.tag !== tagF) return false;
      if (onlyDue && !isCardDue(c.id)) return false;
      return true;
    });

    cards = cards.map(c => ({ ...c, _retry: false }));
    if (shuffle) {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }

    fcQueue = cards;
    fcTotalSession = cards.length;
    fcCompletedSession = 0;
    fcFlipped = false;
    fcLastAction = null;
    document.getElementById("btnFcUndo").classList.add("hidden");
    updateFcSummaryText();
    renderFlashcard();
  }

  function renderFlashcard() {
    const cardEl = document.getElementById("flashcardEl");
    const emptyEl = document.getElementById("fcEmptyState");
    const revealWrap = document.getElementById("fcRevealWrap");
    const ratingBar = document.getElementById("fcRatingBar");

    const pct = fcTotalSession > 0 ? Math.round((fcCompletedSession / fcTotalSession) * 100) : 100;
    document.getElementById("fcBarFill").style.width = `${pct}%`;

    if (!fcQueue.length) {
      cardEl.classList.add("hidden");
      revealWrap.classList.add("hidden");
      ratingBar.classList.add("hidden");
      emptyEl.classList.remove("hidden");

      const onlyDue = document.getElementById("fcOnlyDue").checked;
      document.getElementById("fcQueueInfo").textContent = fcTotalSession > 0 ? `Completate ${fcCompletedSession}/${fcTotalSession}` : "0 schede";
      document.getElementById("fcCardMeta").textContent = "Sessione conclusa";
      document.getElementById("fcEmptyTitle").textContent = fcTotalSession > 0 ? "Sessione completata" : "Nessuna scheda da ripassare oggi";
      document.getElementById("fcEmptyDesc").textContent = onlyDue
        ? "Sei in pari con il calendario di ripasso programmato per questi filtri."
        : "Modifica i filtri o avvia un nuovo ciclo.";
      document.getElementById("btnFcShowAll").classList.toggle("hidden", !onlyDue && !fcCustomContext);
      return;
    }

    cardEl.classList.remove("hidden");
    emptyEl.classList.add("hidden");

    const card = fcQueue[0];
    const rec = state.sm2[card.id];
    document.getElementById("fcQueueInfo").textContent = `Rimanenti: ${fcQueue.length} · Completate: ${fcCompletedSession}/${fcTotalSession}`;
    document.getElementById("fcCardMeta").textContent = !rec
      ? "Nuova scheda"
      : (rec.reps === 0 ? "Da rivedere in sessione" : `Rivista ${rec.reps} ${rec.reps === 1 ? "volta" : "volte"} · ${formatInterval(rec.interval)}`);

    document.getElementById("fcDocBadge").textContent = DOC_SHORT[card.doc] || card.doc;
    document.getElementById("fcTagBadge").textContent = card.tag;
    document.getElementById("fcRetryBadge").classList.toggle("hidden", !card._retry);
    document.getElementById("fcQuestion").textContent = card.q;
    document.getElementById("fcAnswer").textContent = card.a;
    document.getElementById("fcRefLabel").textContent = card.refLabel;

    document.getElementById("int1").textContent = "Rivedi ora";
    document.getElementById("int2").textContent = formatInterval(computeNextSM2(rec, 3).interval);
    document.getElementById("int3").textContent = formatInterval(computeNextSM2(rec, 4).interval);
    document.getElementById("int4").textContent = formatInterval(computeNextSM2(rec, 5).interval);

    fcFlipped = false;
    document.getElementById("fcBack").classList.add("hidden");
    ratingBar.classList.add("hidden");
    revealWrap.classList.remove("hidden");
  }

  function flipFlashcard() {
    if (!fcQueue.length || fcFlipped) return;
    fcFlipped = true;
    document.getElementById("fcBack").classList.remove("hidden");
    document.getElementById("fcRatingBar").classList.remove("hidden");
    document.getElementById("fcRevealWrap").classList.add("hidden");
  }

  function rateFlashcard(quality) {
    if (!fcQueue.length) return;
    const card = fcQueue.shift();
    const prevRec = state.sm2[card.id] ? { ...state.sm2[card.id] } : null;

    fcLastAction = { card, prevRec, prevCompleted: fcCompletedSession, queueSnapshot: [...fcQueue] };
    state.sm2[card.id] = computeNextSM2(prevRec, quality);
    saveState();
    updateDueBadges();

    if (quality < 3) {
      fcQueue.splice(Math.min(fcQueue.length, 3), 0, { ...card, _retry: true });
    } else {
      fcCompletedSession++;
    }
    document.getElementById("btnFcUndo").classList.remove("hidden");
    renderFlashcard();
  }

  function undoLastFlashcard() {
    if (!fcLastAction) return;
    const { card, prevRec, prevCompleted, queueSnapshot } = fcLastAction;
    if (prevRec) state.sm2[card.id] = prevRec;
    else delete state.sm2[card.id];
    saveState();
    updateDueBadges();
    fcQueue = [card, ...queueSnapshot];
    fcCompletedSession = prevCompleted;
    fcLastAction = null;
    document.getElementById("btnFcUndo").classList.add("hidden");
    renderFlashcard();
    showToast("Ultima valutazione annullata.");
  }

  // ==================== 3B. QUIZ & SCENARI ====================
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

  function updateQzSummaryText() {
    document.getElementById("btnQzClearFocus").classList.toggle("hidden", !qzCustomContext);
    if (qzCustomContext) {
      document.getElementById("qzActiveSummary").textContent = `Focus ${qzCustomContext} · ${qzQueue.length} domande`;
      return;
    }
    const modeTxt = MODE_LABELS[document.getElementById("qzModeFilter").value];
    const docVal = document.getElementById("qzDocFilter").value;
    const docTxt = docVal === "all" ? "Tutti" : DOC_SHORT[docVal];
    document.getElementById("qzActiveSummary").textContent = `${modeTxt} · ${docTxt} · ${qzQueue.length} domande`;
  }

  function startQuiz(customList = null, customLabel = null) {
    qzCustomContext = customLabel;
    const list = customList || getFilteredQuizPool();
    qzQueue = [...list].sort(() => Math.random() - 0.5);
    qzIdx = 0;
    qzCorrect = 0;
    qzWrong = [];
    qzAnswered = false;

    document.getElementById("btnRetryWrong").classList.add("hidden");
    document.getElementById("quizSummary").classList.add("hidden");
    updateQzSummaryText();
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    const qBox = document.getElementById("quizBox");
    const qEmpty = document.getElementById("quizEmptyState");

    if (!qzQueue.length) {
      qBox.classList.add("hidden");
      qEmpty.classList.remove("hidden");
      return;
    }
    qEmpty.classList.add("hidden");
    qBox.classList.remove("hidden");

    if (qzIdx >= qzQueue.length) {
      showQuizSummary();
      return;
    }

    const item = qzQueue[qzIdx];
    qzAnswered = false;
    document.getElementById("qzCounter").textContent = `Domanda ${qzIdx + 1} / ${qzQueue.length}`;
    document.getElementById("qzScoreLive").textContent = `${qzCorrect} esatte · ${qzWrong.length} errate`;
    document.getElementById("qzBarFill").style.width = `${(qzIdx / qzQueue.length) * 100}%`;

    document.getElementById("qzDocBadge").textContent = DOC_SHORT[item.doc] || item.doc;
    document.getElementById("qzModeBadge").textContent = MODE_LABELS[item.mode] || item.mode;
    document.getElementById("qzQuestion").textContent = item.q;

    const optsEl = document.getElementById("qzOptions");
    optsEl.innerHTML = "";
    item.options.forEach((txt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-opt";
      btn.innerHTML = `<span class="opt-key">${String.fromCharCode(65 + i)}</span><span>${esc(txt)}</span>`;
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
      if (i === item.correct) b.classList.add("correct");
      if (i === chosenIdx && i !== item.correct) b.classList.add("wrong");
    });

    const ok = chosenIdx === item.correct;
    state.quizStats.total++;
    if (ok) {
      qzCorrect++;
      state.quizStats.correct++;
      state.quizMastered[item.id] = true;
    } else {
      qzWrong.push(item);
      delete state.quizMastered[item.id];
    }
    saveState();

    document.getElementById("qzScoreLive").textContent = `${qzCorrect} esatte · ${qzWrong.length} errate`;
    const fb = document.getElementById("qzFeedback");
    fb.classList.toggle("ok", ok);
    fb.classList.toggle("bad", !ok);
    document.getElementById("qzFbTitle").textContent = ok ? "Risposta corretta" : "Risposta errata";
    document.getElementById("qzFbText").textContent = item.explanation;
    document.getElementById("qzRefLabel").textContent = item.refLabel;
    document.getElementById("btnQzSource").onclick = () => {
      openArticle(item.ref, {
        returnTo: { type: "practice", sub: "quiz", label: "Quiz in corso", reason: "Verifica fonte domanda" },
      });
    };
    document.getElementById("btnQzNext").textContent = qzIdx + 1 >= qzQueue.length ? "Vedi riepilogo →" : "Prossima →";
    fb.classList.remove("hidden");

    document.getElementById("btnRetryWrong").classList.toggle("hidden", qzWrong.length === 0);
    document.getElementById("wrongInlineCount").textContent = qzWrong.length;
  }

  function showQuizSummary() {
    document.getElementById("quizBox").classList.add("hidden");
    const sum = document.getElementById("quizSummary");
    sum.classList.remove("hidden");
    const pct = Math.round((qzCorrect / (qzQueue.length || 1)) * 100);
    document.getElementById("qzSumScore").textContent = `${qzCorrect} / ${qzQueue.length} (${pct}%)`;
    document.getElementById("qzSumMsg").textContent =
      pct >= 90 ? "Padronanza solida: questi punti sono ormai acquisiti." :
      pct >= 70 ? "Buona base: ripeti subito gli errori per completare la preparazione." :
      "Conviene rivedere gli articoli collegati agli errori qui sotto e ripetere.";

    const missed = document.getElementById("qzMissedList");
    missed.innerHTML = "";
    if (qzWrong.length) {
      missed.classList.remove("hidden");
      for (const w of qzWrong) {
        const row = document.createElement("div");
        row.className = "missed-row";
        row.innerHTML = `
          <span><strong>${esc(w.refLabel)}:</strong> ${esc(w.q)}</span>
          <button type="button" class="link-btn">Apri norma →</button>
        `;
        row.querySelector("button").addEventListener("click", () => {
          openArticle(w.ref, { returnTo: { type: "practice", sub: "quiz", label: "Riepilogo Quiz", reason: "Approfondimento errore" } });
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
    document.querySelectorAll("#csTabs .rail-tab").forEach(t => {
      const act = t.dataset.cs === csTab;
      t.classList.toggle("active", act);
      t.setAttribute("aria-selected", act ? "true" : "false");
    });
  }

  function renderReference() {
    const wrap = document.getElementById("csContent");
    const q = (document.getElementById("csSearch").value || "").trim().toLowerCase();
    const cs = PACK.cheatsheet;
    const match = obj => !q || JSON.stringify(obj).toLowerCase().includes(q);

    if (csTab === "timeline") {
      const now = Date.now();
      let markedNext = false;
      const rows = cs.timeline2026.filter(match);
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Data / Ora</th><th>Adempimento</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const dt = parseItalianDate(r.date);
              let cls = "", badge = "";
              if (r.date.startsWith("21/11/2026") && r.event.includes("ASSEMBLEA")) {
                cls = "tl-election"; badge = ' <span class="soft-tag warn">Assemblea</span>';
              } else if (dt && dt.getTime() < now) {
                cls = "tl-past";
              } else if (dt && !markedNext) {
                markedNext = true; cls = "tl-next"; badge = ' <span class="doc-tag">Prossima</span>';
              }
              return `<tr class="${cls}">
                <td data-label="Data / Ora"><span class="num-hl">${esc(r.date)}</span>${badge}</td>
                <td data-label="Adempimento">${esc(r.event)}</td>
                <td data-label="Fonte"><button type="button" class="link-btn" data-ref-jump="${r.ref}">Apri →</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessuna scadenza corrisponde a «${esc(q)}».</p>`;
    } else if (csTab === "quorums") {
      const rows = cs.quorums.filter(match);
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Organo / Seduta</th><th>Costitutivo</th><th>Deliberativo</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Organo / Seduta"><strong>${esc(r.context)}</strong></td>
              <td data-label="Costitutivo">${esc(r.costitutivo)}</td>
              <td data-label="Deliberativo">${esc(r.deliberativo)}</td>
              <td data-label="Fonte"><button type="button" class="link-btn" data-ref-jump="${r.ref}">Apri →</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun quorum trovato.</p>`;
    } else if (csTab === "organs") {
      const rows = cs.organs.filter(match);
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Organo / Carica</th><th>Composizione</th><th>Durata</th><th>Poteri Chiave</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Organo"><strong>${esc(r.name)}</strong></td>
              <td data-label="Composizione">${esc(r.composition)}</td>
              <td data-label="Durata">${esc(r.term)}</td>
              <td data-label="Poteri">${esc(r.powers)}</td>
              <td data-label="Fonte"><button type="button" class="link-btn" data-ref-jump="${r.ref}">Apri →</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun organo trovato.</p>`;
    } else if (csTab === "deadlines") {
      const rows = cs.keyDeadlines.filter(match);
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Istituto / Procedura</th><th>Termine / Regola</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Istituto"><strong>${esc(r.term)}</strong></td>
              <td data-label="Termine">${esc(r.value)}</td>
              <td data-label="Fonte"><button type="button" class="link-btn" data-ref-jump="${r.ref}">Apri →</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun termine trovato.</p>`;
    } else if (csTab === "hierarchy") {
      wrap.innerHTML = `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Grado</th><th>Fonte Normativa</th><th>Prevalenza &amp; Note</th></tr></thead>
          <tbody>
            ${cs.hierarchy.map(r => `<tr>
              <td data-label="Grado"><span class="code-chip">#${r.rank}</span></td>
              <td data-label="Fonte"><strong>${esc(r.source)}</strong></td>
              <td data-label="Note">${esc(r.note)} ${r.ref ? `<button type="button" class="link-btn" data-ref-jump="${r.ref}">Apri →</button>` : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        <div class="stv-box">
          <h3 class="section-title" style="font-size:1.08rem;">Sistema Elettorale STV — Sintesi Operativa (Art. A.16 – A.17)</h3>
          <div class="stv-formula">Quota di Droop = ⌊ schede_valide / (seggi + 1) ⌋ + 1</div>
          <p class="muted small" style="line-height:1.72;">
            <strong>Seggi disponibili (Art. A.17):</strong> &gt;6 candidati validi → 7 seggi · 5 o 6 candidati → 5 seggi · &lt;5 candidati → rinvio e riapertura (max 14 giorni).<br/>
            <strong>1ª Votazione (STV):</strong> Ogni scheda vale 1; calcoli esatti in frazione. Al raggiungimento della quota l'eccedenza passa al candidato successivo con fattore <code>(voti − quota) / voti</code>; altrimenti si esclude il meno votato.<br/>
            <strong>2ª Votazione (Cariche):</strong> Solo fra gli eletti della 1ª; STV a 1 seggio per posizione (quota = maggioranza assoluta) per l'ordine di assegnazione delle preferenze.<br/>
            <strong>Spareggio parità (Art. A.16.4):</strong> 1° Anzianità d'iscrizione → 2° Il più <strong>giovane</strong> → 3° Sorteggio pre-assemblea.
          </p>
        </div>`;
    } else if (csTab === "diagrams") {
      const elDoc = CORPUS.documents.find(d => d.id === "elettorale");
      const entries = Object.entries(elDoc?.visualPagesRendered || {})
        .map(([p, src]) => ({ p, src, cap: `${DIAGRAM_LABELS[p] || `Pagina ${p}`} (Pag. ${p})` }))
        .filter(item => !q || item.cap.toLowerCase().includes(q));
      wrap.innerHTML = entries.length ? `<div class="pdf-gallery">${entries.map((it, i) => `
        <button type="button" class="pdf-card" data-lb-idx="${i}">
          <img src="${it.src}" alt="${esc(it.cap)}" loading="lazy" />
          <div class="pdf-card-cap">${esc(it.cap)}</div>
        </button>
      `).join("")}</div>` : `<p class="muted">Nessuno schema trovato.</p>`;
      wrap.querySelectorAll("[data-lb-idx]").forEach(el => {
        el.addEventListener("click", () => openLightbox(entries, Number(el.dataset.lbIdx)));
      });
    }

    wrap.querySelectorAll("[data-ref-jump]").forEach(btn => {
      btn.addEventListener("click", () => {
        openArticle(btn.dataset.refJump, {
          returnTo: { type: "reference", sub: csTab, label: "Sinossi", reason: "Consultazione da Sinossi" },
        });
      });
    });
  }

  // ==================== MODALS, SEARCH & LIGHTBOX ====================
  function openModal(id) {
    lastFocusedEl = document.activeElement;
    const modal = document.getElementById(id);
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    activeTrapContainer = modal;
  }

  function closeAllModals() {
    let anyOpen = false;
    ["searchModal", "backupModal", "lightboxModal"].forEach(id => {
      const el = document.getElementById(id);
      if (!el.classList.contains("hidden")) {
        el.classList.add("hidden");
        anyOpen = true;
      }
    });
    document.getElementById("resetConfirmBox").classList.add("hidden");
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
    document.getElementById("lightboxImg").src = item.src;
    document.getElementById("lightboxCap").textContent = `${item.cap} (${lbIdx + 1}/${lbGallery.length})`;
    document.getElementById("btnLbPrev").disabled = lbGallery.length <= 1;
    document.getElementById("btnLbNext").disabled = lbGallery.length <= 1;
  }

  function renderGlobalSearch(query) {
    const res = document.getElementById("globalSearchResults");
    const q = query.trim().toLowerCase();
    gsResults = [];
    gsActiveIdx = -1;

    if (!q) {
      res.innerHTML = `<p class="muted small">Cerca un articolo, un quorum, una data (es. <em>20/11</em>, <em>Droop</em>, <em>delega</em>, <em>90 giorni</em>) su tutti i 3 documenti e le sinossi.</p>`;
      return;
    }

    const artMatches = ALL_SECTIONS
      .filter(s => s.code.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || (s.text && s.text.toLowerCase().includes(q)))
      .slice(0, 24)
      .map(s => {
        const pos = s.text ? s.text.toLowerCase().indexOf(q) : -1;
        let snip = s.text ? s.text.slice(0, 140) : "Sezione contenitore";
        if (pos >= 0) {
          const st = Math.max(0, pos - 48);
          snip = (st > 0 ? "…" : "") + s.text.slice(st, st + 160) + "…";
        }
        return { kind: "article", badge: DOC_SHORT[s.doc], code: s.code, title: s.title, snip, target: s.id };
      });

    const sinMatches = [];
    PACK.cheatsheet.quorums.forEach(r => {
      if (JSON.stringify(r).toLowerCase().includes(q)) {
        sinMatches.push({ kind: "reference", badge: "Sinossi", code: "Quorum", title: r.context, snip: `${r.costitutivo} · ${r.deliberativo}`, target: "quorums" });
      }
    });
    PACK.cheatsheet.timeline2026.forEach(r => {
      if (JSON.stringify(r).toLowerCase().includes(q)) {
        sinMatches.push({ kind: "reference", badge: "Sinossi", code: r.date, title: "Cronoprogramma 2026", snip: r.event, target: "timeline" });
      }
    });

    const combined = [...artMatches, ...sinMatches.slice(0, 6)];
    if (!combined.length) {
      res.innerHTML = `<p class="muted small">Nessun risultato per «${esc(query)}».</p>`;
      return;
    }

    gsResults = combined;
    gsActiveIdx = 0;
    res.innerHTML = "";
    combined.forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `sr-item ${idx === 0 ? "active" : ""}`;
      btn.innerHTML = `
        <div class="sr-item-head">
          <span class="doc-tag">${esc(item.badge)}</span>
          <span class="code-chip">${esc(item.code)}</span>
          <span>${esc(item.title)}</span>
        </div>
        <div class="sr-item-snip">${esc(item.snip)}</div>
      `;
      btn.addEventListener("click", () => executeSearchResult(item));
      res.appendChild(btn);
    });
  }

  function executeSearchResult(item) {
    closeAllModals();
    if (item.kind === "article") openArticle(item.target);
    else {
      csTab = item.target;
      syncCsTabs();
      renderReference();
      switchView("reference");
    }
  }

  function renderBackupSummary() {
    const studied = STUDYABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) >= 2).length;
    const mem = STUDYABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) === 3).length;
    const sm2Count = Object.keys(state.sm2).length;
    const bmCount = Object.keys(state.bookmarks).filter(k => state.bookmarks[k]).length;
    document.getElementById("backupSummary").textContent =
      `Consolidate: ${studied}/${STUDYABLE_SECTIONS.length} (${mem} a memoria) · Flashcards valutate: ${sm2Count} · Segnalibri: ${bmCount} · Risposte quiz: ${state.quizStats.total}`;
  }

  // ==================== EVENT WIRING ====================
  function bindAllEvents() {
    document.getElementById("brandHome").addEventListener("click", () => switchView("overview"));
    document.querySelectorAll("#desktopNav .nav-tab, #mobileNav .bnav-btn").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
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
    document.getElementById("metricNormativa").addEventListener("click", () => openArticle(readerSecId || STUDYABLE_SECTIONS[0].id));
    document.getElementById("metricFlashcards").addEventListener("click", () => { switchPracticeMode("flashcards"); switchView("practice"); });
    document.getElementById("metricQuiz").addEventListener("click", () => { switchPracticeMode("quiz"); switchView("practice"); });
    document.getElementById("metricBookmarks").addEventListener("click", () => {
      readerDocFilter = "all";
      syncReaderDocPills();
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

    // Reader controls & TOC Drawer
    document.getElementById("btnOpenTocDrawer").addEventListener("click", openTocDrawer);
    document.getElementById("btnCloseTocDrawer").addEventListener("click", closeTocDrawer);
    document.getElementById("tocBackdrop").addEventListener("click", closeTocDrawer);

    document.querySelectorAll("#readerDocPills .seg-btn").forEach(b => {
      b.addEventListener("click", () => {
        readerDocFilter = b.dataset.doc;
        syncReaderDocPills();
        renderReaderSidebar();
      });
    });
    document.getElementById("readerSearch").addEventListener("input", renderReaderSidebar);
    document.getElementById("readerStatusFilter").addEventListener("change", e => {
      readerStatusFilter = e.target.value;
      renderReaderSidebar();
    });

    // Inline Reader Mode Switch
    document.querySelectorAll("#readerModeSwitch .seg-btn").forEach(b => {
      b.addEventListener("click", () => {
        if (b.disabled) return;
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

    // Inline Cloze controls (synced preferences + true passive reveal handles!)
    document.getElementById("inlineClozeLevel").addEventListener("change", e => {
      state.prefs.clozeLevel = e.target.value;
      document.getElementById("clozeLevelSelect").value = e.target.value;
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

    document.getElementById("btnFontDec").addEventListener("click", () => { applyReaderScale(state.readerScale - 0.08); saveState(); });
    document.getElementById("btnFontInc").addEventListener("click", () => { applyReaderScale(state.readerScale + 0.08); saveState(); });
    document.getElementById("toggleHighlightNums").addEventListener("change", e => {
      state.prefs.highlightNums = e.target.checked;
      saveState();
      if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
    });
    document.getElementById("btnBookmarkSec").addEventListener("click", () => {
      if (!readerSecId) return;
      if (state.bookmarks[readerSecId]) { delete state.bookmarks[readerSecId]; showToast("Segnalibro rimosso."); }
      else { state.bookmarks[readerSecId] = true; showToast("Salvato nei segnalibri.", "ok"); }
      saveState();
      renderReaderArticle(readerSecId, { skipHash: true });
    });
    document.getElementById("btnContextReturn").addEventListener("click", () => {
      const top = returnStack.pop();
      if (!top) return;
      if (top.type === "article") renderReaderArticle(top.target);
      else if (top.type === "overview") switchView("overview");
      else if (top.type === "practice") { switchPracticeMode(top.sub || "flashcards"); switchView("practice"); }
      else if (top.type === "reference") { csTab = top.sub || "timeline"; syncCsTabs(); renderReference(); switchView("reference"); }
    });
    document.querySelectorAll("#readerMasteryBtns .m-chip").forEach(b => {
      b.addEventListener("click", () => {
        if (!readerSecId) return;
        const val = Number(b.dataset.status);
        state.mastery[readerSecId] = val;
        saveState();
        syncAllViewsForStateChange(readerSecId);
        showToast(`Stato aggiornato: ${STATUS_LABELS[val]}`, val >= 2 ? "ok" : "info");
      });
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

    ["btnPrevSec", "btnNextSec", "btnMobilePrev", "btnMobileNext"].forEach(id => {
      document.getElementById(id).addEventListener("click", e => {
        const target = e.currentTarget.dataset.target;
        if (target) {
          returnStack = [];
          renderReaderArticle(target);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });

    // Practice Hub Switcher & Filter Trays
    document.querySelectorAll("#practiceModeSwitch .seg-btn").forEach(b => {
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

    // Flashcards controls
    document.getElementById("fcDeckMode").addEventListener("change", e => {
      state.prefs.fcDeckMode = e.target.value;
      saveState();
      buildFcQueue(false);
    });
    ["fcDocFilter", "fcTagFilter", "fcOnlyDue"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => buildFcQueue(false));
    });
    document.getElementById("btnFcClearFocus").addEventListener("click", () => buildFcQueue(false));
    document.getElementById("btnFcShuffle").addEventListener("click", () => { buildFcQueue(true); showToast("Mazzo mescolato."); });
    document.getElementById("btnFcUndo").addEventListener("click", undoLastFlashcard);
    document.getElementById("flashcardEl").addEventListener("click", flipFlashcard);
    document.getElementById("btnFcReveal").addEventListener("click", flipFlashcard);
    document.getElementById("btnFcSource").addEventListener("click", e => {
      e.stopPropagation();
      const card = fcQueue[0];
      if (card?.ref) {
        openArticle(card.ref, {
          returnTo: { type: "practice", sub: "flashcards", label: "Flashcards", reason: "Verifica norma della scheda" },
        });
      }
    });
    document.querySelectorAll("#fcRatingBar .sm2-btn").forEach(b => {
      b.addEventListener("click", () => rateFlashcard(Number(b.dataset.q)));
    });
    document.getElementById("btnFcShowAll").addEventListener("click", () => {
      document.getElementById("fcOnlyDue").checked = false;
      buildFcQueue(false);
    });
    document.getElementById("btnFcRestartSession").addEventListener("click", () => buildFcQueue(true));

    // Quiz controls
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
    document.getElementById("btnRetryWrong").addEventListener("click", () => startQuiz([...qzWrong], "Ripasso errori"));
    document.getElementById("btnQzRetryWrong2").addEventListener("click", () => startQuiz([...qzWrong], "Ripasso errori"));
    document.getElementById("btnQzNext").addEventListener("click", () => { qzIdx++; renderQuizQuestion(); });

    // Practice Cloze controls
    document.getElementById("clozeDocSelect").addEventListener("change", e => {
      populatePracticeClozeSecSelect(e.target.value);
      renderPracticeCloze();
    });
    document.getElementById("clozeSecSelect").addEventListener("change", e => {
      practiceClozeSecId = e.target.value;
      renderPracticeCloze();
    });
    document.getElementById("clozeLevelSelect").addEventListener("change", e => {
      state.prefs.clozeLevel = e.target.value;
      document.getElementById("inlineClozeLevel").value = e.target.value;
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
      saveState();
      syncAllViewsForStateChange(practiceClozeSecId);
      showToast("Sezione segnata A MEMORIA.", "ok");
    });
    document.getElementById("btnPClozeOpenReader").addEventListener("click", () => {
      if (practiceClozeSecId) {
        openArticle(practiceClozeSecId, {
          returnTo: { type: "practice", sub: "cloze", label: "Testo a scomparsa", reason: "Consultazione articolo" },
        });
      }
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
      const pool = CLOZEABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) < 3 && s.id !== practiceClozeSecId);
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : CLOZEABLE_SECTIONS[0];
      if (pick) openPracticeClozeArticle(pick.id);
    });

    // Reference controls
    document.querySelectorAll("#csTabs .rail-tab").forEach(t => {
      t.addEventListener("click", () => {
        csTab = t.dataset.cs;
        syncCsTabs();
        renderReference();
        setHash(`reference/${csTab}`);
      });
    });
    document.getElementById("csSearch").addEventListener("input", renderReference);

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
    document.getElementById("globalSearchInput").addEventListener("input", e => renderGlobalSearch(e.target.value));
    document.getElementById("globalSearchInput").addEventListener("keydown", e => {
      if (!gsResults.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        gsActiveIdx = e.key === "ArrowDown" ? (gsActiveIdx + 1) % gsResults.length : (gsActiveIdx - 1 + gsResults.length) % gsResults.length;
        const els = document.querySelectorAll("#globalSearchResults .sr-item");
        els.forEach((el, i) => el.classList.toggle("active", i === gsActiveIdx));
        els[gsActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && gsActiveIdx >= 0) {
        e.preventDefault();
        executeSearchResult(gsResults[gsActiveIdx]);
      }
    });

    // Backup Modal (keyboard accessible import label + in-app reset confirm)
    document.getElementById("btnBackup").addEventListener("click", () => {
      renderBackupSummary();
      openModal("backupModal");
      document.getElementById("btnExportProgress").focus();
    });
    document.getElementById("closeBackupModal").addEventListener("click", closeAllModals);
    document.getElementById("backupModal").addEventListener("click", e => { if (e.target.id === "backupModal") closeAllModals(); });
    document.getElementById("lblImportProgress").addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        document.getElementById("inputImportProgress").click();
      }
    });
    document.getElementById("btnExportProgress").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `polinetwork_studylab_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("Backup JSON esportato.", "ok");
    });
    document.getElementById("inputImportProgress").addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imp = JSON.parse(reader.result);
          if (!imp || typeof imp !== "object") throw new Error("invalid");
          const def = defaultState();
          state = {
            ...def, ...imp,
            mastery: imp.mastery || {}, bookmarks: imp.bookmarks || {},
            sm2: imp.sm2 || {}, quizStats: imp.quizStats || { total: 0, correct: 0 },
            quizMastered: imp.quizMastered || {},
            prefs: { ...def.prefs, ...(imp.prefs || {}) },
          };
          saveState();
          applyTheme(state.theme);
          applyReaderScale(state.readerScale);
          applySavedPrefsToControls();
          renderOverview();
          renderReaderSidebar();
          if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
          buildFcQueue(false);
          startQuiz();
          closeAllModals();
          showToast("Progressi ripristinati.", "ok");
        } catch (_) {
          showToast("File JSON non valido.", "warn");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    document.getElementById("btnResetAsk").addEventListener("click", () => document.getElementById("resetConfirmBox").classList.remove("hidden"));
    document.getElementById("btnResetCancel").addEventListener("click", () => document.getElementById("resetConfirmBox").classList.add("hidden"));
    document.getElementById("btnResetConfirm").addEventListener("click", () => {
      const theme = state.theme;
      state = { ...defaultState(), theme };
      saveState();
      applySavedPrefsToControls();
      renderOverview();
      renderReaderSidebar();
      if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
      buildFcQueue(false);
      startQuiz();
      closeAllModals();
      showToast("Progressi azzerati.");
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

    // Global Keyboard Shortcuts & Focus Trap
    document.addEventListener("keydown", e => {
      if (activeTrapContainer) handleFocusTrap(e);

      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("btnSearchQuick").click();
        return;
      }
      if (e.key === "Escape") { closeAllModals(); closeTocDrawer(); return; }

      if (!document.getElementById("lightboxModal").classList.contains("hidden")) {
        if (e.key === "ArrowLeft") document.getElementById("btnLbPrev").click();
        if (e.key === "ArrowRight") document.getElementById("btnLbNext").click();
        return;
      }
      if (inInput) return;

      if (currentView === "practice" && practiceMode === "flashcards") {
        if (e.code === "Space") { e.preventDefault(); flipFlashcard(); }
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
        } else if (e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          qzIdx++;
          renderQuizQuestion();
        }
      }
    });
  }

  init().catch(err => {
    console.error("Init error:", err);
    document.getElementById("mainContent").innerHTML = `
      <div class="briefing-hero" style="display:block;">
        <h2>Errore di caricamento</h2>
        <p class="muted" style="margin-top:0.5rem;">Impossibile leggere i dati della normativa.</p>
        <pre style="margin-top:0.75rem;font-size:0.8rem;overflow:auto;">${esc(String(err))}</pre>
      </div>`;
  });
})();
