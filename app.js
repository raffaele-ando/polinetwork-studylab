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

  let fbApp = null;
  let fbAuth = null;
  let fbDb = null;
  let fbModules = null;
  let fbUser = null;
  let fbUnsubSnapshot = null;
  let fbCollectionName = "users";
  let cloudSyncTimer = null;
  let cloudPendingPush = false;
  let cloudLastSyncedAt = 0;
  let cloudApplyingRemote = false;
  let cloudStatus = "idle"; // idle | syncing | online | pending | error

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
      updatedAt: 0,
      resetAt: 0,
      _ts: { mastery: {}, bookmarks: {} },
      prefs: {
        highlightNums: true,
        clozeLevel: "1",
        clozeInputMode: "click",
        fcDeckMode: "curated",
      },
    };
  }

  function normalizeStateObject(p) {
    const def = defaultState();
    if (!p || typeof p !== "object") return def;
    return {
      ...def,
      ...p,
      mastery: p.mastery || {},
      bookmarks: p.bookmarks || {},
      sm2: p.sm2 || {},
      quizStats: p.quizStats || { total: 0, correct: 0 },
      quizMastered: p.quizMastered || {},
      updatedAt: Number(p.updatedAt) || 0,
      resetAt: Number(p.resetAt) || 0,
      _ts: {
        mastery: p._ts?.mastery || {},
        bookmarks: p._ts?.bookmarks || {},
      },
      prefs: { ...def.prefs, ...(p.prefs || {}) },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeStateObject(JSON.parse(raw));
    } catch (_) { /* ignore */ }
    return defaultState();
  }

  function saveState(opts = {}) {
    if (!opts.preserveTimestamp) {
      state.updatedAt = Date.now();
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* ignore */ }
    if (!cloudApplyingRemote && fbUser && !opts.skipCloud) {
      scheduleCloudPush();
    }
  }

  function mergeCloudAndLocalState(localRaw, remoteRaw) {
    const local = normalizeStateObject(localRaw);
    const remote = normalizeStateObject(remoteRaw);

    // If one side executed an explicit full reset more recently than the other side's updates
    if (remote.resetAt > local.updatedAt && remote.resetAt > local.resetAt) {
      return { ...remote };
    }
    if (local.resetAt > remote.updatedAt && local.resetAt > remote.resetAt) {
      return { ...local };
    }

    const baseResetAt = Math.max(local.resetAt || 0, remote.resetAt || 0);
    const newerIsRemote = (remote.updatedAt || 0) > (local.updatedAt || 0);
    const primary = newerIsRemote ? remote : local;

    const mergedMastery = {};
    const mergedMasteryTs = {};
    const allMasteryKeys = new Set([...Object.keys(local.mastery), ...Object.keys(remote.mastery)]);
    for (const k of allMasteryKeys) {
      const lTs = Number(local._ts?.mastery?.[k]) || 0;
      const rTs = Number(remote._ts?.mastery?.[k]) || 0;
      const lVal = Number(local.mastery[k]) || 0;
      const rVal = Number(remote.mastery[k]) || 0;
      if (lTs > 0 || rTs > 0) {
        if (rTs > lTs) { mergedMastery[k] = rVal; mergedMasteryTs[k] = rTs; }
        else if (lTs > rTs) { mergedMastery[k] = lVal; mergedMasteryTs[k] = lTs; }
        else { mergedMastery[k] = Math.max(lVal, rVal); mergedMasteryTs[k] = Math.max(lTs, rTs); }
      } else {
        mergedMastery[k] = Math.max(lVal, rVal);
      }
      if (mergedMastery[k] === 0) delete mergedMastery[k];
    }

    const mergedBookmarks = {};
    const mergedBookmarksTs = {};
    const allBmKeys = new Set([
      ...Object.keys(local.bookmarks),
      ...Object.keys(remote.bookmarks),
      ...Object.keys(local._ts?.bookmarks || {}),
      ...Object.keys(remote._ts?.bookmarks || {}),
    ]);
    for (const k of allBmKeys) {
      const lTs = Number(local._ts?.bookmarks?.[k]) || 0;
      const rTs = Number(remote._ts?.bookmarks?.[k]) || 0;
      if (lTs > 0 || rTs > 0) {
        const active = rTs > lTs ? !!remote.bookmarks[k] : (lTs > rTs ? !!local.bookmarks[k] : !!(local.bookmarks[k] || remote.bookmarks[k]));
        mergedBookmarksTs[k] = Math.max(lTs, rTs);
        if (active) mergedBookmarks[k] = true;
      } else if (local.bookmarks[k] || remote.bookmarks[k]) {
        mergedBookmarks[k] = true;
      }
    }

    const mergedSm2 = {};
    const allSm2Keys = new Set([...Object.keys(local.sm2), ...Object.keys(remote.sm2)]);
    for (const k of allSm2Keys) {
      const lRec = local.sm2[k];
      const rRec = remote.sm2[k];
      if (lRec && !rRec) mergedSm2[k] = lRec;
      else if (rRec && !lRec) mergedSm2[k] = rRec;
      else if (lRec && rRec) {
        const lRev = Number(lRec.lastReviewedAt) || Number(lRec.nextReview) || 0;
        const rRev = Number(rRec.lastReviewedAt) || Number(rRec.nextReview) || 0;
        if (rRev > lRev) mergedSm2[k] = rRec;
        else if (lRev > rRev) mergedSm2[k] = lRec;
        else mergedSm2[k] = (Number(rRec.reps) || 0) >= (Number(lRec.reps) || 0) ? rRec : lRec;
      }
    }

    const mergedQuizMastered = { ...remote.quizMastered, ...local.quizMastered };
    const mergedQuizStats = {
      total: Math.max(Number(local.quizStats?.total) || 0, Number(remote.quizStats?.total) || 0),
      correct: Math.max(Number(local.quizStats?.correct) || 0, Number(remote.quizStats?.correct) || 0),
    };

    return normalizeStateObject({
      ...primary,
      mastery: mergedMastery,
      bookmarks: mergedBookmarks,
      sm2: mergedSm2,
      quizMastered: mergedQuizMastered,
      quizStats: mergedQuizStats,
      theme: primary.theme || local.theme || "light",
      readerScale: primary.readerScale || local.readerScale || 1,
      lastSecId: primary.lastSecId || local.lastSecId || remote.lastSecId || null,
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0, Date.now()),
      resetAt: baseResetAt,
      _ts: { mastery: mergedMasteryTs, bookmarks: mergedBookmarksTs },
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

  function applyFullStateToUI() {
    applyTheme(state.theme);
    applyReaderScale(state.readerScale);
    applySavedPrefsToControls();
    if (state.lastSecId && SECTION_MAP.has(state.lastSecId) && currentView !== "reader") {
      readerSecId = state.lastSecId;
    }
    renderOverview();
    renderReaderSidebar();
    if (readerSecId && SECTION_MAP.has(readerSecId)) {
      renderReaderArticle(readerSecId, { skipHash: true });
    }
    buildFcQueue(false);
    renderBackupSummary();
    updateDueBadges();
  }

  async function resolveCloudDocRef(uid) {
    const { doc } = fbModules;
    return doc(fbDb, fbCollectionName, uid);
  }

  async function pushStateToCloud(immediate = false) {
    if (!fbUser || !fbDb || !fbModules) return;
    if (cloudSyncTimer) {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
    }
    if (!navigator.onLine) {
      cloudPendingPush = true;
      cloudStatus = "pending";
      updateCloudUI();
      return;
    }

    cloudStatus = "syncing";
    updateCloudUI();

    const payload = {
      studylab_v1: JSON.parse(JSON.stringify(state)),
      studylab_updatedAt: state.updatedAt || Date.now(),
      uid: fbUser.uid,
      email: fbUser.email || "",
      displayName: fbUser.displayName || "",
    };

    const collectionsToTry = [fbCollectionName, "users", "studylab_users", "backups"].filter((v, i, a) => a.indexOf(v) === i);
    for (const col of collectionsToTry) {
      try {
        const ref = fbModules.doc(fbDb, col, fbUser.uid);
        await fbModules.setDoc(ref, payload, { merge: true });
        fbCollectionName = col;
        cloudPendingPush = false;
        cloudLastSyncedAt = Date.now();
        cloudStatus = "online";
        setCloudNotice("");
        try {
          localStorage.setItem(`${STORAGE_KEY}_cloud_${fbUser.uid}`, JSON.stringify(state));
        } catch (_) { /* ignore */ }
        updateCloudUI();
        if (immediate) showToast("Sincronizzato nel Cloud ✓");
        return;
      } catch (err) {
        if (err?.code === "permission-denied") continue;
        console.warn("Cloud push warning:", err);
      }
    }

    // Fallback: cache under user-scoped local mirror and display helpful message if Firestore rules need enabling
    try {
      localStorage.setItem(`${STORAGE_KEY}_cloud_${fbUser.uid}`, JSON.stringify(state));
    } catch (_) { /* ignore */ }
    cloudStatus = "error";
    setCloudNotice("Accesso Google attivo. Nota: verifica che le regole Cloud Firestore nel progetto Firebase 'polinetwork' consentano la scrittura agli utenti autenticati (request.auth != null). I dati sono comunque salvati in locale.");
    updateCloudUI();
  }

  function scheduleCloudPush() {
    cloudPendingPush = true;
    cloudStatus = "syncing";
    updateCloudUI();
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      pushStateToCloud(false);
    }, 300);
  }

  async function pullAndMergeFromCloud(uid, showNotification = false) {
    if (!fbDb || !fbModules || !uid) return;
    cloudStatus = "syncing";
    updateCloudUI();

    const collectionsToTry = [fbCollectionName, "users", "studylab_users", "backups"].filter((v, i, a) => a.indexOf(v) === i);
    let remoteState = null;

    for (const col of collectionsToTry) {
      try {
        const ref = fbModules.doc(fbDb, col, uid);
        const snap = await fbModules.getDoc(ref);
        fbCollectionName = col;
        if (snap.exists()) {
          const data = snap.data();
          if (data?.studylab_v1) {
            remoteState = data.studylab_v1;
          }
        }
        break;
      } catch (err) {
        if (err?.code === "permission-denied") continue;
      }
    }

    // Also merge any user-scoped local cache
    try {
      const cachedRaw = localStorage.getItem(`${STORAGE_KEY}_cloud_${uid}`);
      if (cachedRaw) {
        const cachedState = JSON.parse(cachedRaw);
        remoteState = remoteState ? mergeCloudAndLocalState(cachedState, remoteState) : cachedState;
      }
    } catch (_) { /* ignore */ }

    if (remoteState) {
      cloudApplyingRemote = true;
      state = mergeCloudAndLocalState(state, remoteState);
      saveState({ skipCloud: true, preserveTimestamp: true });
      applyFullStateToUI();
      cloudApplyingRemote = false;
    }

    await pushStateToCloud(showNotification);
    startRealtimeCloudListener(uid);
  }

  function startRealtimeCloudListener(uid) {
    if (fbUnsubSnapshot) {
      fbUnsubSnapshot();
      fbUnsubSnapshot = null;
    }
    if (!fbDb || !fbModules || !uid) return;
    try {
      const ref = fbModules.doc(fbDb, fbCollectionName, uid);
      fbUnsubSnapshot = fbModules.onSnapshot(ref, snap => {
        if (!snap.exists() || cloudPendingPush) return;
        const data = snap.data();
        const remote = data?.studylab_v1;
        if (!remote) return;
        const remoteTs = Number(remote.updatedAt) || Number(data.studylab_updatedAt) || 0;
        if (remoteTs > (state.updatedAt || 0)) {
          cloudApplyingRemote = true;
          state = mergeCloudAndLocalState(state, remote);
          saveState({ skipCloud: true, preserveTimestamp: true });
          cloudLastSyncedAt = Date.now();
          cloudStatus = "online";
          applyFullStateToUI();
          updateCloudUI();
          cloudApplyingRemote = false;
        }
      }, () => { /* ignore snapshot permission errors handled in push */ });
    } catch (_) { /* ignore */ }
  }

  async function initFirebaseCloud() {
    try {
      const [appMod, authMod, fsMod, anMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
        import("https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js").catch(() => null),
      ]);

      fbApp = appMod.initializeApp(FIREBASE_CONFIG);
      if (anMod && typeof anMod.isSupported === "function") {
        anMod.isSupported().then(yes => { if (yes) anMod.getAnalytics(fbApp); }).catch(() => {});
      }
      fbAuth = authMod.getAuth(fbApp);
      fbDb = fsMod.getFirestore(fbApp);
      fbModules = { ...authMod, ...fsMod };

      // Check redirect result if user signed in via mobile redirect fallback
      authMod.getRedirectResult(fbAuth).catch(err => {
        if (err?.code === "auth/unauthorized-domain") {
          setCloudNotice(`Dominio non autorizzato in Firebase Auth: aggiungi "${location.hostname}" in Firebase Console → Authentication → Settings → Authorized domains.`, true);
        }
      });

      authMod.onAuthStateChanged(fbAuth, async user => {
        fbUser = user || null;
        if (fbUser) {
          cloudStatus = "syncing";
          updateCloudUI();
          await pullAndMergeFromCloud(fbUser.uid, false);
        } else {
          if (fbUnsubSnapshot) { fbUnsubSnapshot(); fbUnsubSnapshot = null; }
          cloudStatus = "idle";
          updateCloudUI();
        }
      });

      window.addEventListener("online", () => {
        if (fbUser && cloudPendingPush) pushStateToCloud(false);
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && fbUser && cloudPendingPush) {
          pushStateToCloud(false);
        }
      });
    } catch (err) {
      console.warn("Firebase init offline/fallback:", err);
    }
  }

  async function handleGoogleLogin() {
    if (!fbAuth || !fbModules) {
      showToast("Connessione a Firebase in corso, riprova tra un istante…");
      await initFirebaseCloud();
      if (!fbAuth || !fbModules) {
        setCloudNotice("Impossibile caricare Firebase SDK. Verifica la connessione internet.", true);
        return;
      }
    }
    setCloudNotice("");
    const provider = new fbModules.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const res = await fbModules.signInWithPopup(fbAuth, provider);
      if (res?.user) {
        showToast(`Connesso come ${res.user.displayName || res.user.email}`);
      }
    } catch (err) {
      if (err?.code === "auth/popup-blocked" || err?.code === "auth/cancelled-popup-request") {
        try {
          await fbModules.signInWithRedirect(fbAuth, provider);
          return;
        } catch (e2) {
          setCloudNotice(`Errore accesso Google: ${e2.message || e2.code}`, true);
        }
      } else if (err?.code === "auth/unauthorized-domain") {
        const msg = `Dominio "${location.hostname}" da autorizzare in Firebase Console → Authentication → Settings → Authorized domains.`;
        setCloudNotice(msg, true);
        openModal("backupModal");
      } else if (err?.code !== "auth/popup-closed-by-user") {
        setCloudNotice(`Accesso Google non riuscito (${err?.code || "errore"}).`, true);
        openModal("backupModal");
      }
    }
  }

  async function handleGoogleLogout() {
    if (!fbAuth || !fbModules) return;
    try {
      if (cloudPendingPush) await pushStateToCloud(false);
      await fbModules.signOut(fbAuth);
      showToast("Disconnesso da Google Cloud (progressi conservati in locale)");
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

  function showToast(msg) {
    const region = document.getElementById("toastRegion");
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
    const safe = esc(text);
    const q = (query || "").trim();
    if (!q) return safe;
    const escapedQ = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safe.replace(new RegExp(`(${escapedQ})`, "gi"), '<mark class="search-hit">$1</mark>');
  }

  function computeNextSM2(prev, quality) {
    const base = prev || { reps: 0, interval: 0, ef: 2.5 };
    let { reps, interval, ef } = base;
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
    )).filter(el => el.offsetParent !== null);
  }

  function handleFocusTrap(e) {
    if (e.key !== "Tab" || !activeTrapContainer) return;
    const focusables = getFocusable(activeTrapContainer);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ==================== INIT ====================
  async function init() {
    document.body.dataset.view = "overview";
    applyTheme(state.theme);
    applyReaderScale(state.readerScale);
    applySavedPrefsToControls();

    const [corpusRes, packRes] = await Promise.all([
      fetch("data/corpus.json?v=4.0.1"),
      fetch("data/study_pack.json?v=4.0.1"),
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
    syncCsTabs();
    renderReference();

    applyRouteFromHash();
    window.addEventListener("hashchange", applyRouteFromHash);
    setInterval(renderDeadlineCard, 60000);
    updateCloudUI();
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
      syncReaderSidebarDots();
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
      if (p1 && document.querySelector(`#csTabs .ref-pill[data-cs="${p1}"]`)) {
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
  function countTrulyDueReviewed() {
    const now = Date.now();
    return PACK.flashcards.filter(c => state.sm2[c.id] && now >= state.sm2[c.id].nextReview).length;
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
      monthEl.textContent = MONTHS_IT[nextItem.dt.getMonth()];
      dayEl.textContent = String(nextItem.dt.getDate());
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
    const dueReviewed = updateDueBadges();
    const qzMast = Object.keys(state.quizMastered).filter(k => state.quizMastered[k]).length;
    const bmCount = Object.keys(state.bookmarks).filter(k => state.bookmarks[k] && SECTION_MAP.has(k)).length;

    document.getElementById("overallPct").textContent = `${pct}%`;
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
      titleEl.textContent = `${dueReviewed} flashcard pronte`;
      subEl.textContent = "Ripetizione dilazionata SM-2";
      nextLbl.textContent = "Avvia ripasso";
      nextBtn.onclick = () => {
        document.getElementById("fcOnlyDue").checked = true;
        buildFcQueue(false);
        switchPracticeMode("flashcards");
        switchView("practice");
      };
    } else if (firstWipSec) {
      kickerEl.textContent = "Continua da qui";
      titleEl.textContent = `${firstWipSec.code.replace(/\s+/g, "\u00A0")} ·\u00A0${firstWipSec.title}`;
      subEl.textContent = `${DOC_SHORT[firstWipSec.doc]} · ${mins} min`;
      nextLbl.textContent = "Riprendi lettura";
      nextBtn.onclick = () => openArticle(firstWipSec.id);
    } else {
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
          <div class="doc-name">${esc(DOC_CLEAN[doc.id] || doc.title)}</div>
          <div class="doc-sub">${secs.length} ${unit}${ic.subExtra}</div>
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
        renderReaderSidebar();
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
      b.setAttribute("aria-selected", act ? "true" : "false");
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
    });
    document.getElementById("readerReadPane").classList.toggle("hidden", readerMode !== "read");
    document.getElementById("readerClozePane").classList.toggle("hidden", readerMode !== "cloze");
    document.getElementById("btnToggleNums").classList.toggle("hidden", readerMode !== "read");
    document.getElementById("btnSwitchInlineCloze").textContent =
      readerMode === "read" ? "Allenati in Cloze" : "Torna alla lettura";
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
    if (state.prefs.highlightNums !== false) {
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
    chain.push(`${sec.code} · ${sec.title}`);
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
    if (sec.images && sec.images.length) {
      const gallery = sec.images.map(src => ({ src, cap: `${sec.code} — ${sec.title}` }));
      sec.images.forEach((src, i) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "pdf-card";
        card.innerHTML = `<img src="${src}" alt="Schema PDF ${sec.code}" loading="lazy" /><div class="pdf-card-cap">Apri schema · ${src.split("/").pop()}</div>`;
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

  function renderClozeInto({ secId, levelSel, modeSel, bodyEl, counterEl, barEl, barRevEl, noticeEl, hintBtn, revealBtn, resetBtn }) {
    const sec = SECTION_MAP.get(secId);
    if (!sec) return { hintOne: () => {}, revealAll: () => {} };
    const level = Number(levelSel.value);
    const mode = modeSel.value;

    bodyEl.innerHTML = "";
    noticeEl.classList.add("hidden");
    noticeEl.classList.remove("ok");

    const items = [];
    let recalled = 0;
    let revealed = 0;
    let tokenIndex = 0;
    const restartArgs = { secId, levelSel, modeSel, bodyEl, counterEl, barEl, barRevEl, noticeEl, hintBtn, revealBtn, resetBtn };

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
        if (recalled === 0) {
          noticeEl.classList.remove("ok", "hidden");
          noticeEl.innerHTML = `
            <span><strong>Testo mostrato.</strong> Ricomincia per provarlo senza aiuti.</span>
            <div class="notice-actions"><button type="button" class="btn-apple soft sm" data-clz-retry>Ricomincia</button></div>
          `;
          noticeEl.querySelector("[data-clz-retry]").addEventListener("click", () => renderClozeInto(restartArgs));
        } else {
          if ((state.mastery[secId] || 0) === 0) {
            state.mastery[secId] = 1;
            if (!state._ts) state._ts = { mastery: {}, bookmarks: {} };
            state._ts.mastery[secId] = Date.now();
            saveState();
            syncAllViewsForStateChange(secId);
          }
          const recallPct = Math.round((recalled / total) * 100);
          noticeEl.classList.add("ok");
          noticeEl.classList.remove("hidden");
          const nextLv = level < 4 ? `<button type="button" class="btn-apple soft sm" data-clz-lvup>Livello ${level + 1}</button>` : "";
          noticeEl.innerHTML = `
            <span><strong>Completato:</strong> ${recalled}/${total} (${recallPct}%)</span>
            <div class="notice-actions">${nextLv}<button type="button" class="btn-apple primary sm" data-clz-mem>A memoria</button></div>
          `;
          noticeEl.querySelector("[data-clz-lvup]")?.addEventListener("click", () => {
            levelSel.value = String(level + 1);
            state.prefs.clozeLevel = levelSel.value;
            saveState();
            renderClozeInto(restartArgs);
          });
          noticeEl.querySelector("[data-clz-mem]")?.addEventListener("click", () => {
            state.mastery[secId] = 3;
            if (!state._ts) state._ts = { mastery: {}, bookmarks: {} };
            state._ts.mastery[secId] = Date.now();
            saveState();
            syncAllViewsForStateChange(secId);
            showToast(`${sec.code} segnato a memoria`);
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
          btn.textContent = level === 4 ? `${core[0]} ${"·".repeat(Math.min(core.length - 1, 5))}` : `${core[0]} ···`;
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
          if (trail) p.appendChild(document.createTextNode(trail));
        } else {
          const wrap = document.createElement("span");
          wrap.className = "cloze-input-wrap";
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "cloze-input";
          inp.placeholder = `${core[0]}…`;
          inp.setAttribute("aria-label", `Scrivi parola che inizia per ${core[0]}`);
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
            revealPassively: () => {
              if (entry.done) return;
              entry.done = true;
              replaceWithChip("cloze-chip-peeked", "rivelata");
              revealed++;
              updateProgress();
              bodyEl.querySelector(".cloze-input")?.focus();
            },
          };
          const markRecalled = () => {
            if (entry.done) return;
            entry.done = true;
            replaceWithChip("cloze-chip-ok", "corretta");
            recalled++;
            updateProgress();
            bodyEl.querySelector(".cloze-input")?.focus();
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
          peek.addEventListener("click", entry.revealPassively);
          items.push(entry);
          wrap.appendChild(inp);
          wrap.appendChild(peek);
          if (trail) {
            wrap.classList.add("has-trail");
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
      noticeEl.classList.remove("hidden");
      noticeEl.innerHTML = `
        <span>Nessun termine chiave al Livello 1 per questo articolo.</span>
        <button type="button" class="btn-apple primary sm" data-jump-lv2>Passa a Livello 2</button>
      `;
      noticeEl.querySelector("[data-jump-lv2]").addEventListener("click", () => {
        levelSel.value = "2";
        state.prefs.clozeLevel = "2";
        saveState();
        renderClozeInto(restartArgs);
      });
    }
    updateProgress();

    return {
      hintOne: () => { const next = items.find(it => !it.done); if (next) next.revealPassively(); },
      revealAll: () => { for (const it of items) if (!it.done) it.revealPassively(); },
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
    const tags = Array.from(new Set(PACK.flashcards.map(c => c.tag))).sort();
    tags.push("Articoli");
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
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
    document.getElementById("btnFcClearFocus").classList.toggle("hidden", !fcCustomContext);
    renderFlashcard();
  }

  function renderFlashcard() {
    const cardEl = document.getElementById("flashcardEl");
    const emptyEl = document.getElementById("fcEmptyState");
    const dockEl = document.getElementById("fcThumbDock");
    const revealWrap = document.getElementById("fcRevealWrap");
    const ratingWrap = document.getElementById("fcRatingWrap");

    const pct = fcTotalSession > 0 ? Math.round((fcCompletedSession / fcTotalSession) * 100) : 100;
    document.getElementById("fcBarFill").style.width = `${pct}%`;

    if (!fcQueue.length) {
      cardEl.classList.add("hidden");
      dockEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
      const onlyDue = document.getElementById("fcOnlyDue").checked;
      document.getElementById("fcQueueInfo").textContent = fcTotalSession > 0 ? `${fcCompletedSession} di ${fcTotalSession}` : "0 schede";
      document.getElementById("fcEmptyTitle").textContent = fcTotalSession > 0 ? "Sessione completata" : "Nessuna scheda da ripassare";
      document.getElementById("fcEmptyDesc").textContent = onlyDue
        ? "Sei in pari con il ripasso programmato."
        : "Modifica i filtri o avvia un nuovo ciclo.";
      document.getElementById("btnFcShowAll").classList.toggle("hidden", !onlyDue && !fcCustomContext);
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
    if (prevRec) state.sm2[card.id] = prevRec;
    else delete state.sm2[card.id];
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

  function startQuiz(customList = null, customLabel = null) {
    qzCustomContext = customLabel;
    const list = customList || getFilteredQuizPool();
    qzQueue = [...list].sort(() => Math.random() - 0.5);
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
    document.getElementById("qzQuestion").textContent = item.q;

    const optsEl = document.getElementById("qzOptions");
    optsEl.innerHTML = "";
    item.options.forEach((txt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-opt";
      btn.innerHTML = `<span class="opt-key">${String.fromCharCode(65 + i)}</span><span class="opt-text">${esc(txt)}</span>`;
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
    });
    const filterBar = document.getElementById("csFilterBar");
    const inp = document.getElementById("csSearch");
    if (filterBar) filterBar.classList.toggle("hidden", csTab === "hierarchy");
    if (inp && CS_PLACEHOLDERS[csTab]) inp.placeholder = CS_PLACEHOLDERS[csTab];
  }

  function renderReference() {
    const wrap = document.getElementById("csContent");
    const inp = document.getElementById("csSearch");
    const clearBtn = document.getElementById("btnClearCsSearch");
    if (clearBtn) clearBtn.classList.toggle("hidden", !(inp.value || "").length);
    const q = (inp.value || "").trim().toLowerCase();
    const cs = PACK.cheatsheet;
    const match = obj => !q || JSON.stringify(obj).toLowerCase().includes(q);

    if (csTab === "timeline") {
      const now = Date.now();
      let markedNext = false;
      const rows = cs.timeline2026.filter(match);
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Data / Ora</th><th>Adempimento</th><th class="col-source">Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const dt = parseItalianDate(r.date);
              let cls = "";
              if (r.date.startsWith("21/11/2026") && r.event.includes("ASSEMBLEA")) cls = "tl-election";
              else if (dt && dt.getTime() < now) cls = "tl-past";
              else if (dt && !markedNext) { markedNext = true; cls = "tl-next"; }
              return `<tr class="${cls}">
                <td data-label="Data / Ora"><span class="num-hl">${esc(r.date)}</span></td>
                <td data-label="Adempimento">${esc(r.event)}</td>
                <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${r.ref}">${esc(formatSourceCitation(r.ref))} ›</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun risultato per «${esc(q)}».</p>`;
    } else if (csTab === "quorums") {
      const rows = cs.quorums.filter(match);
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
              <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${r.ref}">${esc(formatSourceCitation(r.ref))} ›</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun quorum trovato.</p>`;
    } else if (csTab === "organs") {
      const rows = cs.organs.filter(match);
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Organo</th><th>Composizione</th><th>Durata</th><th>Poteri</th><th class="col-source">Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Organo"><strong>${esc(formatOperators(r.name))}</strong></td>
              <td data-label="Composizione">${esc(formatOperators(r.composition))}</td>
              <td data-label="Durata">${esc(formatOperators(r.term))}</td>
              <td data-label="Poteri">${esc(formatOperators(r.powers))}</td>
              <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${r.ref}">${esc(formatSourceCitation(r.ref))} ›</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun organo trovato.</p>`;
    } else if (csTab === "deadlines") {
      const rows = cs.keyDeadlines.filter(match);
      wrap.innerHTML = rows.length ? `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Procedura</th><th>Termine</th><th class="col-source">Fonte</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td data-label="Procedura"><strong>${esc(formatOperators(r.term))}</strong></td>
              <td data-label="Termine">${esc(formatOperators(r.value))}</td>
              <td class="col-source" data-label="Fonte"><button type="button" class="text-action" data-ref-jump="${r.ref}">${esc(formatSourceCitation(r.ref))} ›</button></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="muted">Nessun termine trovato.</p>`;
    } else if (csTab === "hierarchy") {
      wrap.innerHTML = `
        <div class="ref-table-wrap"><table class="ref-table">
          <thead><tr><th>Grado</th><th>Fonte</th><th>Prevalenza e note</th></tr></thead>
          <tbody>
            ${cs.hierarchy.map(r => `<tr>
              <td data-label="Grado"><span class="num-hl">#${r.rank}</span></td>
              <td data-label="Fonte"><strong>${esc(r.source)}</strong></td>
              <td data-label="Note">${esc(r.note)} ${r.ref ? `<button type="button" class="text-action" data-ref-jump="${r.ref}">${esc(formatSourceCitation(r.ref))} ›</button>` : ""}</td>
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
        openArticle(btn.dataset.refJump, { returnTo: { type: "reference", sub: csTab, label: "Sinossi", reason: "Da Sinossi" } });
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
      if (!el.classList.contains("hidden")) { el.classList.add("hidden"); anyOpen = true; }
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

  function sanitizeSnippetText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/(?:(?<=^|\s)(?:s[iì]|no)(?=\s|$)\s*){2,}/gi, " · ")
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
    if (clearBtn) clearBtn.classList.toggle("hidden", !query.length);

    const q = query.trim().toLowerCase();
    gsResults = [];
    gsActiveIdx = -1;

    if (!q) {
      res.innerHTML = `<p class="muted small">Cerca articoli, quorum, date o termini (es. <em>Droop</em>, <em>delega</em>, <em>90 giorni</em>).</p>`;
      if (countEl) countEl.textContent = "Ricerca rapida";
      return;
    }

    const artMatches = ALL_SECTIONS
      .filter(s => s.code.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || (s.text && s.text.toLowerCase().includes(q)))
      .slice(0, 24)
      .map(s => {
        const flat = s.text ? sanitizeSnippetText(s.text) : "";
        const pos = flat ? flat.toLowerCase().indexOf(q) : -1;
        return { kind: "article", meta: `${DOC_SHORT[s.doc]} · ${s.code}`, title: s.title, snip: flat ? sliceCleanSnippet(flat, pos) : "Sezione", target: s.id };
      });

    const sinMatches = [];
    PACK.cheatsheet.quorums.forEach(r => {
      if (JSON.stringify(r).toLowerCase().includes(q)) {
        sinMatches.push({ kind: "reference", meta: "Sinossi · Quorum", title: r.context, snip: `${r.costitutivo} · ${r.deliberativo}`, target: "quorums" });
      }
    });
    PACK.cheatsheet.timeline2026.forEach(r => {
      if (JSON.stringify(r).toLowerCase().includes(q)) {
        sinMatches.push({ kind: "reference", meta: `Sinossi · ${r.date}`, title: "Cronoprogramma 2026", snip: r.event, target: "timeline" });
      }
    });

    const combined = [...artMatches, ...sinMatches.slice(0, 6)];
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
      btn.className = `sr-item ${idx === 0 ? "active" : ""}`;
      btn.innerHTML = `
        <div class="sr-item-meta">${esc(item.meta)}</div>
        <div class="sr-item-title">${highlightQuery(item.title, query)}</div>
        <div class="sr-item-snip">${highlightQuery(item.snip, query)}</div>
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
    const sm2Count = Object.keys(state.sm2).length;
    const bmCount = Object.keys(state.bookmarks).filter(k => state.bookmarks[k]).length;
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
    document.getElementById("metricNormativa").addEventListener("click", () => openArticle(readerSecId || STUDYABLE_SECTIONS[0].id));
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

    // Reader & TOC
    document.getElementById("btnOpenTocDrawer").addEventListener("click", openTocDrawer);
    document.getElementById("btnCloseTocDrawer").addEventListener("click", closeTocDrawer);
    document.getElementById("tocBackdrop").addEventListener("click", closeTocDrawer);

    document.querySelectorAll("#readerDocPills .ios-seg-btn").forEach(b => {
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

    document.querySelectorAll("#readerModeSwitch .ios-seg-btn").forEach(b => {
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

    document.getElementById("btnFontCycle").addEventListener("click", e => {
      e.stopPropagation();
      const pop = document.getElementById("fontPopover");
      const open = pop.classList.toggle("hidden") === false;
      e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.getElementById("fontPopover").addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", closeFontPopover);
    document.getElementById("btnFontDec").addEventListener("click", () => { applyReaderScale(state.readerScale - 0.08); saveState(); });
    document.getElementById("btnFontInc").addEventListener("click", () => { applyReaderScale(state.readerScale + 0.08); saveState(); });

    document.getElementById("btnToggleNums").addEventListener("click", () => {
      state.prefs.highlightNums = !(state.prefs.highlightNums !== false);
      saveState();
      syncNumsToggleUI(state.prefs.highlightNums);
      if (readerSecId) renderReaderArticle(readerSecId, { skipHash: true });
    });

    document.getElementById("readerMasterySelect").addEventListener("change", e => {
      if (!readerSecId) return;
      const val = Number(e.target.value);
      state.mastery[readerSecId] = val;
      if (!state._ts) state._ts = { mastery: {}, bookmarks: {} };
      state._ts.mastery[readerSecId] = Date.now();
      saveState();
      syncAllViewsForStateChange(readerSecId);
      showToast(`Stato: ${STATUS_LABELS[val]}`);
    });

    document.getElementById("btnBookmarkSec").addEventListener("click", () => {
      if (!readerSecId) return;
      if (!state._ts) state._ts = { mastery: {}, bookmarks: {} };
      state._ts.bookmarks[readerSecId] = Date.now();
      if (state.bookmarks[readerSecId]) { delete state.bookmarks[readerSecId]; showToast("Rimosso dai salvati"); }
      else { state.bookmarks[readerSecId] = true; showToast("Salvato"); }
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
      saveState();
      buildFcQueue(false);
    });
    ["fcDocFilter", "fcTagFilter", "fcOnlyDue"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => buildFcQueue(false));
    });
    document.getElementById("btnFcClearFocus").addEventListener("click", () => buildFcQueue(false));
    document.getElementById("btnFcShuffle").addEventListener("click", () => { buildFcQueue(true); showToast("Mazzo mescolato"); });
    document.getElementById("btnFcUndo").addEventListener("click", undoLastFlashcard);
    document.getElementById("flashcardEl").addEventListener("click", flipFlashcard);
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
      buildFcQueue(false);
    });
    document.getElementById("btnFcRestartSession").addEventListener("click", () => buildFcQueue(true));

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
    document.getElementById("btnQzNext").addEventListener("click", () => { qzIdx++; renderQuizQuestion(); window.scrollTo({ top: 0, behavior: "instant" }); });
    document.getElementById("btnQzMobileNext").addEventListener("click", () => { qzIdx++; renderQuizQuestion(); window.scrollTo({ top: 0, behavior: "instant" }); });
    document.getElementById("btnQzExpandOpts").addEventListener("click", e => {
      const pane = document.getElementById("pane-quiz");
      const expanded = pane.classList.toggle("show-all-opts");
      const item = qzQueue[qzIdx];
      const hiddenCount = item ? Math.max(0, item.options.length - (document.querySelectorAll("#qzOptions .quiz-opt.correct, #qzOptions .quiz-opt.wrong").length)) : 2;
      e.currentTarget.setAttribute("aria-expanded", expanded ? "true" : "false");
      const lbl = document.getElementById("qzExpandLabel");
      if (lbl) lbl.textContent = expanded ? "Nascondi altre opzioni" : `Mostra le altre ${hiddenCount} opzioni`;
    });

    // Dynamic stuck state for sticky inline Cloze strip
    const syncClozeStickyState = () => {
      const bar = document.getElementById("inlineClozeStickyBar");
      if (!bar || bar.closest(".hidden") || currentView !== "reader") return;
      const stickyTop = window.innerWidth <= 900 ? 52 : 108;
      const stuck = window.scrollY > 12 && bar.getBoundingClientRect().top <= stickyTop + 2;
      bar.classList.toggle("is-stuck", stuck);
    };
    window.addEventListener("scroll", syncClozeStickyState, { passive: true });
    window.addEventListener("resize", syncClozeStickyState, { passive: true });

    // Practice Cloze
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
      if (!state._ts) state._ts = { mastery: {}, bookmarks: {} };
      state._ts.mastery[practiceClozeSecId] = Date.now();
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
      const pool = CLOZEABLE_SECTIONS.filter(s => (state.mastery[s.id] || 0) < 3 && s.id !== practiceClozeSecId);
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
    document.getElementById("csSearch").addEventListener("input", renderReference);
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
    document.getElementById("globalSearchInput").addEventListener("input", e => renderGlobalSearch(e.target.value));
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
        els.forEach((el, i) => el.classList.toggle("active", i === gsActiveIdx));
        els[gsActiveIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && gsActiveIdx >= 0) {
        e.preventDefault();
        executeSearchResult(gsResults[gsActiveIdx]);
      }
    });

    // Backup & Firebase Cloud Sync Modal
    document.getElementById("btnBackup").addEventListener("click", () => {
      renderBackupSummary();
      updateCloudUI();
      openModal("backupModal");
      const focusTarget = fbUser ? document.getElementById("btnCloudSyncNow") : document.getElementById("btnModalGoogleLogin");
      (focusTarget || document.getElementById("btnExportProgress"))?.focus();
    });
    document.getElementById("btnHomeGoogleLogin")?.addEventListener("click", handleGoogleLogin);
    document.getElementById("btnModalGoogleLogin")?.addEventListener("click", handleGoogleLogin);
    document.getElementById("btnHomeCloudManage")?.addEventListener("click", () => document.getElementById("btnBackup").click());
    document.getElementById("btnCloudSyncNow")?.addEventListener("click", () => {
      if (fbUser) pullAndMergeFromCloud(fbUser.uid, true);
    });
    document.getElementById("btnGoogleLogout")?.addEventListener("click", handleGoogleLogout);

    document.getElementById("closeBackupModal").addEventListener("click", closeAllModals);
    document.getElementById("backupModal").addEventListener("click", e => { if (e.target.id === "backupModal") closeAllModals(); });
    document.getElementById("lblImportProgress").addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("inputImportProgress").click(); }
    });
    document.getElementById("btnExportProgress").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `polinetwork_studio_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("Backup esportato");
    });
    document.getElementById("inputImportProgress").addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imp = JSON.parse(reader.result);
          if (!imp || typeof imp !== "object") throw new Error("invalid");
          state = mergeCloudAndLocalState(state, imp);
          saveState();
          applyFullStateToUI();
          startQuiz();
          closeAllModals();
          showToast("Progressi uniti e sincronizzati");
        } catch (_) {
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
      state = { ...defaultState(), theme, updatedAt: now, resetAt: now };
      if (fbUser) {
        try { localStorage.removeItem(`${STORAGE_KEY}_cloud_${fbUser.uid}`); } catch (_) {}
      }
      saveState();
      applyFullStateToUI();
      startQuiz();
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
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
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
      <div class="ios-container"><div class="apple-card">
        <h2>Errore di caricamento</h2>
        <p class="muted small" style="margin-top:0.5rem;">${esc(String(err))}</p>
      </div></div>`;
  });
})();
