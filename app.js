(() => {
  const STORAGE_KEY = "polinetwork_studylab_v1";

  let CORPUS = null;
  let PACK = null;
  let ALL_SECTIONS = [];
  let SECTION_MAP = new Map();

  let state = loadState();
  let currentView = "dashboard";
  let readerDocFilter = "all";
  let readerSecId = null;

  // Cloze runtime
  let clozeSecId = null;
  let clozeBlanksTotal = 0;
  let clozeBlanksRevealed = 0;

  // Flashcards runtime
  let fcQueue = [];
  let fcIdx = 0;
  let fcFlipped = false;

  // Quiz runtime
  let qzQueue = [];
  let qzIdx = 0;
  let qzCorrect = 0;
  let qzWrong = [];
  let qzAnswered = false;

  // Cheatsheet runtime
  let csTab = "timeline";

  const DOC_LABELS = {
    statuto: "Statuto",
    rri: "Regolamenti Interni (RRI)",
    elettorale: "Reg. Elettorale 2026",
  };

  const STATUS_ICONS = ["⚪", "🟡", "🟢", "💎"];

  const STOPWORDS = new Set([
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per",
    "tra", "fra", "del", "dello", "della", "dei", "degli", "delle", "al", "allo", "alla", "ai", "agli",
    "alle", "dal", "dallo", "dalla", "dai", "dagli", "dalle", "nel", "nello", "nella", "nei", "negli",
    "nelle", "sul", "sullo", "sulla", "sui", "sugli", "sulle", "e", "ed", "o", "od", "ma", "che", "chi",
    "cui", "non", "si", "se", "come", "anche", "più", "solo", "sono", "è", "ha", "hanno", "può", "essere",
    "tale", "tali", "ogni", "tutti", "tutte", "questo", "questa", "questi", "queste", "quello", "quella",
    "suo", "sua", "suoi", "sue", "loro", "proprio", "propria", "propri", "proprie", "altri", "altre",
    "altro", "altra", "nel", "caso", "cui", "sensi", "presente", "presenti", "essere", "stato", "stata",
    "dalla", "dall", "dell", "all", "nell", "sull", "l", "d", "un"
  ]);

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          mastery: parsed.mastery || {},
          sm2: parsed.sm2 || {},
          quizStats: parsed.quizStats || { total: 0, correct: 0 },
          theme: parsed.theme || "dark",
        };
      }
    } catch (e) { /* ignore */ }
    return { mastery: {}, sm2: {}, quizStats: { total: 0, correct: 0 }, theme: "dark" };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeText(s) {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’'“”".,;:()]/g, "").trim();
  }

  // ==================== INIT ====================
  async function init() {
    applyTheme(state.theme);
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

    readerSecId = ALL_SECTIONS[0]?.id || null;
    clozeSecId = ALL_SECTIONS.find(s => s.text && s.text.length > 40)?.id || readerSecId;

    bindGlobalEvents();
    populateFcTagFilter();
    populateClozeSelectors();
    renderDashboard();
    renderReaderSidebar();
    if (readerSecId) renderReaderArticle(readerSecId);
    renderCloze();
    buildFcQueue();
    startQuiz();
    renderCheatsheet();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("btnTheme");
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  function switchView(viewName) {
    currentView = viewName;
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add("active");
    document.querySelectorAll(".nav-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.view === viewName);
    });
    if (viewName === "dashboard") renderDashboard();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSectionInReader(secId) {
    if (!SECTION_MAP.has(secId)) return;
    readerDocFilter = "all";
    document.querySelectorAll("#readerDocPills .pill").forEach(p => {
      p.classList.toggle("active", p.dataset.doc === "all");
    });
    document.getElementById("readerSearch").value = "";
    renderReaderSidebar();
    renderReaderArticle(secId);
    switchView("reader");
  }

  function openSectionInCloze(secId) {
    const sec = SECTION_MAP.get(secId);
    if (!sec) return;
    clozeSecId = secId;
    document.getElementById("clozeDocSelect").value = sec.doc;
    populateClozeSecSelect(sec.doc);
    document.getElementById("clozeSecSelect").value = secId;
    renderCloze();
    switchView("cloze");
  }

  // ==================== DASHBOARD ====================
  function renderDashboard() {
    const studyable = ALL_SECTIONS.filter(s => s.text && s.text.trim().length > 0);
    let scoreSum = 0;
    let studiedCount = 0;
    let memCount = 0;
    for (const s of studyable) {
      const m = state.mastery[s.id] || 0;
      scoreSum += m;
      if (m >= 2) studiedCount++;
      if (m === 3) memCount++;
    }
    const maxScore = studyable.length * 3 || 1;
    const pct = Math.round((scoreSum / maxScore) * 100);

    document.getElementById("overallPct").textContent = `${pct}%`;
    const circ = 2 * Math.PI * 58;
    document.getElementById("overallRing").style.strokeDashoffset = circ * (1 - pct / 100);

    document.getElementById("statSections").textContent = `${studiedCount} / ${studyable.length}`;
    document.getElementById("statMemorized").textContent = `${memCount} a memoria (100%)`;

    const dueCount = countDueCards("curated");
    document.getElementById("statDue").textContent = dueCount;
    document.getElementById("dueBadge").textContent = dueCount;

    if (state.quizStats.total > 0) {
      const acc = Math.round((state.quizStats.correct / state.quizStats.total) * 100);
      document.getElementById("statQuizAcc").textContent = `${acc}%`;
      document.getElementById("statQuizDone").textContent = `${state.quizStats.correct}/${state.quizStats.total} risposte corrette`;
    } else {
      document.getElementById("statQuizAcc").textContent = "—";
      document.getElementById("statQuizDone").textContent = "Nessuna risposta ancora";
    }

    // Per-document cards
    const grid = document.getElementById("docCardsGrid");
    grid.innerHTML = "";
    for (const doc of CORPUS.documents) {
      const secs = doc.sections.filter(s => s.text && s.text.trim().length > 0);
      const dScore = secs.reduce((acc, s) => acc + (state.mastery[s.id] || 0), 0);
      const dPct = Math.round((dScore / (secs.length * 3 || 1)) * 100);
      const dMem = secs.filter(s => (state.mastery[s.id] || 0) === 3).length;
      const firstId = secs[0]?.id;

      const card = document.createElement("div");
      card.className = "doc-card";
      card.innerHTML = `
        <div class="doc-card-head">
          <div>
            <h3>${escapeHtml(doc.title)}</h3>
            <div class="doc-card-meta">${doc.pages} pagine · ${doc.sections.length} sezioni · ${dMem}/${secs.length} a memoria</div>
          </div>
          <span class="article-code">${dPct}%</span>
        </div>
        <div class="doc-progress-bar"><div class="doc-progress-fill" style="width:${dPct}%"></div></div>
        <div class="doc-card-actions">
          <button class="btn small secondary" data-open-doc="${doc.id}">📖 Leggi tutto</button>
          <button class="btn small primary" data-cloze-doc="${firstId}">🧩 Memorizza</button>
          <button class="btn small ghost" data-quiz-doc="${doc.id}">📝 Quiz</button>
        </div>
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll("[data-open-doc]").forEach(b => {
      b.addEventListener("click", () => {
        const docId = b.dataset.openDoc;
        readerDocFilter = docId;
        document.querySelectorAll("#readerDocPills .pill").forEach(p => p.classList.toggle("active", p.dataset.doc === docId));
        renderReaderSidebar();
        const first = ALL_SECTIONS.find(s => s.doc === docId);
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
        startQuiz();
        switchView("quiz");
      });
    });
  }

  // ==================== READER ====================
  function getFilteredReaderSections() {
    const q = (document.getElementById("readerSearch").value || "").trim().toLowerCase();
    return ALL_SECTIONS.filter(s => {
      if (readerDocFilter !== "all" && s.doc !== readerDocFilter) return false;
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
    document.getElementById("readerMatchCount").textContent = `${secs.length} sezioni`;
    list.innerHTML = "";

    for (const s of secs) {
      const m = state.mastery[s.id] || 0;
      const btn = document.createElement("button");
      btn.className = `toc-item lvl-${s.level} ${s.id === readerSecId ? "active" : ""}`;
      btn.innerHTML = `
        <span class="toc-dot">${s.text ? STATUS_ICONS[m] : "📁"}</span>
        <span class="toc-code">${escapeHtml(s.num || s.code)}</span>
        <span class="toc-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
      `;
      btn.addEventListener("click", () => renderReaderArticle(s.id));
      list.appendChild(btn);
    }
  }

  function highlightNumbersAndRefs(rawText) {
    let html = escapeHtml(rawText);
    const hlNums = document.getElementById("toggleHighlightNums")?.checked;

    if (hlNums) {
      // Highlight dates, times, euro amounts, fractions, numbers with time/vote units
      const numPattern = /(\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}:\d{2}\b|€\s?\d+(?:,\d{2})?|\b\d+(?:,\d+)?\s*(?:giorni|giorno|ore|ora|mesi|mese|anni|anno|minuti|minuto|settimane|settimana|crediti|credito|ammonizioni|deleghe|seggi|membri|persone|candidati|semestri|semestre|volte)\b|\b(?:maggioranza assoluta|maggioranza semplice|unanimità|tre quarti|due terzi|un terzo|un sesto|metà più uno|⅔|½|⅙|3\/4|2\/3|1\/3|1\/2)\b|\b(?:trenta|novanta|sette|dieci|quindici|ventiquattro|quarantotto|cinque|sei|nove|dodici|quattro|tre|due)\s+(?:giorni|ore|mesi|anni|minuti|settimane|ammonizioni|deleghe|crediti)\b)/gi;
      html = html.replace(numPattern, '<span class="num-hl">$1</span>');
    }

    // Make cross-references clickable: "articolo A.16.2", "articolo 1.6.1.1", "articolo 12"
    html = html.replace(/\b(articolo|art\.)\s+(A\.\d+(?:\.\d+)?)\b/gi, (m, p1, code) => {
      const id = `el-${code.toLowerCase().replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<a class="xref-link" data-jump="${id}">${m}</a>` : m;
    });
    html = html.replace(/\b(articolo|art\.)\s+(\d+\.\d+(?:\.\d+)*)\b/gi, (m, p1, code) => {
      const id = `rri-${code.replace(/\./g, "-")}`;
      return SECTION_MAP.has(id) ? `<a class="xref-link" data-jump="${id}">${m}</a>` : m;
    });
    html = html.replace(/\b(articolo|art\.)\s+(\d{1,2})\b(?=\s+(?:comma|commi|dello Statuto|del presente Statuto))/gi, (m, p1, num) => {
      const id = `statuto-art-${num}`;
      return SECTION_MAP.has(id) ? `<a class="xref-link" data-jump="${id}">${m}</a>` : m;
    });

    return html;
  }

  function renderReaderArticle(secId) {
    const sec = SECTION_MAP.get(secId);
    if (!sec) return;
    readerSecId = secId;

    document.querySelectorAll(".toc-item").forEach(el => el.classList.remove("active"));
    renderReaderSidebar();

    document.getElementById("readerBreadcrumb").textContent = DOC_LABELS[sec.doc] || sec.doc;
    document.getElementById("readerArtCode").textContent = sec.code;
    document.getElementById("readerArtPage").textContent = `Pagina ${sec.page}`;
    document.getElementById("readerArtTitle").textContent = sec.title;

    const curStatus = state.mastery[sec.id] || 0;
    document.querySelectorAll("#readerMasteryBtns .m-btn").forEach(b => {
      b.classList.toggle("active", Number(b.dataset.status) === curStatus);
    });

    const bodyEl = document.getElementById("readerArtBody");
    bodyEl.innerHTML = "";

    if (!sec.text || !sec.text.trim()) {
      // Container section: list child sections
      const children = ALL_SECTIONS.filter(s => s.parent === sec.id);
      bodyEl.innerHTML = `<p class="muted" style="margin-bottom:0.8rem;">Questa è una sezione contenitore. Seleziona una sottosezione qui sotto:</p>`;
      for (const ch of children) {
        const div = document.createElement("div");
        div.className = "article-block";
        div.style.cursor = "pointer";
        div.innerHTML = `<strong>${escapeHtml(ch.code)}</strong> — ${escapeHtml(ch.title)}`;
        div.addEventListener("click", () => renderReaderArticle(ch.id));
        bodyEl.appendChild(div);
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
        div.innerHTML = highlightNumbersAndRefs(blk.text);
        bodyEl.appendChild(div);
      }
    }

    bodyEl.querySelectorAll(".xref-link").forEach(a => {
      a.addEventListener("click", () => renderReaderArticle(a.dataset.jump));
    });

    // Rendered PDF images if any
    const imgWrap = document.getElementById("readerArtImages");
    imgWrap.innerHTML = "";
    if (sec.images && sec.images.length) {
      for (const src of sec.images) {
        const card = document.createElement("div");
        card.className = "pdf-page-card";
        card.innerHTML = `<img src="${src}" alt="Pagina PDF" loading="lazy" /><div class="pdf-page-cap">🔍 Clicca per ingrandire — ${src.split("/").pop()}</div>`;
        card.addEventListener("click", () => openLightbox(src, `${sec.code} — ${sec.title}`));
        imgWrap.appendChild(card);
      }
    }

    // Prev / Next buttons
    const idx = ALL_SECTIONS.findIndex(s => s.id === secId);
    document.getElementById("btnPrevSec").disabled = idx <= 0;
    document.getElementById("btnNextSec").disabled = idx >= ALL_SECTIONS.length - 1;
  }

  // ==================== CLOZE / A MEMORIA ====================
  function populateClozeSelectors() {
    const docSel = document.getElementById("clozeDocSelect");
    populateClozeSecSelect(docSel.value);
  }

  function populateClozeSecSelect(docId) {
    const sel = document.getElementById("clozeSecSelect");
    const secs = ALL_SECTIONS.filter(s => s.doc === docId && s.text && s.text.trim().length > 20 && s.id !== "el-b-1");
    sel.innerHTML = "";
    for (const s of secs) {
      const m = state.mastery[s.id] || 0;
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${STATUS_ICONS[m]} ${s.code} — ${s.title}`;
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
      /^(trenta|novanta|sette|dieci|quindici|ventiquattro|quarantotto|cinque|sei|nove|quattro|tre|due|primo|seconda|terza|unanimità|assoluta|semplice|segreto|palese|decano|probiviri|direttivo|assemblea|presidente|vicepresidente|segretario|tesoriere|droop|delega|deleghe|ricorso|ricorsi|quorum|scadenza|proroga|incompatibili|decadenza|espulsione|ammonizioni)$/i.test(clean);

    if (level === 1) return isNumOrKey;
    if (level === 2) {
      if (isNumOrKey) return true;
      if (clean.length < 5 || STOPWORDS.has(low)) return false;
      return (idx % 3 === 0);
    }
    if (level === 3) {
      if (isNumOrKey) return true;
      if (clean.length < 3 || STOPWORDS.has(low)) return false;
      return (idx % 3 !== 1);
    }
    if (level === 4) {
      return clean.length >= 2;
    }
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

      for (const tok of tokens) {
        if (/^\s+$/.test(tok)) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }
        tokenIndex++;
        const match = tok.match(/^([^\p{L}\p{N}€]*)([\p{L}\p{N}€.,\/:%'-]+?)([^\p{L}\p{N}%]*)$/u);
        if (!match || !shouldBlankToken(match[2], level, tokenIndex)) {
          p.appendChild(document.createTextNode(tok));
          continue;
        }

        const [, lead, core, trail] = match;
        if (lead) p.appendChild(document.createTextNode(lead));

        clozeBlanksTotal++;
        if (mode === "click") {
          const span = document.createElement("span");
          span.className = "cloze-blank";
          span.dataset.answer = core;
          const hint = level === 4 ? `${core[0]}${"·".repeat(Math.min(core.length - 1, 5))}` : `${core[0]}___`;
          span.textContent = hint;
          span.title = "Clicca per rivelare";
          span.addEventListener("click", () => {
            if (!span.classList.contains("revealed")) {
              span.classList.add("revealed");
              span.textContent = core;
              clozeBlanksRevealed++;
              updateClozeCounter();
            }
          });
          p.appendChild(span);
        } else {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "cloze-input";
          inp.dataset.answer = core;
          inp.placeholder = `${core[0]}...`;
          inp.style.width = `${Math.max(72, Math.min(180, core.length * 10 + 18))}px`;
          inp.addEventListener("input", () => {
            if (normalizeText(inp.value) === normalizeText(core)) {
              if (!inp.classList.contains("ok")) {
                inp.classList.remove("bad");
                inp.classList.add("ok");
                inp.value = core;
                inp.readOnly = true;
                clozeBlanksRevealed++;
                updateClozeCounter();
              }
            } else if (inp.value.length >= core.length) {
              inp.classList.add("bad");
            } else {
              inp.classList.remove("bad");
            }
          });
          p.appendChild(inp);
        }

        if (trail) p.appendChild(document.createTextNode(trail));
      }
      body.appendChild(p);
    }

    updateClozeCounter();
  }

  function updateClozeCounter() {
    document.getElementById("clozeCounter").textContent = `${clozeBlanksRevealed} / ${clozeBlanksTotal} completati`;
  }

  // ==================== FLASHCARDS (SM-2) ====================
  function getArticleFlashcards() {
    return ALL_SECTIONS
      .filter(s => s.text && s.text.trim().length > 20 && s.id !== "el-b-1")
      .map(s => ({
        id: `auto-${s.id}`,
        doc: s.doc,
        ref: s.id,
        refLabel: `${DOC_LABELS[s.doc]} ${s.code}`,
        tag: "Copertura Articolo 1:1",
        q: `[${DOC_LABELS[s.doc]}] Cosa dispone ${s.code} — «${s.title}»?`,
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
    if (!rec) return true;
    return Date.now() >= rec.nextReview;
  }

  function countDueCards(mode = "curated") {
    return getDeckCards(mode).filter(c => isCardDue(c.id)).length;
  }

  function populateFcTagFilter() {
    const sel = document.getElementById("fcTagFilter");
    const tags = Array.from(new Set(PACK.flashcards.map(c => c.tag))).sort();
    tags.push("Copertura Articolo 1:1");
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
  }

  function buildFcQueue(shuffle = false) {
    const mode = document.getElementById("fcDeckMode").value;
    const docF = document.getElementById("fcDocFilter").value;
    const tagF = document.getElementById("fcTagFilter").value;
    const onlyDue = document.getElementById("fcOnlyDue").checked;

    let cards = getDeckCards(mode).filter(c => {
      if (docF !== "all" && c.doc !== docF) return false;
      if (tagF !== "all" && c.tag !== tagF) return false;
      if (onlyDue && !isCardDue(c.id)) return false;
      return true;
    });

    if (shuffle) {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }

    fcQueue = cards;
    fcIdx = 0;
    fcFlipped = false;
    renderFlashcard();
  }

  function renderFlashcard() {
    const arena = document.getElementById("fcArena");
    if (!fcQueue.length) {
      document.getElementById("fcQueueInfo").textContent = "0 carte";
      document.getElementById("fcQuestion").textContent = "🎉 Ottimo lavoro! Nessuna carta da ripassare con questi filtri.";
      document.getElementById("fcBack").classList.add("hidden");
      document.getElementById("fcRatingBar").classList.add("hidden");
      document.getElementById("fcRevealWrap").classList.add("hidden");
      return;
    }

    const card = fcQueue[fcIdx % fcQueue.length];
    const rec = state.sm2[card.id];
    document.getElementById("fcQueueInfo").textContent = `Carta ${(fcIdx % fcQueue.length) + 1} di ${fcQueue.length}`;
    document.getElementById("fcCardMeta").textContent = rec
      ? `Ripetizioni: ${rec.reps} · Intervallo: ${rec.interval}g`
      : "Nuova carta";
    document.getElementById("fcDocBadge").textContent = DOC_LABELS[card.doc] || card.doc;
    document.getElementById("fcTagBadge").textContent = card.tag;
    document.getElementById("fcQuestion").textContent = card.q;
    document.getElementById("fcAnswer").textContent = card.a;
    document.getElementById("fcRefLabel").textContent = card.refLabel;

    fcFlipped = false;
    document.getElementById("fcBack").classList.add("hidden");
    document.getElementById("fcRatingBar").classList.add("hidden");
    document.getElementById("fcRevealWrap").classList.remove("hidden");
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
    const card = fcQueue[fcIdx % fcQueue.length];
    const prev = state.sm2[card.id] || { reps: 0, interval: 0, ef: 2.5 };
    let { reps, interval, ef } = prev;

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

    state.sm2[card.id] = {
      reps,
      interval,
      ef: Number(ef.toFixed(2)),
      nextReview: Date.now() + interval * 86400000,
    };
    saveState();
    document.getElementById("dueBadge").textContent = countDueCards("curated");

    if (quality < 3) {
      // Re-insert soon in queue
      const insertAt = Math.min(fcQueue.length, fcIdx + 3);
      fcQueue.splice(insertAt, 0, card);
    }
    fcIdx++;
    if (fcIdx >= fcQueue.length) {
      fcIdx = 0;
    }
    renderFlashcard();
  }

  // ==================== QUIZ ====================
  function startQuiz(customList = null) {
    const modeF = document.getElementById("qzModeFilter").value;
    const docF = document.getElementById("qzDocFilter").value;

    let list = customList || PACK.quizzes.filter(q => {
      if (modeF !== "all" && q.mode !== modeF) return false;
      if (docF !== "all" && q.doc !== docF) return false;
      return true;
    });

    // Shuffle
    qzQueue = [...list].sort(() => Math.random() - 0.5);
    qzIdx = 0;
    qzCorrect = 0;
    qzWrong = [];
    qzAnswered = false;

    document.getElementById("quizSummary").classList.add("hidden");
    document.getElementById("quizBox").classList.remove("hidden");
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    if (!qzQueue.length) {
      document.getElementById("qzQuestion").textContent = "Nessuna domanda trovata con i filtri selezionati.";
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
    const modeNames = { blitz: "⚡ Blitz Numeri & Quorum", mc: "📘 Normativa", scenario: "🎭 Scenario Pratico" };
    document.getElementById("qzModeBadge").textContent = modeNames[item.mode] || item.mode;
    document.getElementById("qzQuestion").textContent = item.q;

    const optsEl = document.getElementById("qzOptions");
    optsEl.innerHTML = "";
    item.options.forEach((optText, i) => {
      const btn = document.createElement("button");
      btn.className = "quiz-opt";
      btn.textContent = `${String.fromCharCode(65 + i)}) ${optText}`;
      btn.addEventListener("click", () => handleQuizAnswer(i));
      optsEl.appendChild(btn);
    });

    document.getElementById("qzFeedback").classList.add("hidden");
  }

  function handleQuizAnswer(chosenIdx) {
    if (qzAnswered) return;
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
    } else {
      qzWrong.push(item);
    }
    saveState();

    document.getElementById("qzScoreLive").textContent = `Corrette: ${qzCorrect} · Errate: ${qzWrong.length}`;
    document.getElementById("qzFbTitle").textContent = ok ? "✅ Risposta esatta!" : "❌ Risposta errata";
    document.getElementById("qzFbText").textContent = item.explanation;
    document.getElementById("qzRefLabel").textContent = item.refLabel;
    document.getElementById("btnQzSource").onclick = () => openSectionInReader(item.ref);
    document.getElementById("qzFeedback").classList.remove("hidden");
    document.getElementById("btnRetryWrong").classList.toggle("hidden", qzWrong.length === 0);
  }

  function showQuizSummary() {
    document.getElementById("quizBox").classList.add("hidden");
    const sum = document.getElementById("quizSummary");
    sum.classList.remove("hidden");
    const pct = Math.round((qzCorrect / (qzQueue.length || 1)) * 100);
    document.getElementById("qzSumScore").textContent = `${qzCorrect} / ${qzQueue.length} (${pct}%)`;
    document.getElementById("qzSumMsg").textContent =
      pct >= 90 ? "🏆 Padronanza eccezionale! Sei pronto a memoria." :
      pct >= 70 ? "👍 Ottima base! Ripeti gli errori per arrivare al 100%." :
      "📚 Ripassa gli articoli sbagliati e riprova il Blitz!";
    document.getElementById("btnQzRetryWrong2").classList.toggle("hidden", qzWrong.length === 0);
  }

  // ==================== CHEATSHEET / SINOSSI ====================
  function renderCheatsheet() {
    const wrap = document.getElementById("csContent");
    const q = (document.getElementById("csSearch").value || "").trim().toLowerCase();
    const cs = PACK.cheatsheet;

    const matchRow = obj => !q || JSON.stringify(obj).toLowerCase().includes(q);

    if (csTab === "timeline") {
      const rows = cs.timeline2026.filter(matchRow);
      wrap.innerHTML = `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Data / Ora</th><th>Scadenza &amp; Adempimento</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><span class="num-hl">${escapeHtml(r.date)}</span></td>
              <td>${escapeHtml(r.event)}</td>
              <td><a class="xref-link" data-jump="${r.ref}">Apri norma</a></td>
            </tr>`).join("")}
          </tbody>
        </table></div>`;
    } else if (csTab === "quorums") {
      const rows = cs.quorums.filter(matchRow);
      wrap.innerHTML = `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Organo / Seduta</th><th>Quorum Costitutivo</th><th>Quorum Deliberativo</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><strong>${escapeHtml(r.context)}</strong></td>
              <td>${escapeHtml(r.costitutivo)}</td>
              <td>${escapeHtml(r.deliberativo)}</td>
              <td><a class="xref-link" data-jump="${r.ref}">Apri</a></td>
            </tr>`).join("")}
          </tbody>
        </table></div>`;
    } else if (csTab === "organs") {
      const rows = cs.organs.filter(matchRow);
      wrap.innerHTML = `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Organo / Carica</th><th>Composizione</th><th>Durata</th><th>Poteri Chiave</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><strong>${escapeHtml(r.name)}</strong></td>
              <td>${escapeHtml(r.composition)}</td>
              <td>${escapeHtml(r.term)}</td>
              <td>${escapeHtml(r.powers)}</td>
              <td><a class="xref-link" data-jump="${r.ref}">Apri</a></td>
            </tr>`).join("")}
          </tbody>
        </table></div>`;
    } else if (csTab === "deadlines") {
      const rows = cs.keyDeadlines.filter(matchRow);
      wrap.innerHTML = `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Istituto / Procedura</th><th>Termine / Regola</th><th>Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><strong>${escapeHtml(r.term)}</strong></td>
              <td>${escapeHtml(r.value)}</td>
              <td><a class="xref-link" data-jump="${r.ref}">Apri</a></td>
            </tr>`).join("")}
          </tbody>
        </table></div>`;
    } else if (csTab === "hierarchy") {
      wrap.innerHTML = `
        <div class="cs-table-wrap"><table class="cs-table">
          <thead><tr><th>Grado</th><th>Fonte Normativa</th><th>Note &amp; Prevalenza</th></tr></thead>
          <tbody>
            ${cs.hierarchy.map(r => `<tr>
              <td><span class="article-code">#${r.rank}</span></td>
              <td><strong>${escapeHtml(r.source)}</strong></td>
              <td>${escapeHtml(r.note)} ${r.ref ? `(<a class="xref-link" data-jump="${r.ref}">Apri</a>)` : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        <div class="stv-card">
          <h3>🧮 Sintesi Sistema Elettorale STV (Art. A.16)</h3>
          <div class="stv-formula">Quota di Droop = ⌊ schede_valide / (seggi + 1) ⌋ + 1</div>
          <p class="muted">
            • <strong>Seggi disponibili (Art. A.17):</strong> &gt;6 candidati validi → <strong>7 seggi</strong> · 5 o 6 candidati → <strong>5 seggi</strong> · &lt;5 candidati → rinvio e riapertura (max 14 gg).<br/>
            • <strong>1ª Votazione (STV):</strong> Ogni scheda vale 1; calcoli in frazione esatta. Se un candidato raggiunge la quota, l'eccedenza si trasferisce moltiplicando il valore delle sue schede per <code>(voti - quota) / voti</code>. Altrimenti si esclude il meno votato.<br/>
            • <strong>2ª Votazione (Cariche):</strong> Solo tra gli eletti della 1ª; STV a 1 seggio alla volta (quota = maggioranza assoluta) per fissare l'ordine di priorità con cui si assegnano le preferenze di carica.<br/>
            • <strong>Spareggio Parità (Art. A.16.4):</strong> 1° Anzianità d'iscrizione → 2° Il più <strong>GIOVANE</strong> → 3° Sorteggio pre-assemblea.
          </p>
        </div>`;
    } else if (csTab === "diagrams") {
      const elDoc = CORPUS.documents.find(d => d.id === "elettorale");
      const vp = elDoc?.visualPagesRendered || {};
      const entries = Object.entries(vp);
      const labels = {
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
      wrap.innerHTML = `<div class="article-images">${entries.map(([p, src]) => `
        <div class="pdf-page-card" data-lb="${src}" data-cap="${escapeHtml(labels[p] || `Pagina ${p}`)}">
          <img src="${src}" alt="Pagina ${p}" loading="lazy" />
          <div class="pdf-page-cap">🔍 ${escapeHtml(labels[p] || `Pagina ${p}`)} (Pag. ${p})</div>
        </div>
      `).join("")}</div>`;
      wrap.querySelectorAll("[data-lb]").forEach(el => {
        el.addEventListener("click", () => openLightbox(el.dataset.lb, el.dataset.cap));
      });
    }

    wrap.querySelectorAll("[data-jump]").forEach(a => {
      a.addEventListener("click", () => openSectionInReader(a.dataset.jump));
    });
  }

  // ==================== LIGHTBOX & MODALS ====================
  function openLightbox(src, cap) {
    document.getElementById("lightboxImg").src = src;
    document.getElementById("lightboxCap").textContent = cap || "";
    document.getElementById("lightboxModal").classList.remove("hidden");
  }

  function renderGlobalSearch(query) {
    const res = document.getElementById("globalSearchResults");
    const q = query.trim().toLowerCase();
    if (!q) {
      res.innerHTML = `<p class="muted">Digita una parola, un numero o un articolo per cercare in tutti i 3 documenti (160 sezioni).</p>`;
      return;
    }
    const matches = ALL_SECTIONS.filter(s =>
      s.code.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q) ||
      (s.text && s.text.toLowerCase().includes(q))
    ).slice(0, 30);

    if (!matches.length) {
      res.innerHTML = `<p class="muted">Nessun risultato per «${escapeHtml(query)}».</p>`;
      return;
    }

    res.innerHTML = "";
    for (const s of matches) {
      const idx = s.text ? s.text.toLowerCase().indexOf(q) : -1;
      let snip = s.text ? s.text.slice(0, 150) : "";
      if (idx >= 0) {
        const start = Math.max(0, idx - 55);
        snip = (start > 0 ? "..." : "") + s.text.slice(start, start + 165) + "...";
      }
      const div = document.createElement("div");
      div.className = "gs-item";
      div.innerHTML = `
        <div class="gs-item-head">
          <span class="fc-doc-badge">${DOC_LABELS[s.doc]}</span>
          <span class="article-code">${escapeHtml(s.code)}</span>
          <span>${escapeHtml(s.title)}</span>
        </div>
        <div class="gs-item-snip">${escapeHtml(snip)}</div>
      `;
      div.addEventListener("click", () => {
        document.getElementById("searchModal").classList.add("hidden");
        openSectionInReader(s.id);
      });
      res.appendChild(div);
    }
  }

  // ==================== EVENTS ====================
  function bindGlobalEvents() {
    document.getElementById("brandHome").addEventListener("click", () => switchView("dashboard"));
    document.querySelectorAll(".nav-tab").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    document.querySelectorAll("[data-goto]").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.goto));
    });

    // Theme
    document.getElementById("btnTheme").addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      applyTheme(state.theme);
      saveState();
    });

    // Reader controls
    document.querySelectorAll("#readerDocPills .pill").forEach(p => {
      p.addEventListener("click", () => {
        readerDocFilter = p.dataset.doc;
        document.querySelectorAll("#readerDocPills .pill").forEach(x => x.classList.remove("active"));
        p.classList.add("active");
        renderReaderSidebar();
      });
    });
    document.getElementById("readerSearch").addEventListener("input", renderReaderSidebar);
    document.getElementById("toggleHighlightNums").addEventListener("change", () => {
      if (readerSecId) renderReaderArticle(readerSecId);
    });
    document.getElementById("btnSendToCloze").addEventListener("click", () => {
      if (readerSecId) openSectionInCloze(readerSecId);
    });
    document.querySelectorAll("#readerMasteryBtns .m-btn").forEach(b => {
      b.addEventListener("click", () => {
        if (!readerSecId) return;
        state.mastery[readerSecId] = Number(b.dataset.status);
        saveState();
        renderReaderArticle(readerSecId);
      });
    });
    document.getElementById("btnPrevSec").addEventListener("click", () => {
      const idx = ALL_SECTIONS.findIndex(s => s.id === readerSecId);
      if (idx > 0) renderReaderArticle(ALL_SECTIONS[idx - 1].id);
    });
    document.getElementById("btnNextSec").addEventListener("click", () => {
      const idx = ALL_SECTIONS.findIndex(s => s.id === readerSecId);
      if (idx < ALL_SECTIONS.length - 1) renderReaderArticle(ALL_SECTIONS[idx + 1].id);
    });

    // Cloze controls
    document.getElementById("clozeDocSelect").addEventListener("change", e => {
      populateClozeSecSelect(e.target.value);
      renderCloze();
    });
    document.getElementById("clozeSecSelect").addEventListener("change", e => {
      clozeSecId = e.target.value;
      renderCloze();
    });
    document.getElementById("clozeLevelSelect").addEventListener("change", renderCloze);
    document.getElementById("clozeInputMode").addEventListener("change", renderCloze);

    document.getElementById("btnClozeHint").addEventListener("click", () => {
      const nextBlank = document.querySelector("#clozeBody .cloze-blank:not(.revealed)");
      if (nextBlank) nextBlank.click();
      const nextInp = document.querySelector("#clozeBody .cloze-input:not(.ok)");
      if (nextInp) {
        nextInp.value = nextInp.dataset.answer;
        nextInp.dispatchEvent(new Event("input"));
      }
    });
    document.getElementById("btnClozeRevealAll").addEventListener("click", () => {
      document.querySelectorAll("#clozeBody .cloze-blank:not(.revealed)").forEach(el => el.click());
      document.querySelectorAll("#clozeBody .cloze-input:not(.ok)").forEach(inp => {
        inp.value = inp.dataset.answer;
        inp.dispatchEvent(new Event("input"));
      });
    });
    document.getElementById("btnClozeReset").addEventListener("click", renderCloze);
    document.getElementById("btnClozeMarkMem").addEventListener("click", () => {
      if (!clozeSecId) return;
      state.mastery[clozeSecId] = 3;
      saveState();
      populateClozeSecSelect(document.getElementById("clozeDocSelect").value);
      alert("💎 Articolo segnato come IMPARATO A MEMORIA!");
    });
    document.getElementById("btnClozeOpenReader").addEventListener("click", () => {
      if (clozeSecId) openSectionInReader(clozeSecId);
    });
    document.getElementById("btnClozeNext").addEventListener("click", () => {
      const sel = document.getElementById("clozeSecSelect");
      if (sel.selectedIndex < sel.options.length - 1) {
        sel.selectedIndex++;
        clozeSecId = sel.value;
        renderCloze();
      }
    });
    document.getElementById("btnClozeRandom").addEventListener("click", () => {
      const pool = ALL_SECTIONS.filter(s => s.text && s.text.length > 30 && s.id !== "el-b-1" && (state.mastery[s.id] || 0) < 3);
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ALL_SECTIONS[0];
      if (pick) openSectionInCloze(pick.id);
    });

    // Flashcards controls
    ["fcDeckMode", "fcDocFilter", "fcTagFilter", "fcOnlyDue"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => buildFcQueue(false));
    });
    document.getElementById("btnFcShuffle").addEventListener("click", () => buildFcQueue(true));
    document.getElementById("flashcardEl").addEventListener("click", flipFlashcard);
    document.getElementById("btnFcReveal").addEventListener("click", flipFlashcard);
    document.getElementById("btnFcSource").addEventListener("click", e => {
      e.stopPropagation();
      const card = fcQueue[fcIdx % fcQueue.length];
      if (card?.ref) openSectionInReader(card.ref);
    });
    document.querySelectorAll("#fcRatingBar .rate-btn").forEach(b => {
      b.addEventListener("click", () => rateFlashcard(Number(b.dataset.q)));
    });

    // Quiz controls
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
        document.querySelectorAll("#csTabs .pill").forEach(x => x.classList.remove("active"));
        p.classList.add("active");
        renderCheatsheet();
      });
    });
    document.getElementById("csSearch").addEventListener("input", renderCheatsheet);

    // Modals
    document.getElementById("btnSearchQuick").addEventListener("click", () => {
      document.getElementById("searchModal").classList.remove("hidden");
      const inp = document.getElementById("globalSearchInput");
      inp.focus();
      renderGlobalSearch(inp.value);
    });
    document.getElementById("closeSearchModal").addEventListener("click", () => {
      document.getElementById("searchModal").classList.add("hidden");
    });
    document.getElementById("globalSearchInput").addEventListener("input", e => renderGlobalSearch(e.target.value));

    document.getElementById("btnBackup").addEventListener("click", () => {
      document.getElementById("backupModal").classList.remove("hidden");
    });
    document.getElementById("closeBackupModal").addEventListener("click", () => {
      document.getElementById("backupModal").classList.add("hidden");
    });
    document.getElementById("btnExportProgress").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "polinetwork_studylab_backup.json";
      a.click();
    });
    document.getElementById("inputImportProgress").addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          state = JSON.parse(reader.result);
          saveState();
          applyTheme(state.theme || "dark");
          renderDashboard();
          alert("✅ Progressi ripristinati!");
          document.getElementById("backupModal").classList.add("hidden");
        } catch (err) {
          alert("Errore nel file JSON.");
        }
      };
      reader.readAsText(file);
    });
    document.getElementById("btnResetProgress").addEventListener("click", () => {
      if (confirm("Sicuro di voler azzerare tutti i progressi di studio?")) {
        state = { mastery: {}, sm2: {}, quizStats: { total: 0, correct: 0 }, theme: state.theme };
        saveState();
        renderDashboard();
        renderReaderSidebar();
        document.getElementById("backupModal").classList.add("hidden");
      }
    });

    document.getElementById("closeLightbox").addEventListener("click", () => {
      document.getElementById("lightboxModal").classList.add("hidden");
    });
    document.getElementById("lightboxModal").addEventListener("click", e => {
      if (e.target.id === "lightboxModal") document.getElementById("lightboxModal").classList.add("hidden");
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("btnSearchQuick").click();
        return;
      }
      if (e.key === "Escape") {
        document.getElementById("searchModal").classList.add("hidden");
        document.getElementById("backupModal").classList.add("hidden");
        document.getElementById("lightboxModal").classList.add("hidden");
        return;
      }
      if (currentView === "flashcards" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        if (e.code === "Space") {
          e.preventDefault();
          flipFlashcard();
        } else if (fcFlipped) {
          if (e.key === "1") rateFlashcard(1);
          if (e.key === "2") rateFlashcard(3);
          if (e.key === "3") rateFlashcard(4);
          if (e.key === "4") rateFlashcard(5);
        }
      }
    });
  }

  init().catch(err => {
    console.error("Init error:", err);
    document.body.innerHTML = `<div style="padding:2rem;color:#fff;font-family:sans-serif"><h2>Errore caricamento dati</h2><p>Avvia l'app tramite <code>avvia_app.bat</code> o un server HTTP locale (<code>python -m http.server 8765</code>).</p><pre>${err}</pre></div>`;
  });
})();
