(function () {
  'use strict';

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
    }
  }

  // ========== STATE ==========
  var state = {
    settings: safeParse('fnp:settings', {
      theme: 'dark',
      questionsPerDay: 5,
      reviewMode: 'daily',
      topicFilter: null,
      excludeMastered: false
    }),
    questionBank: safeParse('fnp:questionBank', null),
    history: safeParse('fnp:history', {}),
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

  // ========== DOM REFERENCES ==========
  var $  = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return document.querySelectorAll(sel); };

  // ========== INIT ==========
  async function init() {
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
        showToast('Could not load questions. If using file:// protocol, please host on a local server (e.g., npx serve) or static hosting.');
        state.questionBank = [];
        save('fnp:questionBank', state.questionBank);
      }
    }

    // Apply theme
    applyTheme();

    // Initialize daily tracker
    initDaily();

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
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function initDaily() {
    var today = todayISO();
    if (!state.daily || state.daily.date !== today) {
      state.daily = {
        date: today,
        goal: state.settings.questionsPerDay,
        attempted: 0,
        correct: 0,
        questionIds: [],
        currentIndex: 0,
        answers: []
      };
      save('fnp:daily', state.daily);
    }
  }

  function updateDailyPill() {
    $('#daily-count').textContent = state.daily ? state.daily.attempted : 0;
    $('#daily-goal').textContent = state.settings.questionsPerDay;
  }

  // ========== STREAK + TOAST ==========
  function checkAndUpdateStreak() {
    var today = todayISO();
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

  function showToast(message) {
    var container = $('#toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast';
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
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    $$('.tab-btn').forEach(function (b) { b.classList.remove('active'); });

    var view = $('#view-' + viewId);
    if (view) view.classList.add('active');

    var tab = document.querySelector('.tab-btn[data-view="' + viewId + '"]');
    if (tab) tab.classList.add('active');

    // Render view-specific content
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

    var count = state.settings.questionsPerDay;
    var questions = selectQuestions(mode, topicFilter, count);

    if (questions.length === 0) {
      showToast('No questions available for this mode. Try a different mode or add more questions.');
      return;
    }

    state.session = {
      questions: questions,
      currentIndex: 0,
      answers: [],
      correctCount: 0,
      mode: mode
    };

    state.selectedChoice = null;

    $('#practice-start').classList.add('hidden');
    $('#practice-summary').classList.add('hidden');
    $('#practice-session').classList.remove('hidden');

    renderQuestion();
  }

  function selectQuestions(mode, topicFilter, count) {
    var pool = (state.questionBank || []).slice();
    var history = state.history;
    var dailyIds = state.daily ? state.daily.questionIds : [];

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

    // Remove today's already-seen questions
    pool = pool.filter(function (q) {
      return dailyIds.indexOf(q.id) === -1;
    });

    if (mode === 'flagged') {
      pool = pool.filter(function (q) {
        var h = history[q.id];
        return h && h.flagged;
      });
      // Also include flagged from today's pool
      var flaggedFromDaily = (state.questionBank || []).filter(function (q) {
        var h = history[q.id];
        return h && h.flagged && dailyIds.indexOf(q.id) !== -1;
      });
      // Add back flagged that were filtered by daily
      flaggedFromDaily.forEach(function (q) {
        if (!pool.find(function (p) { return p.id === q.id; })) {
          pool.push(q);
        }
      });
    }

    if (mode === 'weak') {
      // Prioritize questions with worst accuracy
      pool.sort(function (a, b) {
        var ha = history[a.id];
        var hb = history[b.id];
        var accA = ha && ha.timesSeen > 0 ? ha.timesCorrect / ha.timesSeen : 0.5;
        var accB = hb && hb.timesSeen > 0 ? hb.timesCorrect / hb.timesSeen : 0.5;
        return accA - accB;
      });
      return pool.slice(0, count);
    }

    // Smart selection for daily mode
    var incorrect = [];
    var unseen = [];
    var seenNotMastered = [];

    pool.forEach(function (q) {
      var h = history[q.id];
      if (!h) {
        unseen.push(q);
      } else if (h.timesWrong > 0 && !h.mastered) {
        incorrect.push(q);
      } else if (!h.mastered) {
        seenNotMastered.push(q);
      }
    });

    // Sort incorrect by error rate desc
    incorrect.sort(function (a, b) {
      var ha = history[a.id];
      var hb = history[b.id];
      return (hb.timesWrong / hb.timesSeen) - (ha.timesWrong / ha.timesSeen);
    });

    // Sort seenNotMastered by oldest seen first
    seenNotMastered.sort(function (a, b) {
      var ha = history[a.id];
      var hb = history[b.id];
      return (ha.lastSeenISO || '').localeCompare(hb.lastSeenISO || '');
    });

    // Shuffle within buckets for variety
    shuffleArray(incorrect);
    shuffleArray(unseen);
    shuffleArray(seenNotMastered);

    // But keep general priority: incorrect first, then unseen, then seen
    var selected = [];
    var buckets = [incorrect, unseen, seenNotMastered];

    for (var bi = 0; bi < buckets.length && selected.length < count; bi++) {
      var bucket = buckets[bi];
      for (var qi = 0; qi < bucket.length && selected.length < count; qi++) {
        selected.push(bucket[qi]);
      }
    }

    return selected;
  }

  function renderQuestion() {
    var s = state.session;
    if (!s || s.currentIndex >= s.questions.length) {
      endSession();
      return;
    }

    var q = s.questions[s.currentIndex];
    state.selectedChoice = null;

    // Progress
    $('#q-counter').textContent = 'Question ' + (s.currentIndex + 1) + ' of ' + s.questions.length;
    $('#q-score').textContent = s.correctCount + ' correct';
    var pct = ((s.currentIndex) / s.questions.length) * 100;
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
      btn.addEventListener('click', function () {
        handleChoiceClick(i);
      });
      choicesEl.appendChild(btn);
    });

    // Reset UI
    $('#submit-btn').disabled = true;
    $('#submit-btn').classList.remove('hidden');
    $('#feedback-area').classList.add('hidden');
    $('#rationale-box').classList.add('hidden');
    $('#rationale-toggle').textContent = 'Show Rationale ▼';

    // Update flag button
    var hist = state.history[q.id];
    $('#flag-btn').textContent = (hist && hist.flagged) ? 'Unflag' : 'Flag';
  }

  function handleChoiceClick(index) {
    if (state.session.answers[state.session.currentIndex] !== undefined) return; // Already answered

    state.selectedChoice = index;

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
    var chosen = state.selectedChoice;
    var isCorrect = chosen === q.answer;

    // Record answer
    s.answers[s.currentIndex] = chosen;
    if (isCorrect) s.correctCount++;

    // Update history
    if (!state.history[q.id]) {
      state.history[q.id] = {
        timesSeen: 0,
        timesCorrect: 0,
        timesWrong: 0,
        lastSeenISO: null,
        flagged: false,
        mastered: false
      };
    }
    var h = state.history[q.id];
    h.timesSeen++;
    if (isCorrect) h.timesCorrect++;
    else h.timesWrong++;
    h.lastSeenISO = todayISO();
    save('fnp:history', state.history);

    // Update daily
    state.daily.attempted++;
    if (isCorrect) state.daily.correct++;
    if (state.daily.questionIds.indexOf(q.id) === -1) {
      state.daily.questionIds.push(q.id);
    }
    save('fnp:daily', state.daily);
    updateDailyPill();

    // Show feedback
    $$('.choice-btn').forEach(function (btn, i) {
      btn.disabled = true;
      if (i === q.answer) btn.classList.add('correct');
      if (i === chosen && !isCorrect) btn.classList.add('incorrect');
    });

    $('#submit-btn').classList.add('hidden');
    $('#feedback-area').classList.remove('hidden');
    $('#rationale-box').textContent = q.rationale || 'No rationale available.';
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
    state.session.currentIndex++;
    renderQuestion();
  }

  function toggleFlagCurrent() {
    var s = state.session;
    if (!s) return;
    var q = s.questions[s.currentIndex];
    if (!state.history[q.id]) {
      state.history[q.id] = {
        timesSeen: 0, timesCorrect: 0, timesWrong: 0,
        lastSeenISO: null, flagged: false, mastered: false
      };
    }
    state.history[q.id].flagged = !state.history[q.id].flagged;
    save('fnp:history', state.history);
    $('#flag-btn').textContent = state.history[q.id].flagged ? 'Unflag' : 'Flag';
    showToast(state.history[q.id].flagged ? 'Question flagged for review' : 'Flag removed');
  }

  function endSession() {
    var s = state.session;
    if (!s) return;

    var total = s.questions.length;
    var correct = s.correctCount;
    var pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Summary UI
    $('#practice-session').classList.add('hidden');
    $('#practice-summary').classList.remove('hidden');

    $('#summary-score').textContent = pct + '%';
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
      missedBtn.style.display = 'block';
    } else {
      missedBtn.style.display = 'none';
    }
  }

  function reviewMissed() {
    var s = state.session;
    if (!s) return;

    var missed = [];
    s.questions.forEach(function (q, i) {
      if (s.answers[i] !== q.answer) {
        missed.push(q);
      }
    });

    if (missed.length === 0) {
      showToast('No missed questions to review!');
      return;
    }

    state.session = {
      questions: missed,
      currentIndex: 0,
      answers: [],
      correctCount: 0,
      mode: 'review'
    };

    state.selectedChoice = null;

    $('#practice-start').classList.add('hidden');
    $('#practice-summary').classList.add('hidden');
    $('#practice-session').classList.remove('hidden');

    renderQuestion();
  }

  function backToStart() {
    state.session = null;
    $('#practice-session').classList.add('hidden');
    $('#practice-summary').classList.add('hidden');
    $('#practice-start').classList.remove('hidden');
  }

  // ========== STATS ==========
  function renderStats() {
    var history = state.history;
    var bank = state.questionBank || [];

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
    save('fnp:history', state.history);
    renderBankList();
  }

  function toggleMaster(id) {
    if (!state.history[id]) {
      state.history[id] = { timesSeen: 0, timesCorrect: 0, timesWrong: 0, lastSeenISO: null, flagged: false, mastered: false };
    }
    state.history[id].mastered = !state.history[id].mastered;
    save('fnp:history', state.history);
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
            save('fnp:history', state.history);
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
    a.download = 'fnp-questions-' + todayISO() + '.json';
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
            state.daily = {
              date: todayISO(),
              goal: state.settings.questionsPerDay,
              attempted: 0,
              correct: 0,
              questionIds: [],
              currentIndex: 0,
              answers: []
            };
            save('fnp:daily', state.daily);
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
            save('fnp:history', state.history);
            state.usage = { lastOpenISODate: todayISO(), streakCount: 1, totalDaysUsed: 1, firstOpenTimestamps: [] };
            save('fnp:usage', state.usage);
            state.daily = {
              date: todayISO(),
              goal: state.settings.questionsPerDay,
              attempted: 0,
              correct: 0,
              questionIds: [],
              currentIndex: 0,
              answers: []
            };
            save('fnp:daily', state.daily);
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

    // Bank search
    $('#bank-search').addEventListener('input', function (e) {
      bankFilterState.search = e.target.value;
      renderBankList();
    });

    // Settings
    $('#goal-minus').addEventListener('click', function () { changeGoal(-1); });
    $('#goal-plus').addEventListener('click', function () { changeGoal(1); });
    $('#exclude-mastered-switch').addEventListener('change', function () {
      state.settings.excludeMastered = this.checked;
      save('fnp:settings', state.settings);
    });

    // Import / Export
    $('#import-btn').addEventListener('click', showImportModal);
    $('#export-btn').addEventListener('click', exportAll);

    // Resets
    $('#reset-today-btn').addEventListener('click', resetToday);
    $('#reset-stats-btn').addEventListener('click', resetStats);
    $('#reset-all-btn').addEventListener('click', resetEverything);
  }

  // ========== START ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
