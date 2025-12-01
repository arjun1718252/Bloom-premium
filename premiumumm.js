/* ==== PREMIUM BLOOMMAP+ FRONTEND LOGIC (Edited & hardened) ==== */
/* Copy-paste this file as your premium JS (replaces previous premiumumm.js) */

(function () {
  const STORAGE   = "bloom_premium_state";
  const PROFILE   = "bloom_premium_profile";
  const THEME_KEY = "bloom_premium_theme";

  const SECONDS_PER_SEED = 25 * 60;
  const GRID_DAYS = 31;
  const DEFAULT_STREAK_DAYS = 11;

  // ---------- STORAGE HELPERS ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveState(s) {
    try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch (e) {}
  }

  // ---------- DEFAULT STATE (ensure lastSubjectId is present) ----------
  function defaultState() {
    return {
      subjects: [
        { id: 1, name: "Math",             topics: ["General"] },
        { id: 2, name: "Machine Learning", topics: ["General"] },
        { id: 3, name: "DSA",              topics: ["General"] },
        { id: 4, name: "Web Dev",          topics: ["General"] }
      ],
      lastSubjectId: 4,
      sessions: [],
      seeds: 500,
      // default 11-day streak as requested
      mapTiles: Array.from({length: GRID_DAYS}, (_, i) => i < DEFAULT_STREAK_DAYS)
    };
  }

  let state = loadState() || defaultState();
  // Ensure lastSubjectId exists (in case older saved state didn't have it)
  if (typeof state.lastSubjectId !== 'number') state.lastSubjectId = state.subjects.reduce((m,s)=> Math.max(m,s.id), 0);

  saveState(state); // persist normalized state

  // ---------- THEME VARIABLES FOR MAP STYLING ----------
  const THEME_VARS = {
    "theme-gold": {
      "--streak-bg": "linear-gradient(135deg, rgba(255, 236, 139, 0.18), rgba(255, 179, 71, 0.08))",
      "--streak-bloom": "linear-gradient(135deg,#ffe57f,#ffca28)",
      "--streak-text": "#111827"
    },
    "theme-sunset": {
      "--streak-bg": "linear-gradient(135deg, rgba(255, 117, 140, 0.12), rgba(255, 126, 179, 0.06))",
      "--streak-bloom": "linear-gradient(135deg,#ff758c,#ff7eb3)",
      "--streak-text": "#2b1b21"
    },
    "theme-ocean": {
      "--streak-bg": "linear-gradient(135deg, rgba(79, 172, 254, 0.12), rgba(0, 242, 254, 0.06))",
      "--streak-bloom": "linear-gradient(135deg,#4facfe,#00f2fe)",
      "--streak-text": "#03314b"
    }
  };

  // ---------- TIMER STATE ----------
  let seconds = 0;
  let running = false;
  let timerId = null;
  let currentSubject = state.subjects[0]?.id || 1;
  let currentTopic   = "General";

  function fmt(sec) {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // ---------- FOCUS / FULLSCREEN HELPERS (ADDED) ----------
  // store handler so we can remove it later
  let _focusVisibilityHandler = null;

  function _enterFullscreenSafe() {
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) return docEl.requestFullscreen().catch(()=>{});
      if (docEl.webkitRequestFullscreen) return docEl.webkitRequestFullscreen().catch(()=>{});
      if (docEl.msRequestFullscreen) return docEl.msRequestFullscreen().catch(()=>{});
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  function _exitFullscreenSafe() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
        if (document.exitFullscreen) return document.exitFullscreen().catch(()=>{});
        if (document.webkitExitFullscreen) return document.webkitExitFullscreen().catch(()=>{});
        if (document.msExitFullscreen) return document.msExitFullscreen().catch(()=>{});
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  function _attachVisibilityHandler() {
    // remove existing just in case
    _detachVisibilityHandler();
    _focusVisibilityHandler = function() {
      if (document.hidden) {
        // Pause timer when user leaves the tab
        try { pauseTimer(); } catch(e){ console.error(e); }
        try { toast("Timer paused because you switched tabs — stay focused 🌱", "error"); } catch(e){}
      }
    };
    document.addEventListener("visibilitychange", _focusVisibilityHandler);
  }

  function _detachVisibilityHandler() {
    if (_focusVisibilityHandler) {
      document.removeEventListener("visibilitychange", _focusVisibilityHandler);
      _focusVisibilityHandler = null;
    }
  }

  // ---------- SMALL HELPERS ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function toast(msg, type = "success") {
    const area = document.getElementById("toastArea");
    if (!area) {
      // fallback: console + alert
      if (type === 'error') console.error(msg); else console.log(msg);
      return;
    }
    const div = document.createElement("div");
    div.className = `toast ${type}`;
    div.textContent = msg;
    area.appendChild(div);
    // animate in
    requestAnimationFrame(() => div.classList.add("show"));
    setTimeout(() => {
      div.classList.remove("show");
      setTimeout(() => { try { area.removeChild(div); } catch(e) {} }, 250);
    }, 2200);
  }

  // ---------- RENDER MAP / SEEDS / HISTORY ----------
  function renderSeeds() {
    const el = document.getElementById("seedsDisplay");
    if (el) el.textContent = state.seeds;
  }

  function renderMap() {
    const map = document.getElementById("mapGrid");
    if (!map) return;
    map.innerHTML = "";
    let count = 0;
    state.mapTiles.forEach((tile, idx) => {
      const div = document.createElement("div");
      div.className = tile ? "tile bloom" : "tile";
      div.innerHTML = tile ? "🌱" : "";
      // annotate with index for potential CSS hooks
      div.dataset.day = (idx+1);
      map.appendChild(div);
      if (tile) count++;
    });

    const mp = document.getElementById("mapProgress");
    if (mp) mp.textContent = `${count} / ${GRID_DAYS} days bloomed`;

    // optional streak box
    const streakBox = document.getElementById("streakBox");
    if (streakBox) streakBox.textContent = `${count} days`;
  }

  function renderHistory() {
    const box = document.getElementById("sessionsList");
    if (!box) return;
    if (!state.sessions.length) {
      box.innerHTML = `<div class="small muted">No sessions yet</div>`;
      return;
    }
    box.innerHTML = state.sessions
      .slice()
      .reverse()
      .map(s => `
        <div style="padding:6px 0;display:flex;justify-content:space-between;">
          <strong>${escapeHtml(s.subject)} → ${escapeHtml(s.topic)}</strong>
          <span>${Math.round(s.seconds / 60)} min</span>
        </div>
      `).join("");
  }

  // ---------- SUBJECTS / TOPICS ----------
  function renderSubjectDropdown() {
    const sel = document.getElementById("subjectSelect");
    if (!sel) return;
    // build options
    sel.innerHTML = state.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    // ensure currentSubject is valid
    if (!state.subjects.some(s => s.id === currentSubject)) {
      currentSubject = state.subjects[0]?.id || 1;
    }
    sel.value = currentSubject;
    sel.onchange = () => {
      currentSubject = Number(sel.value);
      const sub = state.subjects.find(s => s.id === currentSubject);
      currentTopic = (sub && sub.topics && sub.topics[0]) || "General";
      renderTopicDropdown();
    };
  }

  function renderTopicDropdown() {
    const sel = document.getElementById("topicSelect");
    if (!sel) return;
    const sub = state.subjects.find(s => s.id === currentSubject) || {topics:['General']};
    sel.innerHTML = (sub.topics || ['General']).map(t => `<option>${escapeHtml(t)}</option>`).join("");
    // keep currentTopic synced
    if (sub.topics && sub.topics.includes(currentTopic)) {
      sel.value = currentTopic;
    } else {
      currentTopic = sub.topics[0] || 'General';
      sel.value = currentTopic;
    }
    sel.onchange = () => currentTopic = sel.value;
  }

  function addSubject() {
    const name = prompt("New subject name:");
    if (!name) return;
    // increment a persistent lastSubjectId and use it
    state.lastSubjectId = (typeof state.lastSubjectId === 'number' ? state.lastSubjectId + 1 : (state.subjects.reduce((m,s)=>Math.max(m,s.id),0)+1));
    const id = state.lastSubjectId;
    state.subjects.push({ id, name: name.trim(), topics: ["General"] });
    currentSubject = id;
    currentTopic = "General";
    saveState(state);
    renderSubjectDropdown();
    renderTopicDropdown();
    toast("Subject added ✅");
  }

  function addTopic() {
    const name = prompt("New topic name:");
    if (!name) return;
    const sub = state.subjects.find(s => s.id === currentSubject);
    if (!sub) {
      toast("No subject selected", "error"); return;
    }
    const topicTrim = name.trim();
    // de-duplicate case-insensitively
    if (!sub.topics.some(t => t.toLowerCase() === topicTrim.toLowerCase())) {
      sub.topics.push(topicTrim);
      currentTopic = topicTrim;
      saveState(state);
      renderTopicDropdown();
      toast("Topic added ✅");
    } else {
      toast("Topic already exists", "error");
    }
  }

  // ---------- TIMER UI / LOGIC ----------
  function updateTimerUI() {
    const td = document.getElementById("timeDisplay");
    if (td) td.textContent = fmt(seconds);

    const pauseBtn = document.getElementById("pauseTimer");
    const saveBtn  = document.getElementById("saveSession");
    if (pauseBtn) pauseBtn.disabled = !running;
    if (saveBtn)  saveBtn.disabled  = seconds < 60;
  }

  function updateRing() {
    const ring = document.getElementById("ringProg");
    const progress = (seconds % SECONDS_PER_SEED) / SECONDS_PER_SEED;
    if (ring) {
      const circ = 2 * Math.PI * 190;
      // if strokeDasharray supported by CSS, update; if not, it's harmless
      ring.style.strokeDashoffset = circ * (1 - progress);
    }
  }

  function tick() {
    seconds++;
    updateTimerUI();
    updateRing();
  }

  function startTimer() {
    if (running) return;
    running = true;
    timerId = setInterval(tick, 1000);
    updateTimerUI();

    // === NEW: Enter fullscreen and attach visibility handler to pause on tab change ===
    _enterFullscreenSafe().then(()=>{/* ignore errors */});
    _attachVisibilityHandler();
  }

  function pauseTimer() {
    running = false;
    clearInterval(timerId);
    updateTimerUI();

    // === NEW: Exit fullscreen & remove visibility handler ===
    _exitFullscreenSafe().then(()=>{/* ignore errors */});
    _detachVisibilityHandler();
  }

  function resetTimer() {
    running = false;
    clearInterval(timerId);
    seconds = 0;
    updateTimerUI();
    updateRing();

    // === NEW: Exit fullscreen & remove visibility handler ===
    _exitFullscreenSafe().then(()=>{/* ignore errors */});
    _detachVisibilityHandler();
  }

  function saveSession() {
    if (seconds < 60) {
      toast("Study at least 1 minute before saving ⏱️", "error");
      return;
    }
    const sub = state.subjects.find(s => s.id === currentSubject) || {name: 'Unknown'};
    const earned = Math.floor(seconds / SECONDS_PER_SEED);

    state.sessions.push({
      subject: sub.name,
      topic: currentTopic,
      seconds,
      date: Date.now()
    });

    if (earned > 0) {
      state.seeds += earned;
      awardStreakTiles(earned);
    }

    saveState(state);
    resetTimer();
    renderSeeds();
    renderMap();
    renderHistory();
    toast("Session saved 🌸");
  }

  function awardStreakTiles(n) {
    let given = 0;
    for (let i = 0; i < GRID_DAYS && given < n; i++) {
      if (!state.mapTiles[i]) {
        state.mapTiles[i] = true;
        given++;
      }
    }
    saveState(state);
  }

  // ---------- THEME MANAGEMENT ----------
  function applyCssVarsForTheme(themeClass) {
    const vars = THEME_VARS[themeClass] || THEME_VARS["theme-gold"];
    const root = document.documentElement;
    Object.keys(vars).forEach(k => {
      root.style.setProperty(k, vars[k]);
    });

    // update tile visuals immediately if map already rendered
    const tiles = document.querySelectorAll('.mapgrid-31 .tile');
    tiles.forEach(t => {
      if (t.classList.contains('bloom')) {
        t.style.background = getComputedStyle(document.documentElement).getPropertyValue('--streak-bloom') || vars["--streak-bloom"];
        t.style.color = getComputedStyle(document.documentElement).getPropertyValue('--streak-text') || vars["--streak-text"];
      } else {
        t.style.background = getComputedStyle(document.documentElement).getPropertyValue('--streak-bg') || vars["--streak-bg"];
        t.style.color = '';
      }
    });
  }

  function applyTheme(themeClass) {
    if (!themeClass) themeClass = "theme-sunset";
    // clear known theme classes and add
    document.body.classList.remove("theme-gold", "theme-sunset", "theme-ocean", "theme-sky", "theme-cherry");
    document.body.classList.add(themeClass);
    try { localStorage.setItem(THEME_KEY, themeClass); } catch (e) {}
    applyCssVarsForTheme(themeClass);
    // sync switcher UI if present
    const sel = document.getElementById("themeSwitcher");
    if (sel) sel.value = themeClass;
    // show theme changed popup
    toast("Theme changed", "success");
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { saved = null; }
    if (!saved) {
      saved = "theme-sunset"; // requested default
      try{ localStorage.setItem(THEME_KEY, saved); } catch(e) {}
    }
    applyTheme(saved);
  }

  // ---------- ANALYTICS: ALWAYS-SHOW CHARTS (with "No info yet" fallbacks) ----------
  // We'll create charts for: pieChart, lineChart, areaChart, barChart.
  // If there's no data, we'll render a minimal chart + show a fallback overlay saying "No info yet".

  // Helper: ensure a fallback overlay exists next to a canvas
  function ensureFallback(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const host = canvas.parentElement;
    if (!host) return null;
    let fb = host.querySelector('.chart-fallback');
    if (!fb) {
      fb = document.createElement('div');
      fb.className = 'chart-fallback';
      fb.style.position = 'absolute';
      fb.style.inset = '0';
      fb.style.display = 'flex';
      fb.style.alignItems = 'center';
      fb.style.justifyContent = 'center';
      fb.style.zIndex = '2';
      fb.style.pointerEvents = 'none';
      fb.style.fontSize = '1.05rem';
      fb.style.opacity = '0.9';
      fb.textContent = 'No info yet 🍀';
      host.style.position = 'relative';
      host.appendChild(fb);
    }
    return fb;
  }

  function initAnalytics() {
    initTheme(); // ensure theme styles applied
    const st = loadState() || defaultState();

    // Welcome name
    const profile = JSON.parse(localStorage.getItem(PROFILE) || "{}");
    const w = document.getElementById("welcomeA");
    if (profile && profile.name && w) w.textContent = `Hey ${profile.name} 👋`;

    // total seeds
    const totalSeedsEl = document.getElementById("totalSeedsA");
    if (totalSeedsEl) totalSeedsEl.textContent = st.seeds ?? 0;

    const sessions = st.sessions || [];

    // subject totals
    const subjectTotals = {};
    sessions.forEach(s => {
      subjectTotals[s.subject] = (subjectTotals[s.subject] || 0) + (s.seconds / 60);
    });
    const labels = Object.keys(subjectTotals);
    const data   = Object.values(subjectTotals);

    const hasSubjectData = data.length && data.some(v => v > 0);
    // PIE
    (function renderPie(){
      const pieCanvas = document.getElementById("pieChart");
      if(!pieCanvas) return;
      const fb = ensureFallback("pieChart");
      const pieData = hasSubjectData ? data : [1];
      const pieLabels = hasSubjectData ? labels : ['No Data'];
      const bg = ["#ffd34d","#ffeb99","#ffe082","#ffca28","#ffb300","#ffb74d","#ffcc80"];
      if(!hasSubjectData && fb) fb.style.display = 'flex';
      if(hasSubjectData && fb) fb.style.display = 'none';
      if (window.Chart && pieCanvas) {
        // destroy previous chart instance if exists (Chart.js attaches to canvas._chart)
        if (pieCanvas._chart) pieCanvas._chart.destroy();
        pieCanvas._chart = new Chart(pieCanvas, {
          type: "pie",
          data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: bg.slice(0, pieData.length) }] },
          options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
      }
    })();

    // LINE (last 7 days)
    (function renderLine(){
      const lineCanvas = document.getElementById("lineChart");
      if(!lineCanvas) return;
      const fb = ensureFallback("lineChart");
      // build last 7 days
      const daily = Array(7).fill(0);
      const now = Date.now();
      sessions.forEach(s => {
        const diff = Math.floor((now - s.date) / 86400000);
        if (diff >= 0 && diff < 7) daily[6 - diff] += s.seconds / 60;
      });
      const hasDaily = daily.some(v => v > 0);
      if(!hasDaily && fb) fb.style.display = 'flex';
      if(hasDaily && fb) fb.style.display = 'none';
      if (window.Chart && lineCanvas) {
        if (lineCanvas._chart) lineCanvas._chart.destroy();
        lineCanvas._chart = new Chart(lineCanvas, {
          type: "line",
          data: { labels: ["D1","D2","D3","D4","D5","D6","Today"], datasets: [{ data: daily, borderWidth: 3, tension: 0.35, fill: true }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: "Minutes" } } } }
        });
      }
    })();

    // AREA (cumulative)
    (function renderArea(){
      const areaCanvas = document.getElementById("areaChart");
      if(!areaCanvas) return;
      const fb = ensureFallback("areaChart");
      // reuse daily values
      const daily = Array(7).fill(0);
      const now = Date.now();
      sessions.forEach(s => {
        const diff = Math.floor((now - s.date) / 86400000);
        if (diff >= 0 && diff < 7) daily[6 - diff] += s.seconds / 60;
      });
      const hasDaily = daily.some(v => v > 0);
      // cumulative
      const cum = [];
      let sum = 0;
      for (const v of daily) { sum += v; cum.push(sum); }
      if(!hasDaily && fb) fb.style.display = 'flex';
      if(hasDaily && fb) fb.style.display = 'none';
      if (window.Chart && areaCanvas) {
        if (areaCanvas._chart) areaCanvas._chart.destroy();
        areaCanvas._chart = new Chart(areaCanvas, {
          type: "line",
          data: { labels: ["D1","D2","D3","D4","D5","D6","Today"], datasets: [{ data: cum, fill: true, borderWidth: 2, tension: 0.35 }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
      }
    })();

    // BAR (subject minutes)
    (function renderBar(){
      const barCanvas = document.getElementById("barChart");
      if(!barCanvas) return;
      const fb = ensureFallback("barChart");
      if(!hasSubjectData && fb) fb.style.display = 'flex';
      if(hasSubjectData && fb) fb.style.display = 'none';
      const barLabels = hasSubjectData ? labels : ['No Data'];
      const barData = hasSubjectData ? data : [0];
      if (window.Chart && barCanvas) {
        if (barCanvas._chart) barCanvas._chart.destroy();
        barCanvas._chart = new Chart(barCanvas, {
          type: "bar",
          data: { labels: barLabels, datasets: [{ label: "Minutes", data: barData }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
      }
    })();

    // SESSIONS (last 5) - optional extra chart if present
    (function renderSessions(){
      const sessionsCanvas = document.getElementById("sessionsChart");
      if(!sessionsCanvas) return;
      const fb = ensureFallback("sessionsChart");
      const last = (sessions.slice().reverse()).slice(0,5).reverse();
      const lab = last.length ? last.map(s=> new Date(s.date).toLocaleDateString()) : ['No Data'];
      const vals = last.length ? last.map(s=> Math.round(s.seconds/60)) : [0];
      if(!last.length && fb) fb.style.display = 'flex';
      if(last.length && fb) fb.style.display = 'none';
      if (window.Chart && sessionsCanvas) {
        if (sessionsCanvas._chart) sessionsCanvas._chart.destroy();
        sessionsCanvas._chart = new Chart(sessionsCanvas, {
          type: "bar",
          data: { labels: lab, datasets: [{ label: "Minutes", data: vals }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
      }
    })();
  }

  // ---------- PUBLIC API ----------
  window.BloomPremium = {
    initDashboard() {
      initTheme();
      // greet
      const profile = JSON.parse(localStorage.getItem(PROFILE) || "{}");
      if (profile && profile.name) {
        const g = document.getElementById("greetText");
        if (g) g.textContent = `Hey ${profile.name} 👋`;
      }
      // render UI
      renderSubjectDropdown();
      renderTopicDropdown();
      renderSeeds();
      renderMap();
      renderHistory();
      updateTimerUI();
      updateRing();
      // make sure vars match theme
      const currentTheme = (localStorage.getItem(THEME_KEY) || "theme-sunset");
      applyCssVarsForTheme(currentTheme);
    },

    startTimer,
    pauseTimer,
    resetTimer,
    saveSession,
    addSubject,
    addTopic,
    changeTheme: applyTheme,
    initAnalytics
  };

  // ---------- NON-INVASIVE UI ENHANCEMENTS (Enter key, logo trick, theme switcher wiring) ----------

  // activate enter key on signin input if present
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const userInput = document.getElementById('usernameInput');
      const startBtn = document.getElementById('startBtn');
      if (userInput && startBtn) {
        userInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            startBtn.click();
          }
        });
      }
    } catch (e) {}
  });

  // logo blending tweak for transparent logos (non-destructive)
  document.addEventListener('DOMContentLoaded', () => {
    const logo = document.querySelector('.signin-logo') || document.querySelector('.topbar img');
    if (logo) {
      try {
        logo.style.background = 'transparent';
        logo.style.mixBlendMode = 'screen';
        logo.style.width = logo.style.width || '64px';
        logo.style.height = logo.style.height || '64px';
        logo.style.borderRadius = logo.style.borderRadius || '14px';
      } catch (e) {}
    }
  });

  // theme switcher wiring (if present on page)
  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('themeSwitcher');
    if (sel) {
      // ensure only the three allowed themes are present (do not append others)
      const allowed = ['theme-gold','theme-sunset','theme-ocean'];
      // clear existing options and add the allowed ones to avoid duplicates
      sel.innerHTML = '';
      allowed.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        // friendly display name
        opt.textContent = (v === 'theme-gold') ? 'Golden Glow ✨' : (v === 'theme-sunset') ? 'Rose Sunset 🌇' : 'Ocean Calm 🌊';
        sel.appendChild(opt);
      });
      const saved = localStorage.getItem(THEME_KEY) || 'theme-sunset';
      sel.value = saved;
      sel.addEventListener('change', (e) => {
        const v = e.target.value;
        if (allowed.includes(v)) {
          applyTheme(v);
        }
      });
    }
  });

  // final render safety on load
  window.addEventListener('load', () => {
    renderSeeds();
    renderMap();
    renderHistory();
    // set CSS vars per theme
    const themeNow = localStorage.getItem(THEME_KEY) || 'theme-sunset';
    applyCssVarsForTheme(themeNow);
  });

})();
