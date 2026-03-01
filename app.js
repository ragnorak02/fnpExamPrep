(function () {
  'use strict';

  // ========== APP META ==========
  var APP_VERSION = '1.0.0';
  var APP_ENV = (function () {
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return 'development';
    if (host.indexOf('.github.io') !== -1) return 'production';
    return 'staging';
  })();
  var APP_CONFIG = {
    supabaseUrl: APP_ENV === 'production'
      ? 'https://xzfkvhfgxyqasqvlidvd.supabase.co'
      : 'http://localhost:54321',
    supabaseAnonKey: 'sb_publishable_YI1Z0Lmj2w_EAthVguxJTg_ZPkWqklc',
    apiBaseUrl: APP_ENV === 'production'
      ? 'https://xzfkvhfgxyqasqvlidvd.supabase.co/functions/v1'
      : 'http://localhost:54321/functions/v1',
    debug: APP_ENV !== 'production'
  };

  function debugLog() {
    if (APP_CONFIG.debug) {
      console.log.apply(console, ['[FNP]'].concat(Array.prototype.slice.call(arguments)));
    }
  }

  // ========== STORAGE ==========
  function safeParse(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Corrupt data for ' + key + ', resetting.', e);
      localStorage.removeItem(key);
      return fallback;
    }
  }

  function save(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) {
      console.error('Failed to save ' + key, e);
      showToast('Storage full — progress may not be saved.', 'error');
    }
  }

  // ========== STATE ==========
  // Migrate history: unwrap { byId: ... } wrapper if present, else use flat
  var _rawHistory = safeParse('fnp:history', {});
  if (_rawHistory && _rawHistory.byId) {
    _rawHistory = _rawHistory.byId;
  }
  // Ensure memorized + forceRepracticeUntilISO fields exist on every entry
  Object.keys(_rawHistory).forEach(function (id) {
    var h = _rawHistory[id];
    if (h.memorized === undefined) h.memorized = false;
    if (h.forceRepracticeUntilISO === undefined) h.forceRepracticeUntilISO = null;
  });

  var _rawSettings = safeParse('fnp:settings', {
    theme: 'dark',
    questionsPerDay: 5,
    reviewMode: 'daily',
    topicFilter: null,
    excludeMastered: false,
    excludeMemorized: false
  });
  // Ensure new keys exist on migrated settings
  if (_rawSettings.excludeMemorized === undefined) _rawSettings.excludeMemorized = false;

  var state = {
    settings: _rawSettings,
    questionBank: safeParse('fnp:questionBank', null),
    history: _rawHistory,
    daily: safeParse('fnp:daily', null),
    usage: safeParse('fnp:usage', {
      lastOpenISODate: null,
      streakCount: 0,
      totalDaysUsed: 0,
      firstOpenTimestamps: []
    }),
    quotes: [],
    // Session state (not persisted directly)
    session: null,
    selectedChoice: null
  };

  function saveHistory() {
    save('fnp:history', { byId: state.history });
  }

  // ========== DOM REFERENCES ==========
  var $  = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return document.querySelectorAll(sel); };

  // ========== INIT ==========
  async function init() {
    debugLog('Starting FNP Exam Prep', APP_VERSION, '(' + APP_ENV + ')');

    // Apply theme immediately
    applyTheme();

    // Show loading state
    var startBtn = document.querySelector('#start-session-btn');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = 'Loading questions...';
    }

    // Load quotes
    try {
      var res = await fetch('data/quotes.json');
      state.quotes = await res.json();
    } catch (e) {
      state.quotes = ['You\'re doing great! Keep going!'];
    }

    // Seed question bank on first run
    if (!state.questionBank) {
      try {
        var qRes = await fetch('data/questions.seed.json');
        state.questionBank = await qRes.json();
        save('fnp:questionBank', state.questionBank);
      } catch (e) {
        showToast('Could not load questions. If using file:// protocol, please host on a local server (e.g., npx serve) or static hosting.', 'error');
        state.questionBank = [];
        save('fnp:questionBank', state.questionBank);
      }
    }

    // Restore start button
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start Session';
    }

    // Initialize daily tracker (handles migration from old schema)
    initDaily();

    // Resume check: if there's an incomplete session in daily, rebuild it
    var daily = state.daily;
    if (daily.sessionQuestionIds.length > 0 && !daily.completedAtISO) {
      var bank = state.questionBank || [];
      var bankMap = {};
      bank.forEach(function (q) { bankMap[q.id] = q; });

      var sessionQuestions = [];
      daily.sessionQuestionIds.forEach(function (id) {
        if (bankMap[id]) sessionQuestions.push(bankMap[id]);
      });

      if (sessionQuestions.length > 0) {
        // Count correct from persisted answers
        var correctCount = 0;
        Object.keys(daily.answersById).forEach(function (id) {
          var a = daily.answersById[id];
          if (a.isSubmitted && a.isCorrect) correctCount++;
        });

        state.session = {
          questions: sessionQuestions,
          currentIndex: daily.currentIndex,
          correctCount: correctCount,
          mode: 'daily'
        };

        $('#practice-start').classList.add('hidden');
        $('#practice-summary').classList.add('hidden');
        $('#practice-session').classList.remove('hidden');
        navigateTo(daily.currentIndex);
      }
    }

    // Check streak
    checkAndUpdateStreak();

    // Bind events
    bindEvents();

    // Render active view
    updateDailyPill();
    renderActiveView();
  }

  // ========== THEME ==========
  function applyTheme() {
    var theme = state.settings.theme;
    document.documentElement.setAttribute('data-theme', theme);
    $('#theme-toggle').textContent = theme === 'dark' ? '🌙' : '☀️';
    $('#theme-switch').checked = theme === 'dark';
  }

  function toggleTheme() {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    save('fnp:settings', state.settings);
    applyTheme();
  }

  // ========== DAILY TRACKER ==========
  function getTodayISODate() {
    return new Date().toLocaleDateString('en-CA');
  }

  function createFreshDaily() {
    return {
      isoDate: getTodayISODate(),
      sessionQuestionIds: [],
      currentIndex: 0,
      answersById: {},
      markedById: {},
      completedAtISO: null
    };
  }

  function initDaily() {
    var today = getTodayISODate();
    // Migrate or reset: missing, old schema (has 'date' instead of 'isoDate'), or new day
    if (!state.daily || state.daily.date !== undefined || state.daily.isoDate !== today) {
      state.daily = createFreshDaily();
      save('fnp:daily', state.daily);
    }
  }

  function updateDailyPill() {
    var count = 0;
    if (state.daily && state.daily.answersById) {
      Object.keys(state.daily.answersById).forEach(function (id) {
        if (state.daily.answersById[id].isSubmitted) count++;
      });
    }
    $('#daily-count').textContent = count;
    $('#daily-goal').textContent = state.settings.questionsPerDay;
  }

  // ========== STREAK + TOAST ==========
  function checkAndUpdateStreak() {
    var today = getTodayISODate();
    var usage = state.usage;

    if (usage.lastOpenISODate === today) return; // Already opened today

    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayISO = yesterday.toISOString().slice(0, 10);

    if (usage.lastOpenISODate === yesterdayISO) {
      usage.streakCount++;
    } else if (usage.lastOpenISODate !== null) {
      usage.streakCount = 1;
    } else {
      usage.streakCount = 1;
    }

    usage.lastOpenISODate = today;
    usage.totalDaysUsed++;
    usage.firstOpenTimestamps.push(new Date().toISOString());

    save('fnp:usage', usage);

    // Show welcome toast with streak and quote
    var quote = randomQuote();
    var msg = '';
    if (usage.streakCount > 1) {
      msg = '🔥 ' + usage.streakCount + '-day streak! ' + quote;
    } else {
      msg = 'Welcome back! ' + quote;
    }
    showToast(msg);
  }

  function randomQuote() {
    if (!state.quotes.length) return '';
    return state.quotes[Math.floor(Math.random() * state.quotes.length)];
  }

  function showToast(message, type) {
    var container = $('#toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' toast-' + type : '');
    if (type === 'error') {
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'assertive');
    } else {
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
    }
    toast.innerHTML =
      '<span class="toast-message">' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Close">&times;</button>';

    container.appendChild(toast);

    var closeBtn = toast.querySelector('.toast-close');
    var timeout;

    function dismiss() {
      clearTimeout(timeout);
      toast.classList.add('closing');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }

    closeBtn.addEventListener('click', dismiss);
    timeout = setTimeout(dismiss, 6000);
  }

  // ========== TABS / NAVIGATION ==========
  function switchView(viewId) {
    // Session is persisted — switching tabs loses nothing
    _doSwitchView(viewId);
  }

  function _doSwitchView(viewId) {
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $$('.tab-btn').forEach(function (b) {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });

    var view = $('#view-' + viewId);
    if (view) view.classList.add('active');

    var tab = document.querySelector('.tab-btn[data-view="' + viewId + '"]');
    if (tab) {
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
    }

    // Render view-specific content
    if (viewId === 'practice') showResumeIfNeeded();
    if (viewId === 'stats') renderStats();
    if (viewId === 'bank') renderBank();
    if (viewId === 'settings') renderSettings();
  }

  function renderActiveView() {
    var activeTab = document.querySelector('.tab-btn.active');
    if (activeTab) {
      var viewId = activeTab.getAttribute('data-view');
      if (viewId === 'stats') renderStats();
      if (viewId === 'bank') renderBank();
      if (viewId === 'settings') renderSettings();
    }
    populateTopicFilter();
  }

  // ========== PRACTICE SESSION ==========
  function getSelectedMode() {
    var checked = document.querySelector('#mode-selector input[type="radio"]:checked');
    return checked ? checked.value : 'daily';
  }

  function populateTopicFilter() {
    var select = $('#topic-filter-select');
    var topics = getTopics();
    select.innerHTML = '<option value="">All Topics</option>';
    topics.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      select.appendChild(opt);
    });
  }

  function getTopics() {
    var topicSet = {};
    (state.questionBank || []).forEach(function (q) {
      if (q.topic) topicSet[q.topic] = true;
    });
    return Object.keys(topicSet).sort();
  }

  function startSession() {
    var mode = getSelectedMode();
    var topicFilter = null;

    if (mode === 'topic') {
      topicFilter = $('#topic-filter-select').value || null;
    }

    // Warn if Weak Areas selected with no history
    if (mode === 'weak' && Object.keys(state.history).length === 0) {
      showModal('No Data Yet', '<p>Weak Areas mode needs practice history to identify your weak topics. Try a Daily Mix session first!</p>', [
        { label: 'OK', class: 'btn-primary', action: hideModal }
      ]);
      return;
    }

    var count = state.settings.questionsPerDay;
    var questions = selectQuestions(mode, topicFilter, count);

    if (questions.length === 0) {
      showToast('No questions available for this mode. Try a different mode or add more questions.', 'info');
      return;
    }

    // Persist to daily
    var daily = state.daily;
    daily.sessionQuestionIds = questions.map(function (q) { return q.id; });
    daily.answersById = {};
    daily.markedById = {};
    daily.currentIndex = 0;
    daily.completedAtISO = null;
    save('fnp:daily', daily);

    state.session = {
      questions: questions,
      currentIndex: 0,
      correctCount: 0,
      mode: mode
    };

    state.selectedChoice = null;

    $('#practice-start').classList.add('hidden');
    $('#practice-summary').classList.add('hidden');
    $('#practice-session').classList.remove('hidden');

    navigateTo(0);
  }

  function selectQuestions(mode, topicFilter, count) {
    var pool = (state.questionBank || []).slice();
    var history = state.history;
    var now = new Date();
    var nowISO = now.toISOString();
    var threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Filter by topic
    if (topicFilter) {
      pool = pool.filter(function (q) { return q.topic === topicFilter; });
    }

    // Exclude mastered
    if (state.settings.excludeMastered) {
      pool = pool.filter(function (q) {
        var h = history[q.id];
        return !h || !h.mastered;
      });
    }

    if (mode === 'flagged') {
      pool = pool.filter(function (q) {
        var h = history[q.id];
        return h && h.flagged;
      });
      shuffleArray(pool);
      return pool.slice(0, count);
    }

    if (mode === 'weak') {
      pool.sort(function (a, b) {
        var ha = history[a.id];
        var hb = history[b.id];
        var accA = ha && ha.timesSeen > 0 ? ha.timesCorrect / ha.timesSeen : 0.5;
        var accB = hb && hb.timesSeen > 0 ? hb.timesCorrect / hb.timesSeen : 0.5;
        return accA - accB;
      });
      return pool.slice(0, count);
    }

    // 5-Bucket selection for daily/topic modes
    var repractice = [];     // Bucket 1: forceRepracticeUntilISO > now
    var recentWrong = [];    // Bucket 2: incorrect within 72h
    var unseen = [];         // Bucket 3: no history or timesSeen === 0
    var seenNotMemo = [];    // Bucket 4: seen, not memorized
    var memorized = [];      // Bucket 5: memorized (lowest priority)

    pool.forEach(function (q) {
      var h = history[q.id];

      if (!h || h.timesSeen === 0) {
        unseen.push(q);
        return;
      }

      // Repractice always goes to bucket 1
      if (h.forceRepracticeUntilISO && h.forceRepracticeUntilISO > nowISO) {
        repractice.push(q);
        return;
      }

      // Memorized
      if (h.memorized) {
        memorized.push(q);
        return;
      }

      // Incorrect within 72h
      if (h.timesWrong > 0 && h.lastSeenISO && h.lastSeenISO >= threeDaysAgo) {
        recentWrong.push(q);
        return;
      }

      // Seen, not memorized
      seenNotMemo.push(q);
    });

    // Sort seenNotMemo by oldest-seen first
    seenNotMemo.sort(function (a, b) {
      var ha = history[a.id];
      var hb = history[b.id];
      return (ha.lastSeenISO || '').localeCompare(hb.lastSeenISO || '');
    });

    // Shuffle within each bucket for variety
    shuffleArray(repractice);
    shuffleArray(recentWrong);
    shuffleArray(unseen);
    shuffleArray(seenNotMemo);
    shuffleArray(memorized);

    // Pull from buckets in priority order
    var selected = [];
    var buckets = [repractice, recentWrong, unseen, seenNotMemo];

    // Only include memorized bucket if not excluded
    if (!state.settings.excludeMemorized) {
      buckets.push(memorized);
    }

    for (var bi = 0; bi < buckets.length && selected.length < count; bi++) {
      var bucket = buckets[bi];
      for (var qi = 0; qi < bucket.length && selected.length < count; qi++) {
        selected.push(bucket[qi]);
      }
    }

    return selected;
  }

  // ========== SESSION NAVIGATION ==========
  function navigateTo(index) {
    var s = state.session;
    if (!s) return;
    if (index < 0) index = 0;
    if (index >= s.questions.length) index = s.questions.length - 1;
    s.currentIndex = index;
    state.daily.currentIndex = index;
    save('fnp:daily', state.daily);
    renderQuestion();
  }

  function renderPips() {
    var s = state.session;
    if (!s) return;
    var container = $('#pip-container');
    if (!container) return;
    container.innerHTML = '';
    var daily = state.daily;

    for (var i = 0; i < s.questions.length; i++) {
      var pip = document.createElement('button');
      pip.className = 'pip';
      pip.setAttribute('aria-label', 'Question ' + (i + 1));
      var qid = s.questions[i].id;
      var answer = daily.answersById[qid];

      if (answer && answer.isSubmitted) {
        if (answer.isCorrect) {
          pip.classList.add('pip-correct');
        } else {
          pip.classList.add('pip-incorrect');
        }
        // Check if memorized
        var hist = state.history[qid];
        if (hist && hist.memorized) {
          pip.classList.add('pip-memorized');
        }
      } else if (answer && answer.selectedIndex !== null && answer.selectedIndex !== undefined) {
        pip.classList.add('pip-selected');
      }

      if (i === s.currentIndex) {
        pip.classList.add('pip-current');
      }

      (function (idx) {
        pip.addEventListener('click', function () { navigateTo(idx); });
      })(i);

      container.appendChild(pip);
    }

    // Update prev/next button states
    var prevBtn = $('#prev-btn');
    var nextNavBtn = $('#next-nav-btn');
    if (prevBtn) prevBtn.disabled = (s.currentIndex <= 0);
    if (nextNavBtn) nextNavBtn.disabled = (s.currentIndex >= s.questions.length - 1);
  }

  function renderQuestion() {
    var s = state.session;
    if (!s || s.currentIndex >= s.questions.length) {
      endSession();
      return;
    }

    var q = s.questions[s.currentIndex];
    var qid = q.id;
    var daily = state.daily;
    var answerEntry = daily.answersById[qid];
    var isSubmitted = answerEntry && answerEntry.isSubmitted;

    state.selectedChoice = (answerEntry && answerEntry.selectedIndex !== null && answerEntry.selectedIndex !== undefined) ? answerEntry.selectedIndex : null;

    // Progress — count submitted answers
    var submittedCount = 0;
    var correctCount = 0;
    Object.keys(daily.answersById).forEach(function (id) {
      var a = daily.answersById[id];
      if (a.isSubmitted) {
        submittedCount++;
        if (a.isCorrect) correctCount++;
      }
    });
    s.correctCount = correctCount;

    $('#q-counter').textContent = 'Question ' + (s.currentIndex + 1) + ' of ' + s.questions.length;
    $('#q-score').textContent = correctCount + ' correct';
    var pct = (submittedCount / s.questions.length) * 100;
    $('#progress-fill').style.width = pct + '%';

    // Topic badge
    $('#q-topic').textContent = q.topic || '';

    // Stem
    $('#q-stem').textContent = q.stem;

    // Choices
    var choicesEl = $('#q-choices');
    choicesEl.innerHTML = '';
    q.choices.forEach(function (choice, i) {
      var btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = choice;
      btn.setAttribute('data-index', i);

      if (isSubmitted) {
        // Locked state — show results
        btn.disabled = true;
        if (i === q.answer) {
          btn.classList.add('correct');
          btn.insertAdjacentHTML('beforeend', '<span class="choice-icon">\u2713</span>');
        }
        if (i === answerEntry.selectedIndex && !answerEntry.isCorrect) {
          btn.classList.add('incorrect');
          btn.insertAdjacentHTML('beforeend', '<span class="choice-icon">\u2717</span>');
        }
      } else {
        // Active state
        if (state.selectedChoice === i) {
          btn.classList.add('selected');
        }
        btn.addEventListener('click', function () {
          handleChoiceClick(i);
        });
      }

      choicesEl.appendChild(btn);
    });

    // Submit button / feedback area
    if (isSubmitted) {
      $('#submit-btn').classList.add('hidden');
      $('#feedback-area').classList.remove('hidden');
      $('#rationale-box').textContent = q.rationale || 'No rationale available.';
      $('#rationale-box').classList.add('hidden');
      $('#rationale-toggle').textContent = 'Show Rationale \u25BC';
      // Initialize learning controls
      initLearningControls(qid);
    } else {
      $('#submit-btn').disabled = (state.selectedChoice === null);
      $('#submit-btn').classList.remove('hidden');
      $('#feedback-area').classList.add('hidden');
      $('#rationale-box').classList.add('hidden');
      $('#rationale-toggle').textContent = 'Show Rationale \u25BC';
    }

    // Update flag button
    var hist = state.history[qid];
    $('#flag-btn').textContent = (hist && hist.flagged) ? 'Unflag' : 'Flag';

    // Render navigation pips
    renderPips();
  }

  function initLearningControls(qid) {
    var hist = state.history[qid];
    var memorizedToggle = $('#memorized-toggle');
    var backBtn = $('#back-into-mix-btn');

    if (memorizedToggle) {
      memorizedToggle.checked = (hist && hist.memorized) || false;
    }

    if (backBtn) {
      var isRepractice = hist && hist.forceRepracticeUntilISO && new Date(hist.forceRepracticeUntilISO) > new Date();
      if (isRepractice) {
        backBtn.textContent = 'Remove from Mix';
        backBtn.classList.add('back-into-mix-active');
      } else {
        backBtn.textContent = 'Back Into Mix';
        backBtn.classList.remove('back-into-mix-active');
      }
    }
  }

  function handleChoiceClick(index) {
    var s = state.session;
    if (!s) return;
    var q = s.questions[s.currentIndex];
    var qid = q.id;

    // If already submitted, ignore
    var existing = state.daily.answersById[qid];
    if (existing && existing.isSubmitted) return;

    state.selectedChoice = index;

    // Persist selection
    state.daily.answersById[qid] = {
      selectedIndex: index,
      isSubmitted: false,
      isCorrect: null
    };
    save('fnp:daily', state.daily);

    // Update UI
    $$('.choice-btn').forEach(function (btn) {
      btn.classList.remove('selected');
    });
    var selectedBtn = document.querySelector('.choice-btn[data-index="' + index + '"]');
    if (selectedBtn) selectedBtn.classList.add('selected');

    $('#submit-btn').disabled = false;
  }

  function submitAnswer() {
    if (state.selectedChoice === null) return;

    var s = state.session;
    var q = s.questions[s.currentIndex];
    var qid = q.id;
    var chosen = state.selectedChoice;
    var daily = state.daily;

    // Guard: prevent double-count
    var entry = daily.answersById[qid];
    if (entry && entry.isSubmitted) return;

    var isCorrect = chosen === q.answer;

    // Update daily answer entry
    daily.answersById[qid] = {
      selectedIndex: chosen,
      isSubmitted: true,
      isCorrect: isCorrect
    };

    // Check if all questions submitted
    var allSubmitted = true;
    for (var i = 0; i < s.questions.length; i++) {
      var a = daily.answersById[s.questions[i].id];
      if (!a || !a.isSubmitted) { allSubmitted = false; break; }
    }
    if (allSubmitted) {
      daily.completedAtISO = new Date().toISOString();
    }

    save('fnp:daily', daily);

    // Update history
    if (!state.history[qid]) {
      state.history[qid] = {
        timesSeen: 0,
        timesCorrect: 0,
        timesWrong: 0,
        lastSeenISO: null,
        flagged: false,
        mastered: false,
        memorized: false,
        forceRepracticeUntilISO: null
      };
    }
    var h = state.history[qid];
    h.timesSeen++;
    if (isCorrect) h.timesCorrect++;
    else h.timesWrong++;
    h.lastSeenISO = getTodayISODate();
    saveHistory();

    // Update session correctCount
    if (isCorrect) s.correctCount++;

    updateDailyPill();

    // Show feedback
    $$('.choice-btn').forEach(function (btn, i) {
      btn.disabled = true;
      if (i === q.answer) {
        btn.classList.add('correct');
        btn.insertAdjacentHTML('beforeend', '<span class="choice-icon">\u2713</span>');
      }
      if (i === chosen && !isCorrect) {
        btn.classList.add('incorrect');
        btn.insertAdjacentHTML('beforeend', '<span class="choice-icon">\u2717</span>');
      }
    });

    $('#submit-btn').classList.add('hidden');
    $('#feedback-area').classList.remove('hidden');
    $('#rationale-box').textContent = q.rationale || 'No rationale available.';

    // Initialize learning controls
    initLearningControls(qid);

    // Update pips
    renderPips();

    // If all complete, auto-end after a brief pause
    if (allSubmitted) {
      setTimeout(function () { endSession(); }, 800);
    }
  }

  function toggleRationale() {
    var box = $('#rationale-box');
    var toggle = $('#rationale-toggle');
    if (box.classList.contains('hidden')) {
      box.classList.remove('hidden');
      toggle.textContent = 'Hide Rationale ▲';
    } else {
      box.classList.add('hidden');
      toggle.textContent = 'Show Rationale ▼';
    }
  }

  function nextQuestion() {
    if (!state.session) return;
    navigateTo(state.session.currentIndex + 1);
  }

  function toggleFlagCurrent() {
    var s = state.session;
    if (!s) return;
    var q = s.questions[s.currentIndex];
    if (!state.history[q.id]) {
      state.history[q.id] = {
        timesSeen: 0, timesCorrect: 0, timesWrong: 0,
        lastSeenISO: null, flagged: false, mastered: false,
        memorized: false, forceRepracticeUntilISO: null
      };
    }
    state.history[q.id].flagged = !state.history[q.id].flagged;
    saveHistory();
    $('#flag-btn').textContent = state.history[q.id].flagged ? 'Unflag' : 'Flag';
    showToast(state.history[q.id].flagged ? 'Question flagged for review' : 'Flag removed');
  }

  function endSession() {
    var s = state.session;
    if (!s) return;
    var daily = state.daily;

    // Count from daily.answersById
    var total = s.questions.length;
    var correct = 0;
    s.questions.forEach(function (q) {
      var a = daily.answersById[q.id];
      if (a && a.isSubmitted && a.isCorrect) correct++;
    });

    var pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Mark complete
    if (!daily.completedAtISO) {
      daily.completedAtISO = new Date().toISOString();
      save('fnp:daily', daily);
    }

    // Summary UI
    $('#practice-session').classList.add('hidden');
    $('#practice-summary').classList.remove('hidden');

    var scoreEl = $('#summary-score');
    scoreEl.textContent = pct + '%';
    scoreEl.style.color = pct >= 80 ? 'var(--correct)' : pct >= 60 ? 'var(--warning)' : 'var(--incorrect)';
    $('#summary-quote').textContent = randomQuote();

    var statsHtml =
      '<div class="summary-stat"><div class="stat-value">' + total + '</div><div class="stat-label">Questions</div></div>' +
      '<div class="summary-stat"><div class="stat-value correct-color">' + correct + '</div><div class="stat-label">Correct</div></div>' +
      '<div class="summary-stat"><div class="stat-value incorrect-color">' + (total - correct) + '</div><div class="stat-label">Incorrect</div></div>' +
      '<div class="summary-stat"><div class="stat-value">' + pct + '%</div><div class="stat-label">Accuracy</div></div>';
    $('#summary-stats').innerHTML = statsHtml;

    // Show review missed button if any wrong
    var missedBtn = $('#review-missed-btn');
    if (total - correct > 0) {
      missedBtn.classList.remove('hidden');
    } else {
      missedBtn.classList.add('hidden');
    }
  }

  function reviewMissed() {
    var s = state.session;
    if (!s) return;
    var daily = state.daily;

    var missed = [];
    s.questions.forEach(function (q) {
      var a = daily.answersById[q.id];
      if (a && a.isSubmitted && !a.isCorrect) {
        missed.push(q);
      }
    });

    if (missed.length === 0) {
      showToast('No missed questions to review!');
      return;
    }

    // Set up a new daily session for review
    daily.sessionQuestionIds = missed.map(function (q) { return q.id; });
    daily.answersById = {};
    daily.markedById = {};
    daily.currentIndex = 0;
    daily.completedAtISO = null;
    save('fnp:daily', daily);

    state.session = {
      questions: missed,
      currentIndex: 0,
      correctCount: 0,
      mode: 'review'
    };

    state.selectedChoice = null;

    $('#practice-start').classList.add('hidden');
    $('#practice-summary').classList.add('hidden');
    $('#practice-session').classList.remove('hidden');

    navigateTo(0);
  }

  function backToStart() {
    state.session = null;
    $('#practice-session').classList.add('hidden');
    $('#practice-summary').classList.add('hidden');
    $('#practice-start').classList.remove('hidden');
    $('#resume-session-btn').classList.add('hidden');
  }

  function showResumeIfNeeded() {
    // Resume is now automatic in init() — hide the old button
    var resumeBtn = $('#resume-session-btn');
    if (resumeBtn) resumeBtn.classList.add('hidden');
  }

  // ========== STATS ==========
  function renderStats() {
    var history = state.history;
    var bank = state.questionBank || [];

    // Empty state
    if (Object.keys(history).length === 0) {
      $('#stats-overview').innerHTML =
        '<div class="stat-card full-width" style="padding:32px 16px;"><div class="empty-state-icon">📊</div>' +
        '<div style="font-size:1.1rem;font-weight:600;margin-bottom:4px;">No stats yet</div>' +
        '<div style="color:var(--text-muted);font-size:0.9rem;">Complete your first practice session to see your progress here.</div></div>';
      $('#streak-card').innerHTML = '';
      $('#topic-stats-body').innerHTML = '';
      return;
    }

    // Overall stats
    var totalSeen = 0;
    var totalCorrect = 0;
    var totalWrong = 0;
    var flagged = 0;
    var mastered = 0;

    Object.keys(history).forEach(function (id) {
      var h = history[id];
      totalSeen += h.timesSeen;
      totalCorrect += h.timesCorrect;
      totalWrong += h.timesWrong;
      if (h.flagged) flagged++;
      if (h.mastered) mastered++;
    });

    var accuracy = totalSeen > 0 ? Math.round((totalCorrect / totalSeen) * 100) : 0;
    var uniqueSeen = Object.keys(history).filter(function (id) {
      return history[id].timesSeen > 0;
    }).length;

    var overviewHtml =
      '<div class="stat-card"><div class="stat-number">' + accuracy + '%</div><div class="stat-desc">Overall Accuracy</div></div>' +
      '<div class="stat-card"><div class="stat-number">' + uniqueSeen + '/' + bank.length + '</div><div class="stat-desc">Questions Seen</div></div>' +
      '<div class="stat-card"><div class="stat-number">' + flagged + '</div><div class="stat-desc">Flagged</div></div>' +
      '<div class="stat-card"><div class="stat-number">' + mastered + '</div><div class="stat-desc">Mastered</div></div>';
    $('#stats-overview').innerHTML = overviewHtml;

    // Streak
    var usage = state.usage;
    $('#streak-card').innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span class="streak-fire">🔥</span>' +
        '<div><div style="font-size:1.3rem;font-weight:700;">' + usage.streakCount + '-day streak</div>' +
        '<div style="font-size:0.8rem;color:var(--text-muted);">' + usage.totalDaysUsed + ' total days studied</div></div>' +
      '</div>';

    // Per-topic
    var topicStats = computeTopicStats();
    var tbody = $('#topic-stats-body');
    tbody.innerHTML = '';

    if (topicStats.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px;">No data yet. Start practicing!</td></tr>';
      return;
    }

    topicStats.forEach(function (ts) {
      var barClass = ts.accuracy >= 70 ? 'good' : ts.accuracy >= 50 ? 'okay' : 'weak';
      var row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(ts.topic) + '</td>' +
        '<td>' + ts.accuracy + '%</td>' +
        '<td><div class="topic-bar-container"><div class="topic-bar ' + barClass + '" style="width:' + ts.accuracy + '%"></div></div></td>';
      tbody.appendChild(row);
    });
  }

  function computeTopicStats() {
    var history = state.history;
    var bank = state.questionBank || [];
    var topicMap = {};

    bank.forEach(function (q) {
      if (!topicMap[q.topic]) {
        topicMap[q.topic] = { seen: 0, correct: 0, total: 0 };
      }
      topicMap[q.topic].total++;
      var h = history[q.id];
      if (h) {
        topicMap[q.topic].seen += h.timesSeen;
        topicMap[q.topic].correct += h.timesCorrect;
      }
    });

    var result = Object.keys(topicMap).map(function (topic) {
      var d = topicMap[topic];
      return {
        topic: topic,
        accuracy: d.seen > 0 ? Math.round((d.correct / d.seen) * 100) : 0,
        seen: d.seen,
        total: d.total
      };
    });

    // Sort weakest first
    result.sort(function (a, b) { return a.accuracy - b.accuracy; });
    return result;
  }

  // ========== QUESTION BANK ==========
  var bankFilterState = { search: '', topic: '', difficulty: '', flagged: false, mastered: false };

  function renderBank() {
    renderBankFilters();
    renderBankList();
  }

  function renderBankFilters() {
    var filtersEl = $('#bank-filters');
    var topics = getTopics();
    var html = '<button class="filter-pill' + (bankFilterState.topic === '' ? ' active' : '') + '" data-filter-topic="">All</button>';
    topics.forEach(function (t) {
      html += '<button class="filter-pill' + (bankFilterState.topic === t ? ' active' : '') + '" data-filter-topic="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
    });
    html += '<button class="filter-pill' + (bankFilterState.flagged ? ' active' : '') + '" data-filter-flagged>Flagged</button>';
    html += '<button class="filter-pill' + (bankFilterState.mastered ? ' active' : '') + '" data-filter-mastered>Mastered</button>';
    filtersEl.innerHTML = html;

    // Bind filter clicks
    filtersEl.querySelectorAll('[data-filter-topic]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        bankFilterState.topic = btn.getAttribute('data-filter-topic');
        renderBank();
      });
    });

    filtersEl.querySelector('[data-filter-flagged]').addEventListener('click', function () {
      bankFilterState.flagged = !bankFilterState.flagged;
      renderBank();
    });

    filtersEl.querySelector('[data-filter-mastered]').addEventListener('click', function () {
      bankFilterState.mastered = !bankFilterState.mastered;
      renderBank();
    });
  }

  function renderBankList() {
    var list = $('#bank-list');
    var bank = state.questionBank || [];
    var history = state.history;
    var search = bankFilterState.search.toLowerCase();

    var filtered = bank.filter(function (q) {
      if (search && q.stem.toLowerCase().indexOf(search) === -1 &&
          (q.topic || '').toLowerCase().indexOf(search) === -1 &&
          q.id.toLowerCase().indexOf(search) === -1) {
        return false;
      }
      if (bankFilterState.topic && q.topic !== bankFilterState.topic) return false;
      if (bankFilterState.flagged) {
        var h = history[q.id];
        if (!h || !h.flagged) return false;
      }
      if (bankFilterState.mastered) {
        var h2 = history[q.id];
        if (!h2 || !h2.mastered) return false;
      }
      return true;
    });

    $('#bank-count').textContent = filtered.length + ' of ' + bank.length + ' questions';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>No questions match your filters</p></div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach(function (q) {
      var h = history[q.id];
      var item = document.createElement('div');
      item.className = 'bank-item';

      var badgesHtml = '<span class="badge badge-topic">' + escapeHtml(q.topic || '') + '</span>';
      if (q.difficulty) {
        badgesHtml += '<span class="badge badge-difficulty">' + q.difficulty + '</span>';
      }
      if (h && h.flagged) badgesHtml += '<span class="badge badge-flagged">flagged</span>';
      if (h && h.mastered) badgesHtml += '<span class="badge badge-mastered">mastered</span>';

      var accuracy = '';
      if (h && h.timesSeen > 0) {
        accuracy = Math.round((h.timesCorrect / h.timesSeen) * 100) + '% (' + h.timesSeen + ' attempts)';
      }

      item.innerHTML =
        '<div class="bank-item-header">' +
          '<span class="bank-item-id">' + escapeHtml(q.id) + (accuracy ? ' · ' + accuracy : '') + '</span>' +
          '<div class="bank-item-badges">' + badgesHtml + '</div>' +
        '</div>' +
        '<div class="bank-item-stem">' + escapeHtml(q.stem) + '</div>' +
        '<div class="bank-item-actions">' +
          '<button class="btn btn-sm btn-secondary bank-flag-btn" data-id="' + q.id + '">' + (h && h.flagged ? 'Unflag' : 'Flag') + '</button>' +
          '<button class="btn btn-sm btn-secondary bank-master-btn" data-id="' + q.id + '">' + (h && h.mastered ? 'Unmaster' : 'Master') + '</button>' +
          '<button class="btn btn-sm btn-secondary bank-edit-btn" data-id="' + q.id + '">Edit</button>' +
          '<button class="btn btn-sm btn-danger bank-delete-btn" data-id="' + q.id + '">Del</button>' +
        '</div>';

      list.appendChild(item);
    });

    // Bind bank item actions
    list.querySelectorAll('.bank-flag-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleFlag(btn.getAttribute('data-id'));
      });
    });

    list.querySelectorAll('.bank-master-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMaster(btn.getAttribute('data-id'));
      });
    });

    list.querySelectorAll('.bank-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        editQuestion(btn.getAttribute('data-id'));
      });
    });

    list.querySelectorAll('.bank-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteQuestion(btn.getAttribute('data-id'));
      });
    });
  }

  function toggleFlag(id) {
    if (!state.history[id]) {
      state.history[id] = { timesSeen: 0, timesCorrect: 0, timesWrong: 0, lastSeenISO: null, flagged: false, mastered: false };
    }
    state.history[id].flagged = !state.history[id].flagged;
    saveHistory();
    renderBankList();
  }

  function toggleMaster(id) {
    if (!state.history[id]) {
      state.history[id] = { timesSeen: 0, timesCorrect: 0, timesWrong: 0, lastSeenISO: null, flagged: false, mastered: false };
    }
    state.history[id].mastered = !state.history[id].mastered;
    saveHistory();
    renderBankList();
  }

  function editQuestion(id) {
    var q = (state.questionBank || []).find(function (q) { return q.id === id; });
    if (!q) return;

    var topics = getTopics();
    var topicOptions = topics.map(function (t) {
      return '<option value="' + escapeHtml(t) + '"' + (t === q.topic ? ' selected' : '') + '>' + escapeHtml(t) + '</option>';
    }).join('');

    showModal(
      'Edit Question',
      '<label>Stem</label>' +
      '<textarea class="edit-field" id="edit-stem" rows="4">' + escapeHtml(q.stem) + '</textarea>' +
      '<label>Choice A</label>' +
      '<input type="text" id="edit-c0" value="' + escapeAttr(q.choices[0] || '') + '">' +
      '<label>Choice B</label>' +
      '<input type="text" id="edit-c1" value="' + escapeAttr(q.choices[1] || '') + '">' +
      '<label>Choice C</label>' +
      '<input type="text" id="edit-c2" value="' + escapeAttr(q.choices[2] || '') + '">' +
      '<label>Choice D</label>' +
      '<input type="text" id="edit-c3" value="' + escapeAttr(q.choices[3] || '') + '">' +
      '<label>Correct Answer</label>' +
      '<select id="edit-answer">' +
        '<option value="0"' + (q.answer === 0 ? ' selected' : '') + '>A</option>' +
        '<option value="1"' + (q.answer === 1 ? ' selected' : '') + '>B</option>' +
        '<option value="2"' + (q.answer === 2 ? ' selected' : '') + '>C</option>' +
        '<option value="3"' + (q.answer === 3 ? ' selected' : '') + '>D</option>' +
      '</select>' +
      '<label>Rationale</label>' +
      '<textarea class="edit-field" id="edit-rationale" rows="3">' + escapeHtml(q.rationale || '') + '</textarea>' +
      '<label>Topic</label>' +
      '<select id="edit-topic">' + topicOptions + '<option value="__new">+ New Topic</option></select>' +
      '<input type="text" id="edit-topic-new" placeholder="New topic name" class="hidden">' +
      '<label>Difficulty</label>' +
      '<select id="edit-difficulty">' +
        '<option value="easy"' + (q.difficulty === 'easy' ? ' selected' : '') + '>Easy</option>' +
        '<option value="medium"' + (q.difficulty === 'medium' ? ' selected' : '') + '>Medium</option>' +
        '<option value="hard"' + (q.difficulty === 'hard' ? ' selected' : '') + '>Hard</option>' +
      '</select>',
      [
        { label: 'Cancel', class: 'btn-secondary', action: hideModal },
        {
          label: 'Save', class: 'btn-primary', action: function () {
            var topicSelect = $('#edit-topic');
            var topic = topicSelect.value;
            if (topic === '__new') {
              topic = $('#edit-topic-new').value.trim();
              if (!topic) { showToast('Please enter a topic name.'); return; }
            }

            q.stem = $('#edit-stem').value.trim();
            q.choices = [
              $('#edit-c0').value.trim(),
              $('#edit-c1').value.trim(),
              $('#edit-c2').value.trim(),
              $('#edit-c3').value.trim()
            ];
            q.answer = parseInt($('#edit-answer').value, 10);
            q.rationale = $('#edit-rationale').value.trim();
            q.topic = topic;
            q.difficulty = $('#edit-difficulty').value;

            save('fnp:questionBank', state.questionBank);
            hideModal();
            renderBank();
            showToast('Question updated!');
          }
        }
      ]
    );

    // Handle new topic toggle
    setTimeout(function () {
      var topicSelect = $('#edit-topic');
      if (topicSelect) {
        topicSelect.addEventListener('change', function () {
          var newInput = $('#edit-topic-new');
          if (topicSelect.value === '__new') {
            newInput.classList.remove('hidden');
          } else {
            newInput.classList.add('hidden');
          }
        });
      }
    }, 50);
  }

  function deleteQuestion(id) {
    showModal(
      'Delete Question',
      '<p>Are you sure you want to delete question <strong>' + escapeHtml(id) + '</strong>? This cannot be undone.</p>',
      [
        { label: 'Cancel', class: 'btn-secondary', action: hideModal },
        {
          label: 'Delete', class: 'btn-danger', action: function () {
            state.questionBank = (state.questionBank || []).filter(function (q) { return q.id !== id; });
            save('fnp:questionBank', state.questionBank);
            delete state.history[id];
            saveHistory();
            hideModal();
            renderBank();
            showToast('Question deleted.');
          }
        }
      ]
    );
  }

  // ========== IMPORT / EXPORT ==========
  function showImportModal() {
    showModal(
      'Import Questions',
      '<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px;">Paste a JSON array of questions. Matching IDs will be updated; new IDs will be added.</p>' +
      '<textarea id="import-textarea" placeholder=\'[{"id":"q001","stem":"...","choices":["A.","B.","C.","D."],"answer":0,"rationale":"...","topic":"...","difficulty":"medium","tags":[]}]\'></textarea>' +
      '<div id="import-preview" class="import-preview hidden"></div>',
      [
        { label: 'Cancel', class: 'btn-secondary', action: hideModal },
        {
          label: 'Validate', class: 'btn-primary', action: function () {
            var raw = $('#import-textarea').value.trim();
            var result = validateImport(raw);
            var preview = $('#import-preview');
            if (result.error) {
              preview.classList.remove('hidden');
              preview.style.color = 'var(--incorrect)';
              preview.textContent = 'Error: ' + result.error;
            } else {
              preview.classList.remove('hidden');
              preview.style.color = 'var(--correct)';
              preview.textContent = result.newCount + ' new, ' + result.updateCount + ' updates. Ready to import.';

              // Replace Validate button with Import
              var actions = document.querySelector('#modal-content .modal-actions');
              if (actions) {
                actions.innerHTML = '';
                var cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn btn-secondary';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.addEventListener('click', hideModal);
                actions.appendChild(cancelBtn);

                var importBtn = document.createElement('button');
                importBtn.className = 'btn btn-primary';
                importBtn.textContent = 'Import ' + result.questions.length + ' Questions';
                importBtn.addEventListener('click', function () {
                  mergeQuestions(result.questions);
                  hideModal();
                  showToast('Imported ' + result.questions.length + ' questions!');
                  renderBank();
                });
                actions.appendChild(importBtn);
              }
            }
          }
        }
      ]
    );
  }

  function validateImport(raw) {
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return { error: 'JSON must be an array.' };
      if (arr.length === 0) return { error: 'Array is empty.' };

      var existingIds = {};
      (state.questionBank || []).forEach(function (q) { existingIds[q.id] = true; });

      var newCount = 0;
      var updateCount = 0;

      for (var i = 0; i < arr.length; i++) {
        var q = arr[i];
        if (!q.id || !q.stem || !q.choices || q.answer === undefined) {
          return { error: 'Question at index ' + i + ' is missing required fields (id, stem, choices, answer).' };
        }
        if (!Array.isArray(q.choices) || q.choices.length < 2) {
          return { error: 'Question ' + q.id + ' must have at least 2 choices.' };
        }
        if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.choices.length) {
          return { error: 'Question ' + q.id + ' has invalid answer index.' };
        }
        if (existingIds[q.id]) updateCount++;
        else newCount++;
      }

      return { questions: arr, newCount: newCount, updateCount: updateCount };
    } catch (e) {
      return { error: 'Invalid JSON: ' + e.message };
    }
  }

  function mergeQuestions(incoming) {
    var bank = state.questionBank || [];
    var idMap = {};
    bank.forEach(function (q, i) { idMap[q.id] = i; });

    incoming.forEach(function (q) {
      if (idMap[q.id] !== undefined) {
        // Update existing
        bank[idMap[q.id]] = q;
      } else {
        // Add new
        bank.push(q);
      }
    });

    state.questionBank = bank;
    save('fnp:questionBank', state.questionBank);
  }

  function exportAll() {
    var data = JSON.stringify(state.questionBank || [], null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'fnp-questions-' + getTodayISODate() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Questions exported!');
  }

  // ========== SETTINGS ==========
  function renderSettings() {
    $('#goal-value').textContent = state.settings.questionsPerDay;
    $('#theme-switch').checked = state.settings.theme === 'dark';
    $('#exclude-mastered-switch').checked = state.settings.excludeMastered;
    $('#exclude-memorized-switch').checked = state.settings.excludeMemorized || false;
    renderDebugPanel();
  }

  function renderDebugPanel() {
    var panel = $('#debug-panel');
    if (!panel || panel.classList.contains('hidden')) return;

    var bank = state.questionBank || [];
    var histKeys = Object.keys(state.history);
    var attempted = histKeys.filter(function (k) { return state.history[k].timesSeen > 0; }).length;
    var mastered = histKeys.filter(function (k) { return state.history[k].mastered; }).length;
    var memorized = histKeys.filter(function (k) { return state.history[k].memorized; }).length;
    var flagged = histKeys.filter(function (k) { return state.history[k].flagged; }).length;

    var daily = state.daily || {};
    var answeredToday = daily.answersById ? Object.keys(daily.answersById).length : 0;

    // Compute localStorage sizes
    var lsRows = '';
    var totalBytes = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      var val = localStorage.getItem(key) || '';
      var bytes = new Blob([val]).size;
      totalBytes += bytes;
      lsRows += '<div class="debug-row"><span class="debug-key">' + key + '</span><span class="debug-value">' + formatBytes(bytes) + '</span></div>';
    }

    var html = '';
    // App section
    html += '<div class="debug-section-title">App</div>';
    html += debugRow('Version', APP_VERSION);
    html += debugRow('Environment', APP_ENV);
    html += debugRow('API Base', APP_CONFIG.apiBaseUrl);
    // Data section
    html += '<div class="debug-section-title">Data</div>';
    html += debugRow('Bank Size', bank.length);
    html += debugRow('Attempted', attempted);
    html += debugRow('Mastered', mastered);
    html += debugRow('Memorized', memorized);
    html += debugRow('Flagged', flagged);
    // Daily section
    html += '<div class="debug-section-title">Daily</div>';
    html += debugRow('Day ISO', daily.isoDate || '—');
    html += debugRow('Session Qs', (daily.sessionQuestionIds || []).length);
    html += debugRow('Answered Today', answeredToday);
    html += debugRow('Goal', state.settings.questionsPerDay);
    // Usage section
    html += '<div class="debug-section-title">Usage</div>';
    html += debugRow('Streak', state.usage.streakCount);
    html += debugRow('Total Days', state.usage.totalDaysUsed);
    html += debugRow('Last Open', state.usage.lastOpenISODate || '—');
    // LocalStorage section
    html += '<div class="debug-section-title">LocalStorage</div>';
    html += lsRows;
    html += debugRow('Total', formatBytes(totalBytes));
    // Server section
    html += '<div class="debug-section-title">Server</div>';
    html += debugRow('Supabase URL', APP_CONFIG.supabaseUrl);
    html += debugRow('Auth', 'Not connected');
    html += debugRow('Tier', '—');
    html += debugRow('Quota', '—');

    panel.innerHTML = html;
  }

  function debugRow(key, value) {
    return '<div class="debug-row"><span class="debug-key">' + key + '</span><span class="debug-value">' + value + '</span></div>';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function toggleDebugPanel() {
    var panel = $('#debug-panel');
    var btn = $('#debug-toggle-btn');
    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
      btn.textContent = 'Hide';
      renderDebugPanel();
    } else {
      panel.classList.add('hidden');
      btn.textContent = 'Show';
    }
  }

  function changeGoal(delta) {
    var val = state.settings.questionsPerDay + delta;
    if (val < 1) val = 1;
    if (val > 50) val = 50;
    state.settings.questionsPerDay = val;
    save('fnp:settings', state.settings);
    $('#goal-value').textContent = val;
    updateDailyPill();
  }

  // ========== RESETS ==========
  function resetToday() {
    showModal(
      'Reset Today\'s Progress',
      '<p>This will clear today\'s session progress. Your overall stats will not be affected.</p>',
      [
        { label: 'Cancel', class: 'btn-secondary', action: hideModal },
        {
          label: 'Reset', class: 'btn-danger', action: function () {
            state.daily = createFreshDaily();
            save('fnp:daily', state.daily);
            state.session = null;
            backToStart();
            updateDailyPill();
            hideModal();
            showToast('Today\'s progress has been reset.');
          }
        }
      ]
    );
  }

  function resetStats() {
    showModal(
      'Reset All Statistics',
      '<p>This will clear all question history, streaks, and statistics. Your question bank will be kept.</p>',
      [
        { label: 'Cancel', class: 'btn-secondary', action: hideModal },
        {
          label: 'Reset Stats', class: 'btn-danger', action: function () {
            state.history = {};
            saveHistory();
            state.usage = { lastOpenISODate: getTodayISODate(), streakCount: 1, totalDaysUsed: 1, firstOpenTimestamps: [] };
            save('fnp:usage', state.usage);
            state.daily = createFreshDaily();
            save('fnp:daily', state.daily);
            state.session = null;
            backToStart();
            updateDailyPill();
            hideModal();
            showToast('All statistics have been reset.');
          }
        }
      ]
    );
  }

  function resetEverything() {
    showModal(
      'Reset Everything',
      '<p style="color:var(--incorrect);font-weight:600;">This will delete ALL data including your question bank, stats, and settings. This cannot be undone.</p>',
      [
        { label: 'Cancel', class: 'btn-secondary', action: hideModal },
        {
          label: 'Delete Everything', class: 'btn-danger', action: function () {
            localStorage.removeItem('fnp:settings');
            localStorage.removeItem('fnp:questionBank');
            localStorage.removeItem('fnp:history');
            localStorage.removeItem('fnp:daily');
            localStorage.removeItem('fnp:usage');
            hideModal();
            showToast('All data has been reset. Reloading...');
            setTimeout(function () { location.reload(); }, 1500);
          }
        }
      ]
    );
  }

  // ========== MODAL ==========
  var _modalEscHandler = null;
  var _modalTabHandler = null;

  function showModal(title, bodyHtml, buttons) {
    var overlay = $('#modal-overlay');
    var content = $('#modal-content');

    var actionsHtml = buttons.map(function (b) {
      return '<button class="btn ' + b.class + '">' + escapeHtml(b.label) + '</button>';
    }).join('');

    content.innerHTML =
      '<div class="modal-title">' + escapeHtml(title) + '</div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      '<div class="modal-actions">' + actionsHtml + '</div>';

    // Bind button actions
    var actionBtns = content.querySelectorAll('.modal-actions .btn');
    actionBtns.forEach(function (btn, i) {
      btn.addEventListener('click', buttons[i].action);
    });

    overlay.classList.remove('hidden');

    // Auto-focus first focusable element
    var firstFocusable = content.querySelector('button, input, textarea, select, [tabindex]');
    if (firstFocusable) firstFocusable.focus();

    // Escape key to close
    _modalEscHandler = function (e) {
      if (e.key === 'Escape') {
        hideModal();
      }
    };
    document.addEventListener('keydown', _modalEscHandler);

    // Focus trap
    _modalTabHandler = function (e) {
      if (e.key !== 'Tab') return;
      var focusable = content.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', _modalTabHandler);

    // Close on backdrop click
    overlay.addEventListener('click', function handler(e) {
      if (e.target === overlay) {
        hideModal();
        overlay.removeEventListener('click', handler);
      }
    });
  }

  function hideModal() {
    $('#modal-overlay').classList.add('hidden');
    if (_modalEscHandler) {
      document.removeEventListener('keydown', _modalEscHandler);
      _modalEscHandler = null;
    }
    if (_modalTabHandler) {
      document.removeEventListener('keydown', _modalTabHandler);
      _modalTabHandler = null;
    }
  }

  // ========== UTILITIES ==========
  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ========== EVENT BINDINGS ==========
  function bindEvents() {
    // Theme toggle
    $('#theme-toggle').addEventListener('click', toggleTheme);
    $('#theme-switch').addEventListener('change', toggleTheme);

    // Tabs
    $$('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.getAttribute('data-view'));
      });
    });

    // Mode selector
    $$('#mode-selector .mode-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        $$('#mode-selector .mode-option').forEach(function (o) { o.classList.remove('selected'); });
        opt.classList.add('selected');
        var radio = opt.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        // Show/hide topic filter
        if (radio && radio.value === 'topic') {
          $('#topic-filter-select').classList.remove('hidden');
        } else {
          $('#topic-filter-select').classList.add('hidden');
        }
      });
    });

    // Start session
    $('#start-session-btn').addEventListener('click', startSession);

    // Submit answer
    $('#submit-btn').addEventListener('click', submitAnswer);

    // Rationale toggle
    $('#rationale-toggle').addEventListener('click', toggleRationale);

    // Next question
    $('#next-btn').addEventListener('click', nextQuestion);

    // Flag current question
    $('#flag-btn').addEventListener('click', toggleFlagCurrent);

    // New session
    $('#new-session-btn').addEventListener('click', backToStart);

    // Review missed
    $('#review-missed-btn').addEventListener('click', reviewMissed);

    // Session navigation
    $('#prev-btn').addEventListener('click', function () {
      if (state.session) navigateTo(state.session.currentIndex - 1);
    });
    $('#next-nav-btn').addEventListener('click', function () {
      if (state.session) navigateTo(state.session.currentIndex + 1);
    });

    // Learning controls
    $('#memorized-toggle').addEventListener('change', function () {
      var s = state.session;
      if (!s) return;
      var qid = s.questions[s.currentIndex].id;
      if (!state.history[qid]) {
        state.history[qid] = {
          timesSeen: 0, timesCorrect: 0, timesWrong: 0,
          lastSeenISO: null, flagged: false, mastered: false,
          memorized: false, forceRepracticeUntilISO: null
        };
      }
      state.history[qid].memorized = this.checked;
      if (this.checked) {
        state.history[qid].forceRepracticeUntilISO = null;
      }
      saveHistory();
      renderPips();
      initLearningControls(qid);
      showToast(this.checked ? 'Marked as memorized' : 'Removed memorized mark');
    });

    $('#back-into-mix-btn').addEventListener('click', function () {
      var s = state.session;
      if (!s) return;
      var qid = s.questions[s.currentIndex].id;
      if (!state.history[qid]) {
        state.history[qid] = {
          timesSeen: 0, timesCorrect: 0, timesWrong: 0,
          lastSeenISO: null, flagged: false, mastered: false,
          memorized: false, forceRepracticeUntilISO: null
        };
      }
      var h = state.history[qid];
      var isRepractice = h.forceRepracticeUntilISO && new Date(h.forceRepracticeUntilISO) > new Date();
      if (isRepractice) {
        // Remove from mix
        h.forceRepracticeUntilISO = null;
        showToast('Removed from repractice mix');
      } else {
        // Back into mix: +24h
        h.memorized = false;
        h.forceRepracticeUntilISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        showToast('Added back into practice mix for 24h');
      }
      saveHistory();
      renderPips();
      initLearningControls(qid);
    });

    // Bank search (debounced)
    var _bankSearchTimer = null;
    $('#bank-search').addEventListener('input', function (e) {
      bankFilterState.search = e.target.value;
      clearTimeout(_bankSearchTimer);
      _bankSearchTimer = setTimeout(renderBankList, 150);
    });

    // Settings
    $('#goal-minus').addEventListener('click', function () { changeGoal(-1); });
    $('#goal-plus').addEventListener('click', function () { changeGoal(1); });
    $('#exclude-mastered-switch').addEventListener('change', function () {
      state.settings.excludeMastered = this.checked;
      save('fnp:settings', state.settings);
    });
    $('#exclude-memorized-switch').addEventListener('change', function () {
      state.settings.excludeMemorized = this.checked;
      save('fnp:settings', state.settings);
    });

    // Import / Export
    $('#import-btn').addEventListener('click', showImportModal);
    $('#export-btn').addEventListener('click', exportAll);

    // Resets
    $('#reset-today-btn').addEventListener('click', resetToday);
    $('#reset-stats-btn').addEventListener('click', resetStats);
    $('#reset-all-btn').addEventListener('click', resetEverything);

    // Debug panel
    $('#debug-toggle-btn').addEventListener('click', toggleDebugPanel);
  }

  // ========== START ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
