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
  let currentView = "dashboard";
  let readerDocFilter = "all";
  let readerStatusFilter = "all";
  let readerSecId = null;
  let xrefReturnStack = [];

  // Cloze state
  let clozeSecId = null;
  let clozeBlanksTotal = 0;
  let clozeBlanksRevealed = 0;

  // Flashcards state
  let fcQueue = [];
  let fcTotalSession = 0;
  let fcCompletedSession = 0;
  let fcFlipped = false;
  let fcLastAction = null;

  // Quiz state
  let qzQueue = [];
  let qzIdx = 0;
  let qzCorrect = 0;
  let qzWrong = [];
  let qzAnswered = false;

  // Cheatsheet & Lightbox state
  let csTab = "timeline";
  let lbGallery = [];
  let lbIdx = 0;

  // Global search keyboard navigation
  let gsResults = [];
  let gsActiveIdx = -1;
  let lastFocusedBeforeModal = null;

  const DOC_LABELS = {
    statuto: "Statuto",
    rri: "Regolamenti Interni (RRI)",
    elettorale: "Reg. Elettorale 2026",
  };

  const DOC_SHORT = {
    statuto: "Statuto",
    rri: "RRI",
    elettorale: "Elettorale",
  };

  const STATUS_LABELS = ["Da studiare", "In corso", "Imparato", "A memoria"];

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
      theme: "dark",
      readerScale: 1,
      lastSecId: null,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          ...defaultState(),
          ...p,
          mastery: p.mastery || {},
          bookmarks: p.bookmarks || {},
          sm2: p.sm2 || {},
          quizStats: p.quizStats || { total: 0, correct: 0 },
          quizMastered: p.quizMastered || {},
        };
      }
    } catch (_) { /* fallback to defaults */ }
    return defaultState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* ignore quota errors */ }
  }

  // ==================== UTILITIES ====================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeText(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'“”".,;:()]/g, "")
      .trim();
  }

  function showToast(message, variant = "info") {
    const region = document.getElementById("toastRegion");
    const toast = document.createElement("div");
    toast.className = `toast ${variant}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.2s";
      setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  function parseItalianDate(str) {
    // Supports "DD/MM/YYYY", "DD/MM/YYYY HH:MM", "21/11/2026 (~9-13)"
    const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:~)?(\d{1,2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    const hour = m[4] !== undefined ? Number(m[4]) : 23;
    const min = m[5] !== undefined ? Number(m[5]) : (m[4] !== undefined ? 0 : 59);
    return new Date(year, month, day, hour, min, 0);
  }

  function formatCountdown(ms) {
    if (ms <= 0) return "Scaduta";
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `Tra ${days}g ${hours}h`;
    if (hours > 0) return `Tra ${hours}h ${mins}m`;
    return `Tra ${Math.max(1, mins)} min`;
  }

  function formatIntervalLabel(days) {
    if (days <= 0) return "Rivedi ora";
    if (days === 1) return "1 giorno";
    return `${days} giorni`;
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
    return {
      reps,
      interval,
      ef: Number(ef.toFixed(2)),
      nextReview: Date.now() + interval * 86400000,
    };
  }

  // ==================== INIT ====================
  async function init() {
    applyTheme(state.theme);
    applyReaderScale(state.readerScale);

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
    clozeSecId = CLOZEABLE_SECTIONS[0]?.id || readerSecId;

    syncDynamicOptionLabels();
    populateFcTagFilter();
    populateClozeSecSelect(document.getElementById("clozeDocSelect").value);
    bindGlobalEvents();

    renderDashboard();
    renderReaderSidebar();
    if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
    renderCloze();
    buildFcQueue(false);
    startQuiz();
    renderCheatsheet();

    applyRouteFromHash();
    window.addEventListener("hashchange", applyRouteFromHash);
  }

  function syncDynamicOptionLabels() {
    const nCur = PACK.flashcards.length;
    const nArt = CLOZEABLE_SECTIONS.length;
    const deckSel = document.getElementById("fcDeckMode");
    deckSel.options[0].textContent = `Alta Resa (${nCur} schede chiave)`;
    deckSel.options[1].textContent = `Tutti gli Articoli (${nArt} sezioni 1:1)`;
    deckSel.options[2].textContent = `Mazzo Completo (${nCur + nArt} schede)`;

    const nAll = PACK.quizzes.length;
    const nBlitz = PACK.quizzes.filter(q => q.mode === "blitz").length;
    const nMc = PACK.quizzes.filter(q => q.mode === "mc").length;
    const nScen = PACK.quizzes.filter(q => q.mode === "scenario").length;
    const qzSel = document.getElementById("qzModeFilter");
    qzSel.options[0].textContent = `Tutte le modalità (${nAll})`;
    qzSel.options[1].textContent = `Blitz Numeri, Quorum & Scadenze (${nBlitz})`;
    qzSel.options[2].textContent = `Scelta Multipla Normativa (${nMc})`;
    qzSel.options[3].textContent = `Scenari Pratici & Casi Reali (${nScen})`;

    const cs = PACK.cheatsheet;
    const tabMap = {
      quorums: `Quorum (${cs.quorums.length})`,
      organs: `Organi (${cs.organs.length})`,
      deadlines: `Scadenze (${cs.keyDeadlines.length})`,
    };
    document.querySelectorAll("#csTabs .pill").forEach(p => {
      if (tabMap[p.dataset.cs]) p.textContent = tabMap[p.dataset.cs];
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#090e1a" : "#f4f6fa");
    const icon = document.getElementById("iconTheme");
    if (icon) {
      icon.innerHTML = theme === "dark"
        ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  }

  function applyReaderScale(scale) {
    const clamped = Math.max(0.85, Math.min(1.3, Number(scale) || 1));
    state.readerScale = Number(clamped.toFixed(2));
    document.documentElement.style.setProperty("--reader-scale", state.readerScale);
  }

  // ==================== ROUTING & NAVIGATION ====================
  function setHash(path) {
    const target = `#${path}`;
    if (location.hash !== target) {
      history.replaceState(null, "", target);
    }
  }

  function switchView(viewName, opts = {}) {
    const valid = ["dashboard", "reader", "cloze", "flashcards", "quiz", "cheatsheet"];
    if (!valid.includes(viewName)) viewName = "dashboard";
    currentView = viewName;

    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`)?.classList.add("active");

    document.querySelectorAll("#desktopNav .nav-item, #bottomNav .bnav-item").forEach(btn => {
      const isAct = btn.dataset.view === viewName;
      btn.classList.toggle("active", isAct);
      if (isAct) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });

    if (viewName === "dashboard") renderDashboard();
    if (!opts.skipHash) {
      if (viewName === "reader" && readerSecId) setHash(`reader/${readerSecId}`);
      else if (viewName === "cloze" && clozeSecId) setHash(`cloze/${clozeSecId}`);
      else if (viewName === "cheatsheet") setHash(`cheatsheet/${csTab}`);
      else setHash(viewName);
    }
    if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
  }

  function applyRouteFromHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return;
    const [view, param] = raw.split("/");
    if (view === "reader" && param && SECTION_MAP.has(param)) {
      openSectionInReader(param, { skipHash: true });
    } else if (view === "cloze" && param && SECTION_MAP.has(param)) {
      openSectionInCloze(param, { skipHash: true });
    } else if (view === "cheatsheet" && param) {
      const tabBtn = document.querySelector(`#csTabs .pill[data-cs="${param}"]`);
      if (tabBtn) {
        csTab = param;
        syncCsTabs();
        renderCheatsheet();
      }
      switchView("cheatsheet", { skipHash: true });
    } else if (["dashboard", "reader", "cloze", "flashcards", "quiz", "cheatsheet"].includes(view)) {
      switchView(view, { skipHash: true });
    }
  }

  function openSectionInReader(secId, opts = {}) {
    if (!SECTION_MAP.has(secId)) return;
    if (opts.fromXref && readerSecId && readerSecId !== secId) {
      xrefReturnStack.push(readerSecId);
    } else if (!opts.fromXref) {
      xrefReturnStack = [];
    }
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
    renderReaderSidebar();
    renderReaderArticle(secId, opts);
    switchView("reader", opts);
  }

  function openSectionInCloze(secId, opts = {}) {
    const sec = SECTION_MAP.get(secId);
    if (!sec || !CLOZEABLE_SECTIONS.some(s => s.id === secId)) {
      showToast("Questa sezione è un contenitore o codice sorgente: seleziona un articolo normativo.", "warn");
      return;
    }
    clozeSecId = secId;
    document.getElementById("clozeDocSelect").value = sec.doc;
    populateClozeSecSelect(sec.doc);
    document.getElementById("clozeSecSelect").value = secId;
    renderCloze();
    switchView("cloze", opts);
  }

  // ==================== DASHBOARD ====================
  function updateDueBadges() {
    const due = countDueCards("curated");
    document.getElementById("dueBadge").textContent = due;
    const mb = document.getElementById("mobileDueBadge");
    mb.textContent = due;
    mb.classList.toggle("hidden", due === 0);
    return due;
  }

  function renderDeadlineBanner() {
    const now = Date.now();
    const timeline = PACK.cheatsheet.timeline2026;
    let nextItem = null;
    for (const item of timeline) {
      const dt = parseItalianDate(item.date);
      if (dt && dt.getTime() > now) {
        nextItem = { ...item, dt };
        break;
      }
    }

    const eyebrow = document.getElementById("deadlineEyebrow");
    const title = document.getElementById("deadlineTitle");
    const cd = document.getElementById("deadlineCountdown");

    if (nextItem) {
      const isElection = nextItem.date.startsWith("21/11/2026") && nextItem.event.includes("ASSEMBLEA");
      eyebrow.textContent = isElection ? "ASSEMBLEA ELETTIVA IMMINENTE" : `PROSSIMA SCADENZA · ${nextItem.date}`;
      title.textContent = nextItem.event;
      cd.textContent = formatCountdown(nextItem.dt.getTime() - now);
    } else {
      eyebrow.textContent = "CRONOPROGRAMMA ELEZIONI 2026";
      title.textContent = "Tutte le scadenze del ciclo elettorale 2026 risultano concluse.";
      cd.textContent = "Archiviato";
    }
  }

  function renderDashboard() {
    let scoreSum = 0;
    let cWip = 0, cOk = 0, cMem = 0;
    for (const s of STUDYABLE_SECTIONS) {
      const m = state.mastery[s.id] || 0;
      scoreSum += m;
      if (m === 1) cWip++;
      else if (m === 2) cOk++;
      else if (m === 3) cMem++;
    }
    const maxScore = STUDYABLE_SECTIONS.length * 3 || 1;
    const pct = Math.round((scoreSum / maxScore) * 100);
    const masteredOrLearned = cOk + cMem;

    document.getElementById("heroEyebrow").textContent =
      `3 DOCUMENTI UFFICIALI · ${STUDYABLE_SECTIONS.length} SEZIONI NORMATIVE (${ALL_SECTIONS.length} VOCI D'INDICE)`;

    // Contextual primary CTA
    const lastSec = state.lastSecId ? SECTION_MAP.get(state.lastSecId) : null;
    const continueLabel = document.getElementById("btnHeroContinueLabel");
    if (lastSec && (cWip + cOk + cMem > 0)) {
      continueLabel.textContent = `Riprendi: ${lastSec.code}`;
    } else {
      continueLabel.textContent = "Inizia dallo Statuto";
    }

    document.getElementById("overallPct").textContent = `${pct}%`;
    const circ = 2 * Math.PI * 54;
    document.getElementById("overallRing").style.strokeDashoffset = circ * (1 - pct / 100);

    document.getElementById("heroBreakdown").innerHTML = `
      <span><i class="dot s3"></i>${cMem} mem.</span>
      <span><i class="dot s2"></i>${cOk} imp.</span>
      <span><i class="dot s1"></i>${cWip} corso</span>
    `;

    const dueCount = updateDueBadges();
    document.getElementById("kpiSecBadge").textContent = `${pct}%`;
    document.getElementById("statSections").textContent = `${masteredOrLearned} / ${STUDYABLE_SECTIONS.length}`;
    document.getElementById("statMemorized").textContent = `${cMem} a memoria · ${cWip} in corso`;

    document.getElementById("statDue").textContent = dueCount;
    document.getElementById("statCardsTotal").textContent =
      `Su ${PACK.flashcards.length} alta resa + ${CLOZEABLE_SECTIONS.length} articoli`;

    const qzMastCount = Object.keys(state.quizMastered).filter(id => state.quizMastered[id]).length;
    document.getElementById("kpiQzMastered").textContent = `${qzMastCount}/${PACK.quizzes.length}`;
    if (state.quizStats.total > 0) {
      const acc = Math.round((state.quizStats.correct / state.quizStats.total) * 100);
      document.getElementById("statQuizAcc").textContent = `${acc}%`;
      document.getElementById("statQuizDone").textContent = `${state.quizStats.correct}/${state.quizStats.total} risposte esatte`;
    } else {
      document.getElementById("statQuizAcc").textContent = "—";
      document.getElementById("statQuizDone").textContent = "0 risposte registrate";
    }

    const bmCount = Object.keys(state.bookmarks).filter(id => state.bookmarks[id] && SECTION_MAP.has(id)).length;
    document.getElementById("statBookmarks").textContent = bmCount;
    document.getElementById("statBookmarksSub").textContent = bmCount > 0
      ? "Clicca per aprire gli articoli salvati"
      : "Segna gli articoli chiave mentre leggi";

    document.getElementById("corpusStatsLabel").textContent =
      `${CORPUS.documents.reduce((a, d) => a + d.pages, 0)} pagine totali verificate`;

    renderDeadlineBanner();

    // Per-document cards
    const grid = document.getElementById("docCardsGrid");
    grid.innerHTML = "";
    for (const doc of CORPUS.documents) {
      const secs = doc.sections.filter(s => s.text && s.text.trim().length > 0);
      const nWip = secs.filter(s => (state.mastery[s.id] || 0) === 1).length;
      const nOk = secs.filter(s => (state.mastery[s.id] || 0) === 2).length;
      const nMem = secs.filter(s => (state.mastery[s.id] || 0) === 3).length;
      const dScore = nWip + nOk * 2 + nMem * 3;
      const dPct = Math.round((dScore / (secs.length * 3 || 1)) * 100);
      const firstCloze = secs.find(s => s.text.trim().length > 20 && s.id !== "el-b-1")?.id || secs[0]?.id;

      const card = document.createElement("div");
      card.className = "doc-card";
      card.innerHTML = `
        <div>
          <div class="doc-card-head">
            <div>
              <h3>${escapeHtml(doc.title)}</h3>
              <div class="doc-card-meta">${doc.pages} pagine · ${secs.length} sezioni normative · ${nMem} a memoria</div>
            </div>
            <span class="code-badge">${dPct}%</span>
          </div>
          <div class="stacked-bar" style="margin-top:0.75rem;" aria-label="Avanzamento ${dPct}%">
            <div class="seg-mem" style="width:${(nMem / secs.length) * 100}%"></div>
            <div class="seg-ok" style="width:${(nOk / secs.length) * 100}%"></div>
            <div class="seg-wip" style="width:${(nWip / secs.length) * 100}%"></div>
          </div>
        </div>
        <div class="doc-card-actions">
          <button type="button" class="btn small secondary" data-open-doc="${doc.id}">Leggi</button>
          <button type="button" class="btn small primary" data-cloze-doc="${firstCloze}">A Memoria</button>
          <button type="button" class="btn small ghost" data-quiz-doc="${doc.id}">Quiz</button>
        </div>
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll("[data-open-doc]").forEach(b => {
      b.addEventListener("click", () => {
        const docId = b.dataset.openDoc;
        readerDocFilter = docId;
        readerStatusFilter = "all";
        document.getElementById("readerStatusFilter").value = "all";
        syncReaderDocPills();
        renderReaderSidebar();
        const first = ALL_SECTIONS.find(s => s.doc === docId && s.text && s.text.trim()) || ALL_SECTIONS.find(s => s.doc === docId);
        if (first) renderReaderArticle(first.id);
        switchView("reader");
      });
    });
    grid.querySelectorAll("[data-cloze-doc]").forEach(b => {
      b.addEventListener("click", () => openSectionInCloze(b.dataset.clozeDoc));
    });
    grid.querySelectorAll("[data-quiz-doc]").forEach(b => {
      b.addEventListener("click", () => {
        document.getElementById("qzDocFilter").value = b.dataset.quizDoc;
        document.getElementById("qzModeFilter").value = "all";
        document.getElementById("qzOnlyUnmastered").checked = false;
        startQuiz();
        switchView("quiz");
      });
    });
  }

  // ==================== READER ====================
  function syncReaderDocPills() {
    document.querySelectorAll("#readerDocPills .pill").forEach(p => {
      const act = p.dataset.doc === readerDocFilter;
      p.classList.toggle("active", act);
      p.setAttribute("aria-selected", act ? "true" : "false");
    });
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
      return (
        s.code.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        (s.text && s.text.toLowerCase().includes(q))
      );
    });
  }

  function renderReaderSidebar() {
    const list = document.getElementById("readerTocList");
    const secs = getFilteredReaderSections();
    document.getElementById("readerMatchCount").textContent = `${secs.length} ${secs.length === 1 ? "voce" : "voci"}`;
    list.innerHTML = "";

    if (!secs.length) {
      list.innerHTML = `<p class="muted small-text" style="padding:1rem;">Nessun articolo corrisponde ai filtri attivi.</p>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const s of secs) {
      const m = state.mastery[s.id] || 0;
      const isContainer = !s.text || !s.text.trim();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.secId = s.id;
      btn.className = `toc-item lvl-${s.level} ${s.id === readerSecId ? "active" : ""}`;
      btn.innerHTML = `
        <span class="${isContainer ? "dot" : `dot s${m}`}" aria-hidden="true"></span>
        <span class="toc-code">${escapeHtml(s.num || s.code)}</span>
        <span class="toc-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
        ${state.bookmarks[s.id] ? '<span class="toc-star" aria-label="Segnalibro">★</span>' : ""}
      `;
      btn.addEventListener("click", () => {
        xrefReturnStack = [];
        renderReaderArticle(s.id);
        closeTocDrawer();
      });
      frag.appendChild(btn);
    }
    list.appendChild(frag);
  }

  function syncReaderSidebarSelection(secId) {
    const list = document.getElementById("readerTocList");
    const m = state.mastery[secId] || 0;
    const isBm = !!state.bookmarks[secId];
    list.querySelectorAll(".toc-item").forEach(el => {
      const isTarget = el.dataset.secId === secId;
      el.classList.toggle("active", isTarget);
      if (isTarget) {
        const dot = el.querySelector(".dot");
        const sec = SECTION_MAP.get(secId);
        if (dot && sec?.text?.trim()) dot.className = `dot s${m}`;
        let star = el.querySelector(".toc-star");
        if (isBm && !star) {
          star = document.createElement("span");
          star.className = "toc-star";
          star.textContent = "★";
          el.appendChild(star);
        } else if (!isBm && star) {
          star.remove();
        }
        el.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function openTocDrawer() {
    document.getElementById("readerSidebar").classList.add("open");
    document.getElementById("tocBackdrop").classList.remove("hidden");
    document.getElementById("btnOpenTocDrawer").setAttribute("aria-expanded", "true");
    document.getElementById("readerSearch").focus();
  }

  function closeTocDrawer() {
    document.getElementById("readerSidebar").classList.remove("open");
    document.getElementById("tocBackdrop").classList.add("hidden");
    document.getElementById("btnOpenTocDrawer").setAttribute("aria-expanded", "false");
  }

  function highlightNumbersAndRefs(rawText, currentDoc) {
    let html = escapeHtml(rawText);
    const hlNums = document.getElementById("toggleHighlightNums")?.checked;

    if (hlNums) {
      const numPattern = /(\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}:\d{2}\b|€\s?\d+(?:,\d{2})?|\b\d+(?:,\d+)?\s*(?:giorni|giorno|ore|ora|mesi|mese|anni|anno|minuti|minuto|settimane|settimana|crediti|credito|ammonizioni|deleghe|seggi|membri|persone|candidati|semestri|semestre|volte)\b|\b(?:maggioranza assoluta|maggioranza semplice|unanimità|tre quarti|due terzi|un terzo|un sesto|metà più uno|⅔|½|⅙|3\/4|2\/3|1\/3|1\/2)\b|\b(?:trenta|novanta|sette|dieci|quindici|ventiquattro|quarantotto|cinque|sei|nove|dodici|quattro|tre|due)\s+(?:giorni|ore|mesi|anni|minuti|settimane|ammonizioni|deleghe|crediti)\b)/gi;
      html = html.replace(numPattern, '<span class="num-hl">$1</span>');
    }

    // Elettorale A.x references
    html = html.replace(/\b(articolo|art\.)\s+(A\.\d+(?:\.\d+)?)\b/gi, (m, _p1, code) => {
      const id = `el-${code.toLowerCase().replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
    });

    // Statuto references written as "articolo 13.10 dello Statuto" or "articolo 9.4 dello Statuto"
    html = html.replace(/\b(articolo|art\.)\s+(\d{1,2})(?:\.\d+)?\b(?=[^.;]{0,45}\b(?:dello Statuto|del presente Statuto)\b)/gi, (m, _p1, num) => {
      const id = `statuto-art-${num}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
    });

    // RRI multi-dot references like "articolo 1.6.1.1"
    html = html.replace(/\b(articolo|art\.)\s+(\d+\.\d+(?:\.\d+)*)\b/gi, (m, _p1, code) => {
      const id = `rri-${code.replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
    });

    // Same-document Statuto plain "articolo 19"
    if (currentDoc === "statuto") {
      html = html.replace(/\b(articolo|art\.)\s+(\d{1,2})\b(?![^<]*<\/button>)/gi, (m, _p1, num) => {
        const id = `statuto-art-${num}`;
        return SECTION_MAP.has(id) ? `<button type="button" class="xref-link" data-jump="${id}">${m}</button>` : m;
      });
    }

    return html;
  }

  function buildBreadcrumb(sec) {
    const parts = [DOC_LABELS[sec.doc] || sec.doc];
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

    syncReaderSidebarSelection(secId);
    if (!opts.skipHash && currentView === "reader") setHash(`reader/${secId}`);

    // Cross-reference return chip
    const xrefBar = document.getElementById("xrefReturnBar");
    if (xrefReturnStack.length > 0) {
      const prevId = xrefReturnStack[xrefReturnStack.length - 1];
      const prevSec = SECTION_MAP.get(prevId);
      document.getElementById("xrefBackLabel").textContent = prevSec ? `${prevSec.code} (${DOC_SHORT[prevSec.doc]})` : "articolo precedente";
      xrefBar.classList.remove("hidden");
    } else {
      xrefBar.classList.add("hidden");
    }

    document.getElementById("readerBreadcrumb").textContent = buildBreadcrumb(sec);
    document.getElementById("readerArtCode").textContent = sec.code;
    document.getElementById("mobileCurrentCode").textContent = sec.code;
    document.getElementById("readerArtPage").textContent = `Pag. ${sec.page}`;

    const words = sec.text ? sec.text.trim().split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(1, Math.ceil(words / 180));
    document.getElementById("readerReadTime").textContent = words ? `~${mins} min · ${words} parole` : "Indice sezione";
    document.getElementById("readerArtTitle").textContent = sec.title;

    // Bookmark button
    const bmBtn = document.getElementById("btnBookmarkSec");
    bmBtn.setAttribute("aria-pressed", state.bookmarks[sec.id] ? "true" : "false");

    // Mastery buttons (hide on empty container sections)
    const isStudyable = !!(sec.text && sec.text.trim().length > 0);
    document.getElementById("readerMasteryWrap").classList.toggle("hidden", !isStudyable);
    const curStatus = state.mastery[sec.id] || 0;
    document.querySelectorAll("#readerMasteryBtns .m-btn").forEach(b => {
      const isAct = Number(b.dataset.status) === curStatus;
      b.classList.toggle("active", isAct);
      b.setAttribute("aria-pressed", isAct ? "true" : "false");
    });

    // Body
    const bodyEl = document.getElementById("readerArtBody");
    bodyEl.innerHTML = "";
    if (!isStudyable) {
      const children = ALL_SECTIONS.filter(s => s.parent === sec.id);
      const intro = document.createElement("p");
      intro.className = "muted";
      intro.style.marginBottom = "0.85rem";
      intro.textContent = "Sezione strutturale. Scegli un articolo o sottosezione qui sotto:";
      bodyEl.appendChild(intro);
      for (const ch of children) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "article-block";
        btn.style.width = "100%";
        btn.style.textAlign = "left";
        btn.style.cursor = "pointer";
        btn.innerHTML = `<span class="code-badge">${escapeHtml(ch.code)}</span> <strong>${escapeHtml(ch.title)}</strong>`;
        btn.addEventListener("click", () => renderReaderArticle(ch.id));
        bodyEl.appendChild(btn);
      }
    } else if (sec.id === "el-b-1") {
      const pre = document.createElement("div");
      pre.className = "article-block code-block";
      pre.textContent = sec.text;
      bodyEl.appendChild(pre);
    } else {
      for (const blk of sec.blocks) {
        const div = document.createElement("div");
        div.className = `article-block ${blk.type}`;
        div.innerHTML = highlightNumbersAndRefs(blk.text, sec.doc);
        bodyEl.appendChild(div);
      }
    }

    bodyEl.querySelectorAll(".xref-link").forEach(btn => {
      btn.addEventListener("click", () => openSectionInReader(btn.dataset.jump, { fromXref: true }));
    });

    // Diagrams / PDF pages
    const imgWrap = document.getElementById("readerArtImages");
    imgWrap.innerHTML = "";
    if (sec.images && sec.images.length) {
      const gallery = sec.images.map(src => ({ src, cap: `${sec.code} — ${sec.title}` }));
      sec.images.forEach((src, i) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "pdf-page-card";
        card.innerHTML = `<img src="${src}" alt="Schema pagina PDF ${sec.code}" loading="lazy" /><div class="pdf-page-cap">Ingrandisci schema — ${src.split("/").pop()}</div>`;
        card.addEventListener("click", () => openLightbox(gallery, i));
        imgWrap.appendChild(card);
      });
    }

    // Study bridge (Cloze + related flashcards)
    const bridge = document.getElementById("readerStudyBridge");
    const isClozeable = CLOZEABLE_SECTIONS.some(s => s.id === sec.id);
    const relatedFcs = PACK.flashcards.filter(c => c.ref === sec.id);
    bridge.classList.toggle("hidden", !isClozeable && relatedFcs.length === 0);
    document.getElementById("btnSendToCloze").classList.toggle("hidden", !isClozeable);
    const fcRelBtn = document.getElementById("btnArticleFlashcards");
    fcRelBtn.classList.toggle("hidden", relatedFcs.length === 0);
    document.getElementById("artFcCount").textContent = relatedFcs.length;

    // Prev / Next navigation (within current filtered list if present, else ALL_SECTIONS)
    const navList = getFilteredReaderSections();
    const pool = navList.some(s => s.id === secId) ? navList : ALL_SECTIONS;
    const idx = pool.findIndex(s => s.id === secId);
    const prev = idx > 0 ? pool[idx - 1] : null;
    const next = idx >= 0 && idx < pool.length - 1 ? pool[idx + 1] : null;

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

  // ==================== CLOZE / A MEMORIA ====================
  function populateClozeSecSelect(docId) {
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
    if (!secs.some(s => s.id === clozeSecId) && secs.length) {
      clozeSecId = secs[0].id;
    }
    sel.value = clozeSecId;
  }

  function shouldBlankToken(word, level, idx) {
    const clean = word.replace(/^[^\p{L}\p{N}€]+|[^\p{L}\p{N}%]+$/gu, "");
    if (!clean) return false;
    const low = clean.toLowerCase();

    const isNumOrKey =
      /\d/.test(clean) ||
      /^(trenta|novanta|sette|dieci|quindici|ventiquattro|quarantotto|cinque|sei|nove|dodici|quattro|tre|due|primo|seconda|terza|unanimità|assoluta|semplice|segreto|palese|decano|probiviri|direttivo|assemblea|presidente|vicepresidente|segretario|tesoriere|droop|delega|deleghe|ricorso|ricorsi|quorum|scadenza|proroga|incompatibili|decadenza|espulsione|ammonizioni)$/i.test(clean);

    if (level === 1) return isNumOrKey;
    if (level === 2) {
      if (isNumOrKey) return true;
      if (clean.length < 5 || STOPWORDS.has(low)) return false;
      return idx % 3 === 0;
    }
    if (level === 3) {
      if (isNumOrKey) return true;
      if (clean.length < 3 || STOPWORDS.has(low)) return false;
      return idx % 3 !== 1;
    }
    if (level === 4) return clean.length >= 2;
    return false;
  }

  function renderCloze() {
    const sec = SECTION_MAP.get(clozeSecId);
    if (!sec) return;
    const level = Number(document.getElementById("clozeLevelSelect").value);
    const mode = document.getElementById("clozeInputMode").value;

    document.getElementById("clozeCode").textContent = sec.code;
    document.getElementById("clozeTitle").textContent = sec.title;

    const body = document.getElementById("clozeBody");
    body.innerHTML = "";
    clozeBlanksTotal = 0;
    clozeBlanksRevealed = 0;

    let tokenIndex = 0;
    for (const blk of sec.blocks) {
      const p = document.createElement("div");
      p.className = "cloze-para";
      const tokens = blk.text.split(/(\s+)/);
      let paraWordIdx = 0;

      for (const tok of tokens) {
        if (/^\s+$/.test(tok)) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }
        tokenIndex++;
        paraWordIdx++;
        // Never blank leading comma/subitem index (e.g. "1.", "2.", "(a)")
        if (paraWordIdx === 1 && (/^\d+\.$/.test(tok) || /^\([a-z]\)$/.test(tok))) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }
        const match = tok.match(/^([^\p{L}\p{N}€]*)([\p{L}\p{N}€.,\/:%'-]+?)([^\p{L}\p{N}%]*)$/u);
        if (!match || !shouldBlankToken(match[2], level, tokenIndex)) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }

        const [, lead, core, trail] = match;
        if (lead) p.appendChild(document.createTextNode(lead));

        clozeBlanksTotal++;
        if (mode === "click") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cloze-blank";
          btn.dataset.answer = core;
          btn.textContent = level === 4 ? `${core[0]}${"·".repeat(Math.min(core.length - 1, 5))}` : `${core[0]}___`;
          btn.setAttribute("aria-label", `Rivela parola che inizia per ${core[0]}`);
          btn.addEventListener("click", () => {
            if (!btn.classList.contains("revealed")) {
              btn.classList.add("revealed");
              btn.textContent = core;
              btn.disabled = true;
              clozeBlanksRevealed++;
              updateClozeProgress();
            }
          });
          p.appendChild(btn);
        } else {
          const wrap = document.createElement("span");
          wrap.className = "cloze-input-wrap";
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "cloze-input";
          inp.dataset.answer = core;
          inp.placeholder = `${core[0]}…`;
          inp.setAttribute("aria-label", `Completa parola che inizia per ${core[0]}`);
          inp.style.width = `${Math.max(70, Math.min(180, core.length * 9.5 + 18))}px`;

          const peek = document.createElement("button");
          peek.type = "button";
          peek.className = "cloze-peek";
          peek.textContent = "?";
          peek.title = "Rivela questa parola";
          peek.setAttribute("aria-label", "Rivela questa parola");

          const markSolved = () => {
            if (inp.classList.contains("ok")) return;
            inp.classList.remove("bad");
            inp.classList.add("ok");
            inp.value = core;
            inp.readOnly = true;
            peek.remove();
            clozeBlanksRevealed++;
            updateClozeProgress();
            // Auto-focus next unsolved input
            const nextInp = body.querySelector(".cloze-input:not(.ok)");
            if (nextInp) nextInp.focus();
          };

          inp.addEventListener("input", () => {
            if (normalizeText(inp.value) === normalizeText(core)) {
              markSolved();
            } else if (inp.value.length >= core.length) {
              inp.classList.add("bad");
            } else {
              inp.classList.remove("bad");
            }
          });
          inp.addEventListener("keydown", e => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (normalizeText(inp.value) === normalizeText(core)) markSolved();
              else inp.classList.add("bad");
            }
          });
          peek.addEventListener("click", markSolved);

          wrap.appendChild(inp);
          wrap.appendChild(peek);
          p.appendChild(wrap);
        }

        if (trail) p.appendChild(document.createTextNode(trail));
      }
      body.appendChild(p);
    }

    // Handle 0 blanks on Level 1 gracefully
    const emptyBanner = document.getElementById("clozeEmptyBanner");
    if (clozeBlanksTotal === 0) {
      emptyBanner.innerHTML = `
        <span>Questa sezione non contiene numeri o termini chiave per il Livello 1.</span>
        <button type="button" class="btn small primary" id="btnJumpLv2">Passa al Livello 2</button>
      `;
      emptyBanner.classList.remove("hidden");
      document.getElementById("btnJumpLv2").addEventListener("click", () => {
        document.getElementById("clozeLevelSelect").value = "2";
        renderCloze();
      });
    } else {
      emptyBanner.classList.add("hidden");
    }

    // Prev / Next buttons
    const cIdx = CLOZEABLE_SECTIONS.findIndex(s => s.id === clozeSecId);
    document.getElementById("btnClozePrev").disabled = cIdx <= 0;
    document.getElementById("btnClozeNext").disabled = cIdx >= CLOZEABLE_SECTIONS.length - 1;

    updateClozeProgress();
  }

  function updateClozeProgress() {
    document.getElementById("clozeCounter").textContent = `${clozeBlanksRevealed} / ${clozeBlanksTotal}`;
    const pct = clozeBlanksTotal > 0 ? Math.round((clozeBlanksRevealed / clozeBlanksTotal) * 100) : 0;
    document.getElementById("clozeBarFill").style.width = `${pct}%`;

    const doneBanner = document.getElementById("clozeDoneBanner");
    const isDone = clozeBlanksTotal > 0 && clozeBlanksRevealed >= clozeBlanksTotal;
    doneBanner.classList.toggle("hidden", !isDone);
    if (isDone) {
      const lv = Number(document.getElementById("clozeLevelSelect").value);
      const lvBtn = document.getElementById("btnClozeLevelUp");
      lvBtn.classList.toggle("hidden", lv >= 4);
      document.getElementById("clozeDoneHint").textContent = lv < 4
        ? `Ottimo! Prova ora il Livello ${lv + 1} per fissare la norma ancora più a fondo.`
        : "Livello 4 completato: puoi segnare questa sezione come imparata a memoria!";
    }
  }

  // ==================== FLASHCARDS (SM-2) ====================
  function getArticleFlashcards() {
    return CLOZEABLE_SECTIONS.map(s => ({
      id: `auto-${s.id}`,
      doc: s.doc,
      ref: s.id,
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

  function isCardDue(cardId) {
    const rec = state.sm2[cardId];
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

  function buildFcQueue(shuffle = false, customCards = null) {
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
      document.getElementById("fcQueueInfo").textContent =
        fcTotalSession > 0 ? `Completate ${fcCompletedSession} / ${fcTotalSession}` : "0 carte";
      document.getElementById("fcCardMeta").textContent = "Sessione conclusa";
      document.getElementById("fcEmptyTitle").textContent =
        fcTotalSession > 0 ? "Ottimo lavoro! Sessione completata" : "Nessuna carta da ripassare";
      document.getElementById("fcEmptyDesc").textContent = onlyDue
        ? "Sei in pari con il calendario SM-2 per questi filtri."
        : "Modifica i filtri o ricomincia la sessione.";
      document.getElementById("btnFcShowAll").classList.toggle("hidden", !onlyDue);
      return;
    }

    cardEl.classList.remove("hidden");
    emptyEl.classList.add("hidden");

    const card = fcQueue[0];
    const rec = state.sm2[card.id];
    document.getElementById("fcQueueInfo").textContent =
      `Rimanenti: ${fcQueue.length} · Completate: ${fcCompletedSession}/${fcTotalSession}`;
    document.getElementById("fcCardMeta").textContent = rec
      ? `Ripetizioni: ${rec.reps} · Int. ${rec.interval}g`
      : "Nuova scheda";

    document.getElementById("fcDocBadge").textContent = DOC_LABELS[card.doc] || card.doc;
    document.getElementById("fcTagBadge").textContent = card.tag;
    document.getElementById("fcRetryBadge").classList.toggle("hidden", !card._retry);
    document.getElementById("fcQuestion").textContent = card.q;
    document.getElementById("fcAnswer").textContent = card.a;
    document.getElementById("fcRefLabel").textContent = card.refLabel;

    // Live exact SM-2 interval previews
    document.getElementById("int1").textContent = "Rivedi ora";
    document.getElementById("int2").textContent = formatIntervalLabel(computeNextSM2(rec, 3).interval);
    document.getElementById("int3").textContent = formatIntervalLabel(computeNextSM2(rec, 4).interval);
    document.getElementById("int4").textContent = formatIntervalLabel(computeNextSM2(rec, 5).interval);

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

    fcLastAction = {
      card,
      prevRec,
      wasFailed: quality < 3,
      prevCompleted: fcCompletedSession,
      queueSnapshot: [...fcQueue],
    };

    state.sm2[card.id] = computeNextSM2(prevRec, quality);
    saveState();
    updateDueBadges();

    if (quality < 3) {
      const insertAt = Math.min(fcQueue.length, 3);
      fcQueue.splice(insertAt, 0, { ...card, _retry: true });
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

  // ==================== QUIZ ====================
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

  function startQuiz(customList = null) {
    const list = customList || getFilteredQuizPool();
    qzQueue = [...list].sort(() => Math.random() - 0.5);
    qzIdx = 0;
    qzCorrect = 0;
    qzWrong = [];
    qzAnswered = false;

    document.getElementById("btnRetryWrong").classList.add("hidden");
    document.getElementById("quizSummary").classList.add("hidden");
    document.getElementById("quizBox").classList.remove("hidden");
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    if (!qzQueue.length) {
      document.getElementById("qzCounter").textContent = "0 domande";
      document.getElementById("qzScoreLive").textContent = "—";
      document.getElementById("qzBarFill").style.width = "100%";
      document.getElementById("qzQuestion").textContent =
        "Nessuna domanda da completare con questi filtri (hai già consolidato tutto in questa categoria!).";
      document.getElementById("qzOptions").innerHTML = "";
      document.getElementById("qzFeedback").classList.add("hidden");
      return;
    }
    if (qzIdx >= qzQueue.length) {
      showQuizSummary();
      return;
    }

    const item = qzQueue[qzIdx];
    qzAnswered = false;
    document.getElementById("qzCounter").textContent = `Domanda ${qzIdx + 1} / ${qzQueue.length}`;
    document.getElementById("qzScoreLive").textContent = `Corrette: ${qzCorrect} · Errate: ${qzWrong.length}`;
    document.getElementById("qzBarFill").style.width = `${(qzIdx / qzQueue.length) * 100}%`;

    document.getElementById("qzDocBadge").textContent = DOC_LABELS[item.doc] || item.doc;
    const modeNames = { blitz: "Blitz Numeri & Quorum", mc: "Normativa", scenario: "Scenario Pratico" };
    document.getElementById("qzModeBadge").textContent = modeNames[item.mode] || item.mode;
    document.getElementById("qzQuestion").textContent = item.q;

    const optsEl = document.getElementById("qzOptions");
    optsEl.innerHTML = "";
    item.options.forEach((optText, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-opt";
      btn.innerHTML = `<span class="quiz-opt-key">${String.fromCharCode(65 + i)}</span><span>${escapeHtml(optText)}</span>`;
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
    const buttons = document.querySelectorAll("#qzOptions .quiz-opt");
    buttons.forEach((b, i) => {
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

    document.getElementById("qzScoreLive").textContent = `Corrette: ${qzCorrect} · Errate: ${qzWrong.length}`;
    const fb = document.getElementById("qzFeedback");
    fb.classList.toggle("ok", ok);
    fb.classList.toggle("bad", !ok);
    document.getElementById("qzFbTitle").textContent = ok ? "Risposta corretta" : "Risposta errata";
    document.getElementById("qzFbText").textContent = item.explanation;
    document.getElementById("qzRefLabel").textContent = item.refLabel;
    document.getElementById("btnQzSource").onclick = () => openSectionInReader(item.ref);
    document.getElementById("btnQzNext").textContent = qzIdx + 1 >= qzQueue.length ? "Vedi riepilogo →" : "Prossima domanda →";
    fb.classList.remove("hidden");

    const retryBtn = document.getElementById("btnRetryWrong");
    retryBtn.classList.toggle("hidden", qzWrong.length === 0);
    document.getElementById("wrongInlineCount").textContent = qzWrong.length;
  }

  function showQuizSummary() {
    document.getElementById("quizBox").classList.add("hidden");
    const sum = document.getElementById("quizSummary");
    sum.classList.remove("hidden");
    const pct = Math.round((qzCorrect / (qzQueue.length || 1)) * 100);
    document.getElementById("qzSumScore").textContent = `${qzCorrect} / ${qzQueue.length} (${pct}%)`;
    document.getElementById("qzSumMsg").textContent =
      pct >= 90 ? "Padronanza eccellente: sei pronto a ricordare questi dettagli senza incertezze." :
      pct >= 70 ? "Buona preparazione: ripeti subito le domande sbagliate per chiudere le lacune." :
      "Conviene ripassare gli articoli collegati agli errori qui sotto e ripetere la sessione.";

    const missedWrap = document.getElementById("qzMissedList");
    missedWrap.innerHTML = "";
    if (qzWrong.length > 0) {
      missedWrap.classList.remove("hidden");
      const h = document.createElement("h3");
      h.textContent = `Da ripassare (${qzWrong.length})`;
      h.style.fontSize = "0.92rem";
      missedWrap.appendChild(h);
      for (const w of qzWrong) {
        const row = document.createElement("div");
        row.className = "qz-missed-item";
        row.innerHTML = `
          <span><strong>${escapeHtml(w.refLabel)}:</strong> ${escapeHtml(w.q)}</span>
          <button type="button" class="btn small ghost" data-jump="${w.ref}">Apri norma</button>
        `;
        row.querySelector("button").addEventListener("click", () => openSectionInReader(w.ref));
        missedWrap.appendChild(row);
      }
    } else {
      missedWrap.classList.add("hidden");
    }

    document.getElementById("btnQzRetryWrong2").classList.toggle("hidden", qzWrong.length === 0);
  }

  // ==================== CHEATSHEET / SINOSSI ====================
  function syncCsTabs() {
    document.querySelectorAll("#csTabs .pill").forEach(p => {
      const act = p.dataset.cs === csTab;
      p.classList.toggle("active", act);
      p.setAttribute("aria-selected", act ? "true" : "false");
    });
  }

  function renderCheatsheet() {
    const wrap = document.getElementById("csContent");
    const q = (document.getElementById("csSearch").value || "").trim().toLowerCase();
    const cs = PACK.cheatsheet;
    const matchRow = obj => !q || JSON.stringify(obj).toLowerCase().includes(q);

    if (csTab === "timeline") {
      const now = Date.now();
      let foundNext = false;
      const rows = cs.timeline2026.filter(matchRow);
      wrap.innerHTML = rows.length ? `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Data / Ora</th><th>Adempimento</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const dt = parseItalianDate(r.date);
              let cls = "";
              let tag = "";
              if (r.date.startsWith("21/11/2026") && r.event.includes("ASSEMBLEA")) {
                cls = "tl-election";
                tag = ' <span class="tag-pill warn">Assemblea</span>';
              } else if (dt && dt.getTime() < now) {
                cls = "tl-past";
              } else if (dt && !foundNext) {
                foundNext = true;
                cls = "tl-next";
                tag = ' <span class="doc-pill">Prossima</span>';
              }
              return `<tr class="${cls}">
                <td data-label="Data / Ora"><span class="num-hl">${escapeHtml(r.date)}</span>${tag}</td>
                <td data-label="Adempimento">${escapeHtml(r.event)}</td>
                <td data-label="Fonte"><button type="button" class="xref-link" data-jump="${r.ref}">Apri norma</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessuna scadenza trovata per «${escapeHtml(q)}».</p>`;
    } else if (csTab === "quorums") {
      const rows = cs.quorums.filter(matchRow);
      wrap.innerHTML = rows.length ? `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Organo / Seduta</th><th>Quorum Costitutivo</th><th>Quorum Deliberativo</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Organo / Seduta"><strong>${escapeHtml(r.context)}</strong></td>
              <td data-label="Costitutivo">${escapeHtml(r.costitutivo)}</td>
              <td data-label="Deliberativo">${escapeHtml(r.deliberativo)}</td>
              <td data-label="Fonte"><button type="button" class="xref-link" data-jump="${r.ref}">Apri</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun quorum trovato per «${escapeHtml(q)}».</p>`;
    } else if (csTab === "organs") {
      const rows = cs.organs.filter(matchRow);
      wrap.innerHTML = rows.length ? `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Organo / Carica</th><th>Composizione</th><th>Durata</th><th>Poteri Chiave</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Organo / Carica"><strong>${escapeHtml(r.name)}</strong></td>
              <td data-label="Composizione">${escapeHtml(r.composition)}</td>
              <td data-label="Durata">${escapeHtml(r.term)}</td>
              <td data-label="Poteri Chiave">${escapeHtml(r.powers)}</td>
              <td data-label="Fonte"><button type="button" class="xref-link" data-jump="${r.ref}">Apri</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun organo trovato per «${escapeHtml(q)}».</p>`;
    } else if (csTab === "deadlines") {
      const rows = cs.keyDeadlines.filter(matchRow);
      wrap.innerHTML = rows.length ? `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Istituto / Procedura</th><th>Termine / Regola</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Istituto"><strong>${escapeHtml(r.term)}</strong></td>
              <td data-label="Termine">${escapeHtml(r.value)}</td>
              <td data-label="Fonte"><button type="button" class="xref-link" data-jump="${r.ref}">Apri</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun termine trovato per «${escapeHtml(q)}».</p>`;
    } else if (csTab === "hierarchy") {
      wrap.innerHTML = `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Grado</th><th>Fonte Normativa</th><th>Prevalenza &amp; Note</th></tr></thead>
          <tbody>
            ${cs.hierarchy.map(r => `<tr>
              <td data-label="Grado"><span class="code-badge">#${r.rank}</span></td>
              <td data-label="Fonte"><strong>${escapeHtml(r.source)}</strong></td>
              <td data-label="Note">${escapeHtml(r.note)} ${r.ref ? `(<button type="button" class="xref-link" data-jump="${r.ref}">Apri</button>)` : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        <div class="stv-card">
          <h3>Sistema Elettorale STV — Sintesi Operativa (Art. A.16 – A.17)</h3>
          <div class="stv-formula">Quota di Droop = ⌊ schede_valide / (seggi + 1) ⌋ + 1</div>
          <p class="muted" style="font-size:0.9rem; line-height:1.7;">
            <strong>Seggi disponibili (Art. A.17):</strong> più di 6 candidati validi → 7 seggi · 5 o 6 candidati → 5 seggi · meno di 5 candidati → rinvio e riapertura (max 14 giorni).<br/>
            <strong>1ª Votazione (STV):</strong> Ogni scheda vale 1; calcoli in forma frazionaria esatta. Al raggiungimento della quota l'eccedenza si trasferisce moltiplicando il valore delle schede per <code>(voti − quota) / voti</code>. Altrimenti si esclude il meno votato.<br/>
            <strong>2ª Votazione (Cariche):</strong> Solo tra gli eletti della 1ª; STV a 1 seggio alla volta (quota = maggioranza assoluta) per l'ordine di priorità delle cariche.<br/>
            <strong>Parità (Art. A.16.4):</strong> 1° Anzianità d'iscrizione → 2° Il più <strong>giovane</strong> → 3° Sorteggio pre-assemblea.
          </p>
        </div>`;
    } else if (csTab === "diagrams") {
      const elDoc = CORPUS.documents.find(d => d.id === "elettorale");
      const vp = elDoc?.visualPagesRendered || {};
      const entries = Object.entries(vp)
        .map(([p, src]) => ({ p, src, cap: `${DIAGRAM_LABELS[p] || `Pagina ${p}`} (Pag. ${p})` }))
        .filter(item => !q || item.cap.toLowerCase().includes(q));
      wrap.innerHTML = entries.length ? `<div class="article-images">${entries.map((item, i) => `
        <button type="button" class="pdf-page-card" data-lb-idx="${i}">
          <img src="${item.src}" alt="${escapeHtml(item.cap)}" loading="lazy" />
          <div class="pdf-page-cap">${escapeHtml(item.cap)}</div>
        </button>
      `).join("")}</div>` : `<p class="muted">Nessuno schema trovato per «${escapeHtml(q)}».</p>`;
      wrap.querySelectorAll("[data-lb-idx]").forEach(el => {
        el.addEventListener("click", () => openLightbox(entries, Number(el.dataset.lbIdx)));
      });
    }

    wrap.querySelectorAll("[data-jump]").forEach(a => {
      a.addEventListener("click", () => openSectionInReader(a.dataset.jump));
    });
  }

  // ==================== MODALS, SEARCH & LIGHTBOX ====================
  function openModal(id) {
    lastFocusedBeforeModal = document.activeElement;
    document.getElementById(id).classList.remove("hidden");
  }

  function closeAllModals() {
    ["searchModal", "backupModal", "lightboxModal"].forEach(id => {
      document.getElementById(id).classList.add("hidden");
    });
    document.getElementById("resetConfirmBox").classList.add("hidden");
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
      lastFocusedBeforeModal.focus();
      lastFocusedBeforeModal = null;
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
      res.innerHTML = `<p class="muted small-text">Digita una parola, un numero o un articolo per cercare su Statuto, RRI e Regolamento Elettorale 2026.</p>`;
      return;
    }

    const matches = ALL_SECTIONS.filter(s =>
      s.code.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q) ||
      (s.text && s.text.toLowerCase().includes(q))
    ).slice(0, 30);

    if (!matches.length) {
      res.innerHTML = `<p class="muted small-text">Nessun risultato per «${escapeHtml(query)}».</p>`;
      return;
    }

    gsResults = matches;
    gsActiveIdx = 0;
    res.innerHTML = "";
    matches.forEach((s, idx) => {
      const pos = s.text ? s.text.toLowerCase().indexOf(q) : -1;
      let snip = s.text ? s.text.slice(0, 150) : "Sezione contenitore";
      if (pos >= 0) {
        const start = Math.max(0, pos - 50);
        snip = (start > 0 ? "…" : "") + s.text.slice(start, start + 165) + "…";
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gs-item ${idx === 0 ? "active" : ""}`;
      btn.innerHTML = `
        <div class="gs-item-head">
          <span class="doc-pill">${DOC_SHORT[s.doc]}</span>
          <span class="code-badge">${escapeHtml(s.code)}</span>
          <span>${escapeHtml(s.title)}</span>
        </div>
        <div class="gs-item-snip">${escapeHtml(snip)}</div>
      `;
      btn.addEventListener("click", () => {
        closeAllModals();
        openSectionInReader(s.id);
      });
      res.appendChild(btn);
    });
  }

  function renderBackupSummary() {
    const studied = STUDYABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) >= 2).length;
    const mem = STUDYABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) === 3).length;
    const sm2Count = Object.keys(state.sm2).length;
    const bmCount = Object.keys(state.bookmarks).filter(k => state.bookmarks[k]).length;
    document.getElementById("backupSummary").textContent =
      `Sezioni imparate/a memoria: ${studied} (${mem} a memoria) · Schede SM-2 attive: ${sm2Count} · Segnalibri: ${bmCount} · Risposte quiz: ${state.quizStats.total}`;
  }

  // ==================== EVENT BINDINGS ====================
  function bindGlobalEvents() {
    // Primary Navigation (Desktop + Mobile Bottom)
    document.getElementById("brandHome").addEventListener("click", () => switchView("dashboard"));
    document.querySelectorAll("#desktopNav .nav-item, #bottomNav .bnav-item").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // Dashboard CTAs
    document.getElementById("btnHeroContinue").addEventListener("click", () => {
      openSectionInReader(readerSecId || STUDYABLE_SECTIONS[0].id);
    });
    document.getElementById("btnHeroCloze").addEventListener("click", () => switchView("cloze"));
    document.getElementById("btnHeroFlashcards").addEventListener("click", () => switchView("flashcards"));
    document.getElementById("btnHeroBlitz").addEventListener("click", () => {
      document.getElementById("qzModeFilter").value = "blitz";
      document.getElementById("qzDocFilter").value = "all";
      document.getElementById("qzOnlyUnmastered").checked = false;
      startQuiz();
      switchView("quiz");
    });
    document.getElementById("btnOpenTimeline").addEventListener("click", () => {
      csTab = "timeline";
      syncCsTabs();
      renderCheatsheet();
      switchView("cheatsheet");
    });
    document.querySelectorAll(".kpi-card[data-goto]").forEach(card => {
      card.addEventListener("click", () => switchView(card.dataset.goto));
    });
    document.getElementById("kpiBookmarksCard").addEventListener("click", () => {
      readerDocFilter = "all";
      syncReaderDocPills();
      readerStatusFilter = "bookmarked";
      document.getElementById("readerStatusFilter").value = "bookmarked";
      renderReaderSidebar();
      const firstBm = getFilteredReaderSections()[0];
      if (firstBm) renderReaderArticle(firstBm.id);
      switchView("reader");
    });

    // Theme
    document.getElementById("btnTheme").addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      applyTheme(state.theme);
      saveState();
    });

    // Reader controls
    document.getElementById("btnOpenTocDrawer").addEventListener("click", openTocDrawer);
    document.getElementById("btnCloseTocDrawer").addEventListener("click", closeTocDrawer);
    document.getElementById("tocBackdrop").addEventListener("click", closeTocDrawer);

    document.querySelectorAll("#readerDocPills .pill").forEach(p => {
      p.addEventListener("click", () => {
        readerDocFilter = p.dataset.doc;
        syncReaderDocPills();
        renderReaderSidebar();
      });
    });
    document.getElementById("readerSearch").addEventListener("input", renderReaderSidebar);
    document.getElementById("readerStatusFilter").addEventListener("change", e => {
      readerStatusFilter = e.target.value;
      renderReaderSidebar();
    });

    document.getElementById("btnFontDec").addEventListener("click", () => {
      applyReaderScale(state.readerScale - 0.08);
      saveState();
    });
    document.getElementById("btnFontInc").addEventListener("click", () => {
      applyReaderScale(state.readerScale + 0.08);
      saveState();
    });
    document.getElementById("toggleHighlightNums").addEventListener("change", () => {
      if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
    });
    document.getElementById("btnBookmarkSec").addEventListener("click", () => {
      if (!readerSecId) return;
      if (state.bookmarks[readerSecId]) {
        delete state.bookmarks[readerSecId];
        showToast("Segnalibro rimosso.");
      } else {
        state.bookmarks[readerSecId] = true;
        showToast("Salvato nei segnalibri.", "ok");
      }
      saveState();
      renderReaderArticle(readerSecId, { skipHash: true });
    });
    document.getElementById("btnXrefBack").addEventListener("click", () => {
      const prevId = xrefReturnStack.pop();
      if (prevId) renderReaderArticle(prevId);
    });
    document.getElementById("btnSendToCloze").addEventListener("click", () => {
      if (readerSecId) openSectionInCloze(readerSecId);
    });
    document.getElementById("btnArticleFlashcards").addEventListener("click", () => {
      const rel = PACK.flashcards.filter(c => c.ref === readerSecId);
      if (rel.length) {
        buildFcQueue(false, rel);
        switchView("flashcards");
        showToast(`Caricate ${rel.length} flashcards collegate a questo articolo.`);
      }
    });
    document.querySelectorAll("#readerMasteryBtns .m-btn").forEach(b => {
      b.addEventListener("click", () => {
        if (!readerSecId) return;
        const val = Number(b.dataset.status);
        state.mastery[readerSecId] = val;
        saveState();
        renderReaderArticle(readerSecId, { skipHash: true });
        showToast(`Stato aggiornato: ${STATUS_LABELS[val]}`, val >= 2 ? "ok" : "info");
      });
    });

    ["btnPrevSec", "btnNextSec", "btnMobilePrev", "btnMobileNext"].forEach(id => {
      document.getElementById(id).addEventListener("click", e => {
        const target = e.currentTarget.dataset.target;
        if (target) {
          xrefReturnStack = [];
          renderReaderArticle(target);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });

    // Cloze controls
    document.getElementById("clozeDocSelect").addEventListener("change", e => {
      populateClozeSecSelect(e.target.value);
      renderCloze();
      if (currentView === "cloze") setHash(`cloze/${clozeSecId}`);
    });
    document.getElementById("clozeSecSelect").addEventListener("change", e => {
      clozeSecId = e.target.value;
      renderCloze();
      if (currentView === "cloze") setHash(`cloze/${clozeSecId}`);
    });
    document.getElementById("clozeLevelSelect").addEventListener("change", renderCloze);
    document.getElementById("clozeInputMode").addEventListener("change", renderCloze);

    document.getElementById("btnClozeHint").addEventListener("click", () => {
      const nextBlank = document.querySelector("#clozeBody .cloze-blank:not(.revealed)");
      if (nextBlank) { nextBlank.click(); return; }
      const nextPeek = document.querySelector("#clozeBody .cloze-peek");
      if (nextPeek) nextPeek.click();
    });
    document.getElementById("btnClozeRevealAll").addEventListener("click", () => {
      document.querySelectorAll("#clozeBody .cloze-blank:not(.revealed)").forEach(el => el.click());
      document.querySelectorAll("#clozeBody .cloze-peek").forEach(btn => btn.click());
    });
    document.getElementById("btnClozeReset").addEventListener("click", renderCloze);

    const markClozeMemorized = () => {
      if (!clozeSecId) return;
      state.mastery[clozeSecId] = 3;
      saveState();
      populateClozeSecSelect(document.getElementById("clozeDocSelect").value);
      showToast("Articolo segnato come A MEMORIA!", "ok");
    };
    document.getElementById("btnClozeMarkMem").addEventListener("click", markClozeMemorized);
    document.getElementById("btnClozeDoneMark").addEventListener("click", markClozeMemorized);
    document.getElementById("btnClozeLevelUp").addEventListener("click", () => {
      const sel = document.getElementById("clozeLevelSelect");
      const nextLv = Math.min(4, Number(sel.value) + 1);
      sel.value = String(nextLv);
      renderCloze();
    });
    document.getElementById("btnClozeOpenReader").addEventListener("click", () => {
      if (clozeSecId) openSectionInReader(clozeSecId);
    });
    document.getElementById("btnClozePrev").addEventListener("click", () => {
      const idx = CLOZEABLE_SECTIONS.findIndex(s => s.id === clozeSecId);
      if (idx > 0) openSectionInCloze(CLOZEABLE_SECTIONS[idx - 1].id);
    });
    document.getElementById("btnClozeNext").addEventListener("click", () => {
      const idx = CLOZEABLE_SECTIONS.findIndex(s => s.id === clozeSecId);
      if (idx >= 0 && idx < CLOZEABLE_SECTIONS.length - 1) openSectionInCloze(CLOZEABLE_SECTIONS[idx + 1].id);
    });
    document.getElementById("btnClozeRandom").addEventListener("click", () => {
      const pool = CLOZEABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) < 3 && s.id !== clozeSecId);
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : CLOZEABLE_SECTIONS[0];
      if (pick) openSectionInCloze(pick.id);
    });

    // Flashcards controls
    ["fcDeckMode", "fcDocFilter", "fcTagFilter", "fcOnlyDue"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => buildFcQueue(false));
    });
    document.getElementById("btnFcShuffle").addEventListener("click", () => {
      buildFcQueue(true);
      showToast("Mazzo mescolato.");
    });
    document.getElementById("btnFcUndo").addEventListener("click", undoLastFlashcard);
    document.getElementById("flashcardEl").addEventListener("click", flipFlashcard);
    document.getElementById("btnFcReveal").addEventListener("click", flipFlashcard);
    document.getElementById("btnFcSource").addEventListener("click", e => {
      e.stopPropagation();
      const card = fcQueue[0];
      if (card?.ref) openSectionInReader(card.ref);
    });
    document.querySelectorAll("#fcRatingBar .rate-btn").forEach(b => {
      b.addEventListener("click", () => rateFlashcard(Number(b.dataset.q)));
    });
    document.getElementById("btnFcShowAll").addEventListener("click", () => {
      document.getElementById("fcOnlyDue").checked = false;
      buildFcQueue(false);
    });
    document.getElementById("btnFcRestartSession").addEventListener("click", () => buildFcQueue(true));

    // Quiz controls — auto-apply filters
    ["qzModeFilter", "qzDocFilter", "qzOnlyUnmastered"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => startQuiz());
    });
    document.getElementById("btnStartQuiz").addEventListener("click", () => startQuiz());
    document.getElementById("btnQzRestart").addEventListener("click", () => startQuiz());
    document.getElementById("btnRetryWrong").addEventListener("click", () => startQuiz([...qzWrong]));
    document.getElementById("btnQzRetryWrong2").addEventListener("click", () => startQuiz([...qzWrong]));
    document.getElementById("btnQzNext").addEventListener("click", () => {
      qzIdx++;
      renderQuizQuestion();
    });

    // Cheatsheet controls
    document.querySelectorAll("#csTabs .pill").forEach(p => {
      p.addEventListener("click", () => {
        csTab = p.dataset.cs;
        syncCsTabs();
        renderCheatsheet();
        setHash(`cheatsheet/${csTab}`);
      });
    });
    document.getElementById("csSearch").addEventListener("input", renderCheatsheet);

    // Search Modal
    document.getElementById("btnSearchQuick").addEventListener("click", () => {
      openModal("searchModal");
      const inp = document.getElementById("globalSearchInput");
      inp.focus();
      inp.select();
      renderGlobalSearch(inp.value);
    });
    document.getElementById("closeSearchModal").addEventListener("click", closeAllModals);
    document.getElementById("searchModal").addEventListener("click", e => {
      if (e.target.id === "searchModal") closeAllModals();
    });
    document.getElementById("globalSearchInput").addEventListener("input", e => renderGlobalSearch(e.target.value));
    document.getElementById("globalSearchInput").addEventListener("keydown", e => {
      if (!gsResults.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        gsActiveIdx = e.key === "ArrowDown"
          ? (gsActiveIdx + 1) % gsResults.length
          : (gsActiveIdx - 1 + gsResults.length) % gsResults.length;
        const items = document.querySelectorAll("#globalSearchResults .gs-item");
        items.forEach((el, i) => el.classList.toggle("active", i === gsActiveIdx));
        items[gsActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && gsActiveIdx >= 0) {
        e.preventDefault();
        const picked = gsResults[gsActiveIdx];
        closeAllModals();
        openSectionInReader(picked.id);
      }
    });

    // Backup Modal (in-app confirm, zero alert/confirm!)
    document.getElementById("btnBackup").addEventListener("click", () => {
      renderBackupSummary();
      openModal("backupModal");
      document.getElementById("btnExportProgress").focus();
    });
    document.getElementById("closeBackupModal").addEventListener("click", closeAllModals);
    document.getElementById("backupModal").addEventListener("click", e => {
      if (e.target.id === "backupModal") closeAllModals();
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
          const imported = JSON.parse(reader.result);
          if (typeof imported !== "object" || !imported) throw new Error("Formato non valido");
          state = {
            ...defaultState(),
            ...imported,
            mastery: imported.mastery || {},
            bookmarks: imported.bookmarks || {},
            sm2: imported.sm2 || {},
            quizStats: imported.quizStats || { total: 0, correct: 0 },
            quizMastered: imported.quizMastered || {},
          };
          saveState();
          applyTheme(state.theme);
          applyReaderScale(state.readerScale);
          renderDashboard();
          renderReaderSidebar();
          if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
          buildFcQueue(false);
          closeAllModals();
          showToast("Progressi ripristinati con successo!", "ok");
        } catch (_) {
          showToast("File JSON non valido: impossibile importare.", "warn");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    document.getElementById("btnResetAsk").addEventListener("click", () => {
      document.getElementById("resetConfirmBox").classList.remove("hidden");
    });
    document.getElementById("btnResetCancel").addEventListener("click", () => {
      document.getElementById("resetConfirmBox").classList.add("hidden");
    });
    document.getElementById("btnResetConfirm").addEventListener("click", () => {
      const keepTheme = state.theme;
      state = { ...defaultState(), theme: keepTheme };
      saveState();
      renderDashboard();
      renderReaderSidebar();
      if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
      buildFcQueue(false);
      startQuiz();
      closeAllModals();
      showToast("Tutti i progressi sono stati azzerati.");
    });

    // Lightbox controls
    document.getElementById("closeLightbox").addEventListener("click", closeAllModals);
    document.getElementById("lightboxModal").addEventListener("click", e => {
      if (e.target.id === "lightboxModal") closeAllModals();
    });
    document.getElementById("btnLbPrev").addEventListener("click", () => {
      if (lbGallery.length > 1) {
        lbIdx = (lbIdx - 1 + lbGallery.length) % lbGallery.length;
        updateLightbox();
      }
    });
    document.getElementById("btnLbNext").addEventListener("click", () => {
      if (lbGallery.length > 1) {
        lbIdx = (lbIdx + 1) % lbGallery.length;
        updateLightbox();
      }
    });

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", e => {
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("btnSearchQuick").click();
        return;
      }

      if (e.key === "Escape") {
        closeAllModals();
        closeTocDrawer();
        return;
      }

      // Lightbox gallery arrows
      if (!document.getElementById("lightboxModal").classList.contains("hidden")) {
        if (e.key === "ArrowLeft") document.getElementById("btnLbPrev").click();
        if (e.key === "ArrowRight") document.getElementById("btnLbNext").click();
        return;
      }

      if (inInput) return;

      // Flashcards shortcuts
      if (currentView === "flashcards") {
        if (e.code === "Space") {
          e.preventDefault();
          flipFlashcard();
        } else if (e.key.toLowerCase() === "z" && fcLastAction) {
          undoLastFlashcard();
        } else if (fcFlipped) {
          if (e.key === "1") rateFlashcard(1);
          if (e.key === "2") rateFlashcard(3);
          if (e.key === "3") rateFlashcard(4);
          if (e.key === "4") rateFlashcard(5);
        }
        return;
      }

      // Quiz shortcuts
      if (currentView === "quiz" && !document.getElementById("quizBox").classList.contains("hidden")) {
        if (!qzAnswered) {
          const map = { a: 0, b: 1, c: 2, d: 3, "1": 0, "2": 1, "3": 2, "4": 3 };
          const k = e.key.toLowerCase();
          if (map[k] !== undefined && qzQueue[qzIdx]?.options[map[k]] !== undefined) {
            handleQuizAnswer(map[k]);
          }
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
      <div class="hero-surface" style="display:block;">
        <h2>Errore durante il caricamento dei dati</h2>
        <p class="muted" style="margin-top:0.5rem;">Assicurati di aprire l'app da un server HTTP o dal link online.</p>
        <pre style="margin-top:0.8rem;font-size:0.8rem;overflow:auto;">${escapeHtml(String(err))}</pre>
      </div>`;
  });
})();
