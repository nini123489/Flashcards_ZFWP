const fallbackQuestions = [
  {
    id: 1,
    question: 'Dummyfrage',
    answer: 'Wenn du diese siehst konnten die Fragen NICHT geladen werden',
    explanation: ':(',
    topic: 'Error',
    difficulty: 0
  }
];

new Vue({
  el: '#app',
  data: {
    questions: [],
    currentQuestionIndex: 0,
    showAnswer: false,
    stats: {
      total: 0,
      correct: 0,
      incorrect: 0,
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0
    },
    roundStats: {
      total: 0,
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0
    },
    roundAnswered: [],
    roundQuestionTarget: 0,
    roundAnsweredRatings: {},
    roundLocked: false,
    questionStats: [],
    activeOrder: [],
    showStats: false,
    showQuestionList: false,
    answerHistory: [],
    showUpdateModal: false,
    pendingFingerprint: null,
    pendingQuestions: null,
    updateMessage: '',
    showInfoModal: false,
    lastActivityDate: null,
    showRoundCompleteModal: false,
    confettiPieces: [],
    roundCompletionNotified: false
  },
  computed: {
    currentQuestion() {
      if (!this.questions.length || !this.activeOrder.length) return null;
      const index = this.activeOrder[this.currentQuestionIndex];
      return this.questions[index];
    },
    totalQuestions() {
      return this.questions.length;
    },
    progressInOrder() {
      const totalSlots = this.questions.length;
      if (!totalSlots) return [];
      const counts = { excellent: 0, good: 0, fair: 0, poor: 0 };
      const history = Array.isArray(this.answerHistory) ? this.answerHistory.slice(-totalSlots) : [];
      history.forEach(rating => {
        if (counts.hasOwnProperty(rating)) counts[rating]++;
      });
      const segments = [];
      segments.push(...Array(counts.excellent).fill('excellent'));
      segments.push(...Array(counts.good).fill('good'));
      segments.push(...Array(counts.fair).fill('fair'));
      segments.push(...Array(counts.poor).fill('poor'));
      const answeredCount = counts.excellent + counts.good + counts.fair + counts.poor;
      segments.push(...Array(Math.max(0, totalSlots - answeredCount)).fill('unanswered'));
      return segments;
    },
    accuracy() {
      return this.stats.total > 0 ? Math.round((this.stats.correct / this.stats.total) * 100) : 0;
    },
    currentQuestionPoolIndex() {
      if (!this.activeOrder.length || this.currentQuestionIndex < 0 || this.currentQuestionIndex >= this.activeOrder.length) {
        return null;
      }
      return this.activeOrder[this.currentQuestionIndex];
    },
    hasAnsweredCurrentQuestion() {
      const poolIndex = this.currentQuestionPoolIndex;
      if (poolIndex === null || poolIndex === undefined) return false;
      return this.roundAnswered.includes(poolIndex);
    },
    currentRoundAnswerRating() {
      const poolIndex = this.currentQuestionPoolIndex;
      if (poolIndex === null || poolIndex === undefined) return null;
      return this.roundAnsweredRatings[poolIndex] || null;
    }
  },
  methods: {
    async loadQuestions() {
      const cachedQuestions = this.getCachedQuestions();
      let questionsToUse = Array.isArray(cachedQuestions) && cachedQuestions.length ? cachedQuestions : null;
      const storedFingerprint = localStorage.getItem('questionsFingerprint');
      let latestQuestions = null;
      let shouldPersistCurrent = false;
      let fingerprintToPersist = null;

      try {
        const response = await fetch('data/questions.json');
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length) {
            latestQuestions = data;
          }
        }
      } catch (e) {
        console.warn('Die Fragen konnten nicht aus der Datei geladen werden. Fallback wird verwendet:', e);
      }

      if (latestQuestions && latestQuestions.length) {
        const latestFingerprint = this.generateQuestionsFingerprint(latestQuestions);
        if (!storedFingerprint) {
          questionsToUse = latestQuestions;
          shouldPersistCurrent = true;
          fingerprintToPersist = latestFingerprint;
        } else if (storedFingerprint !== latestFingerprint) {
          this.pendingQuestions = latestQuestions;
          this.pendingFingerprint = latestFingerprint;
          this.showUpdateModal = true;
          this.updateMessage = 'Auf dem Server liegen aktualisierte Quizfragen. Statistiken können dadurch veraltet sein.';
          if (!questionsToUse || !questionsToUse.length) {
            questionsToUse = latestQuestions;
            shouldPersistCurrent = true;
            fingerprintToPersist = latestFingerprint;
          }
        } else {
          questionsToUse = latestQuestions;
          shouldPersistCurrent = true;
          fingerprintToPersist = latestFingerprint;
        }
      }

      if (!questionsToUse) {
        questionsToUse = fallbackQuestions;
      }

      this.questions = questionsToUse;

      if (shouldPersistCurrent) {
        localStorage.setItem('cachedQuestions', JSON.stringify(this.questions));
        localStorage.setItem('questionsFingerprint', fingerprintToPersist);
        this.pendingQuestions = null;
        this.pendingFingerprint = null;
      } else if (!localStorage.getItem('cachedQuestions')) {
        localStorage.setItem('cachedQuestions', JSON.stringify(this.questions));
      }
      this.initializeStatsAndOrder();
      this.loadState();
      this.applyDailyDecay();
      if (!Array.isArray(this.activeOrder) || this.activeOrder.length === 0) {
        this.questionStats.forEach(stat => { stat.mastered = false; });
        this.activeOrder = this.questions.map((_, idx) => idx);
      }
      this.restartSequence();
    },
    initializeStatsAndOrder() {
      const statsStr = localStorage.getItem('questionStats');
      if (statsStr) {
        try {
          const parsedStats = JSON.parse(statsStr);
          if (Array.isArray(parsedStats) && parsedStats.length === this.questions.length) {
            this.questionStats = parsedStats;
          } else {
            this.questionStats = this.questions.map(() => this.createEmptyQuestionStat());
          }
        } catch (e) {
          this.questionStats = this.questions.map(() => this.createEmptyQuestionStat());
        }
      } else {
        this.questionStats = this.questions.map(() => this.createEmptyQuestionStat());
      }
      this.questionStats = this.questionStats.map(qs => {
        const merged = {
          excellent: qs.excellent || 0,
          good: qs.good || 0,
          fair: qs.fair || 0,
          poor: qs.poor || 0,
          total: qs.total || 0,
          mastered: qs.mastered || false,
          lastRating: qs.lastRating || 'unanswered',
          score: qs.score
        };
        merged.score = this.calculateQuestionScore(merged);
        return merged;
      });

      const activeStr = localStorage.getItem('activeOrder');
      if (activeStr) {
        try {
          const parsedActive = JSON.parse(activeStr);
          if (Array.isArray(parsedActive)) {
            this.activeOrder = parsedActive.filter(idx => idx >= 0 && idx < this.questions.length && !this.questionStats[idx].mastered);
          }
        } catch (e) {
          this.activeOrder = [];
        }
      }
      if (!Array.isArray(this.activeOrder) || this.activeOrder.length === 0) {
        this.activeOrder = this.questions
          .map((_, idx) => idx)
          .filter(idx => !this.questionStats[idx].mastered);
      }
      this.shuffleActiveOrder();
      if (this.currentQuestionIndex < 0 || this.currentQuestionIndex >= this.activeOrder.length) {
        this.currentQuestionIndex = 0;
      }
    },
    createEmptyQuestionStat() {
      return {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
        total: 0,
        mastered: false,
        lastRating: 'unanswered',
        score: 0
      };
    },
    calculateQuestionScore(stat) {
      if (!stat) return 0;
      const penaltyRelevantAnswers = stat.total - stat.good;
      const positiveScore = stat.excellent * 3;
      const negativeScore = stat.fair * 1 + stat.poor * 2;
      const penalty = Math.max(0, penaltyRelevantAnswers) * 0.5;
      return positiveScore - negativeScore - penalty;
    },
    shuffleActiveOrder() {
      for (let i = this.activeOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.activeOrder[i], this.activeOrder[j]] = [this.activeOrder[j], this.activeOrder[i]];
      }
    },
    resetRoundTracking() {
      this.roundQuestionTarget = this.activeOrder.length;
      this.roundAnswered = [];
      this.roundAnsweredRatings = {};
      this.roundStats = {
        total: 0,
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0
      };
      this.showRoundCompleteModal = false;
      this.roundCompletionNotified = false;
      this.confettiPieces = [];
      this.roundLocked = false;
    },
    recordRoundProgress(questionIndex, difficulty) {
      const isFirstAnswer = !this.roundAnswered.includes(questionIndex);
      if (isFirstAnswer) {
        this.roundAnswered.push(questionIndex);
      }
      this.$set(this.roundAnsweredRatings, questionIndex, difficulty);
      if (!this.roundCompletionNotified && isFirstAnswer) {
        this.roundStats.total++;
        if (this.roundStats.hasOwnProperty(difficulty)) {
          this.roundStats[difficulty]++;
        }
        if (this.roundQuestionTarget > 0 && this.roundAnswered.length >= this.roundQuestionTarget) {
          this.triggerRoundComplete();
        }
      }
    },
    triggerRoundComplete() {
      if (this.roundCompletionNotified) return;
      this.roundCompletionNotified = true;
      this.showRoundCompleteModal = true;
      this.generateConfetti();
      this.roundLocked = true;
    },
    generateConfetti() {
      const pieces = 24;
      const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa'];
      this.confettiPieces = Array.from({ length: pieces }, (_, idx) => ({
        id: idx,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2 + Math.random() * 1.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 6 + Math.random() * 6
      }));
    },
    toggleAnswer() {
      if (this.roundLocked) return;
      this.showAnswer = !this.showAnswer;
    },
    rateAnswer(difficulty) {
      if (this.roundLocked) return;
      if (!this.questions.length || !this.activeOrder.length) return;
      const questionIndex = this.activeOrder[this.currentQuestionIndex];
      const qs = this.questionStats[questionIndex];
      if (!qs) return;
      qs[difficulty]++;
      qs.total++;
      qs.lastRating = difficulty;
      qs.score = this.calculateQuestionScore(qs);
      this.stats.total++;
      if (['excellent', 'good'].includes(difficulty)) {
        this.stats.correct++;
      } else {
        this.stats.incorrect++;
      }
      this.stats[difficulty]++;
      this.evaluateMastery(questionIndex);
      this.answerHistory.push(difficulty);
      this.recordRoundProgress(questionIndex, difficulty);
      this.saveState();
      this.nextQuestion();
    },
    evaluateMastery(qIndex) {
      const stat = this.questionStats[qIndex];
      if (!stat) return;
      const positive = stat.good + stat.excellent;
      const masteryScoreThreshold = 6;
      if (!stat.mastered && stat.total >= 5 && stat.score >= masteryScoreThreshold && positive >= 3) {
        stat.mastered = true;
        const idxPos = this.activeOrder.indexOf(qIndex);
        if (idxPos !== -1) {
          this.activeOrder.splice(idxPos, 1);
          if (this.currentQuestionIndex >= this.activeOrder.length) {
            this.currentQuestionIndex = 0;
          }
        }
      }
    },
    nextQuestion() {
      if (this.roundLocked) {
        this.showAnswer = false;
        this.saveState();
        return;
      }
      if (!this.activeOrder.length) {
        this.showAnswer = false;
        return;
      }
      if (this.currentQuestionIndex < this.activeOrder.length - 1) {
        this.currentQuestionIndex++;
      } else {
        this.shuffleActiveOrder();
        this.currentQuestionIndex = 0;
      }
      this.showAnswer = false;
      this.saveState();
    },
    prevQuestion() {
      if (this.roundLocked) return;
      if (!this.activeOrder.length) return;
      if (this.currentQuestionIndex > 0) {
        this.currentQuestionIndex--;
      } else {
        this.currentQuestionIndex = this.activeOrder.length - 1;
      }
      this.showAnswer = false;
      this.saveState();
    },
    skipQuestion() {
      if (this.roundLocked) return;
      this.rateAnswer('excellent');
    },
    difficultyLabel(level) {
      const labels = {
        excellent: 'Ausgezeichnet',
        good: 'Gut',
        fair: 'Okay',
        poor: 'Schlecht'
      };
      if (!level || !labels[level]) return 'Unbekannt';
      return labels[level];
    },
    saveState() {
      this.lastActivityDate = this.getTodayString();
      localStorage.setItem('currentQuestionIndex', this.currentQuestionIndex);
      localStorage.setItem('stats', JSON.stringify(this.stats));
      localStorage.setItem('questionStats', JSON.stringify(this.questionStats));
      localStorage.setItem('activeOrder', JSON.stringify(this.activeOrder));
      localStorage.setItem('showStats', this.showStats);
      localStorage.setItem('showQuestionList', this.showQuestionList);
      localStorage.setItem('answerHistory', JSON.stringify(this.answerHistory));
      localStorage.setItem('lastActivityDate', this.lastActivityDate);
      localStorage.setItem('roundLocked', this.roundLocked);
    },
    loadState() {
      const savedIndexStr = localStorage.getItem('currentQuestionIndex');
      if (savedIndexStr !== null) {
        const idx = parseInt(savedIndexStr);
        if (!isNaN(idx) && idx >= 0) {
          this.currentQuestionIndex = idx;
        }
      }
      const statsStr = localStorage.getItem('stats');
      if (statsStr) {
        try {
          const parsedStats = JSON.parse(statsStr);
          const keys = ['total','correct','incorrect','excellent','good','fair','poor'];
          if (keys.every(k => parsedStats.hasOwnProperty(k))) {
            this.stats = parsedStats;
          }
        } catch (e) {}
      }
      const showStatsStr = localStorage.getItem('showStats');
      this.showStats = showStatsStr === 'true';
      const showListStr = localStorage.getItem('showQuestionList');
      this.showQuestionList = showListStr === 'true';
      const histStr = localStorage.getItem('answerHistory');
      if (histStr) {
        try {
          const parsedHist = JSON.parse(histStr);
          if (Array.isArray(parsedHist)) {
            this.answerHistory = parsedHist;
          }
        } catch (e) {}
      }
      const lastActivity = localStorage.getItem('lastActivityDate');
      if (lastActivity) {
        this.lastActivityDate = lastActivity;
      }
      const roundLockedStr = localStorage.getItem('roundLocked');
      if (roundLockedStr !== null) {
        this.roundLocked = roundLockedStr === 'true';
      }
      if (this.currentQuestionIndex >= this.activeOrder.length) {
        this.currentQuestionIndex = 0;
      }
    },
    restartSequence() {
      this.activeOrder = this.questions
        .map((_, idx) => idx)
        .filter(i => !this.questionStats[i].mastered);

      if (this.activeOrder.length === 0) {
        this.activeOrder = this.questions.map((_, idx) => idx);
        this.questions.forEach((_, idx) => {
          this.questionStats[idx].mastered = false;
        });
      }

      this.shuffleActiveOrder();
      this.currentQuestionIndex = 0;
      this.showAnswer = false;
      this.answerHistory = [];
      this.resetRoundTracking();
      this.saveState();
    },
    reintroduceQuestion(qIndex) {
      const stat = this.questionStats[qIndex];
      if (stat && stat.mastered) {
        stat.mastered = false;
        if (!this.activeOrder.includes(qIndex)) {
          this.activeOrder.push(qIndex);
          this.shuffleActiveOrder();
        }
        this.saveState();
      }
    },
    resetSingleQuestion(qIndex) {
      if (qIndex < 0 || qIndex >= this.questionStats.length) return;
      const stat = this.questionStats[qIndex];
      if (!stat) return;
      this.stats.total -= stat.total;
      this.stats.correct -= stat.excellent + stat.good;
      this.stats.incorrect -= stat.fair + stat.poor;
      this.stats.excellent -= stat.excellent;
      this.stats.good -= stat.good;
      this.stats.fair -= stat.fair;
      this.stats.poor -= stat.poor;
      this.questionStats[qIndex] = this.createEmptyQuestionStat();
      const activeIdx = this.activeOrder.indexOf(qIndex);
      if (activeIdx === -1) {
        this.activeOrder.push(qIndex);
        this.shuffleActiveOrder();
      }
      if (this.currentQuestionIndex >= this.activeOrder.length) {
        this.currentQuestionIndex = 0;
      }
      this.saveState();
    },
    resetAllQuestions(skipConfirm = false) {
      if (!skipConfirm && !confirm('Möchtest du wirklich alle Fortschritte und Statistiken zurücksetzen?')) {
        return;
      }
      this.questionStats = this.questions.map(() => this.createEmptyQuestionStat());
      this.stats = {
        total: 0,
        correct: 0,
        incorrect: 0,
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0
      };
      this.activeOrder = this.questions.map((_, idx) => idx);
      this.shuffleActiveOrder();
      this.currentQuestionIndex = 0;
      this.showAnswer = false;
      this.answerHistory = [];
      this.resetRoundTracking();
      this.saveState();
    },
    toggleStats() {
      this.showStats = !this.showStats;
      this.saveState();
    },
    toggleQuestionList() {
      this.showQuestionList = !this.showQuestionList;
      this.saveState();
    },
    closeRoundCompleteModal() {
      this.showRoundCompleteModal = false;
    },
    startNewRoundFromModal() {
      this.showRoundCompleteModal = false;
      this.restartSequence();
    },
    openInfoModal() {
      this.showInfoModal = true;
    },
    closeInfoModal() {
      this.showInfoModal = false;
    },
    acknowledgeUpdate(resetStats) {
      if (this.pendingQuestions) {
        this.questions = this.pendingQuestions;
        localStorage.setItem('cachedQuestions', JSON.stringify(this.questions));
      }
      if (this.pendingFingerprint) {
        localStorage.setItem('questionsFingerprint', this.pendingFingerprint);
      }
      this.showUpdateModal = false;
      this.updateMessage = '';
      if (resetStats) {
        this.resetAllQuestions(true);
      } else {
        this.initializeStatsAndOrder();
        this.loadState();
        if (!Array.isArray(this.activeOrder) || this.activeOrder.length === 0) {
          this.questionStats.forEach(stat => { stat.mastered = false; });
          this.activeOrder = this.questions.map((_, idx) => idx);
        }
        this.restartSequence();
      }
      this.pendingQuestions = null;
      this.pendingFingerprint = null;
    },
    postponeUpdate() {
      this.showUpdateModal = false;
      this.updateMessage = '';
      // leave fingerprint untouched so the popup reappears on next visit
    },
    generateQuestionsFingerprint(questions) {
      if (!Array.isArray(questions)) return '';
      return JSON.stringify(
        questions.map(q => ({
          id: q.id,
          question: q.question,
          answer: q.answer,
          explanation: q.explanation,
          topic: q.topic
        }))
      );
    },
    getCachedQuestions() {
      const cached = localStorage.getItem('cachedQuestions');
      if (!cached) return null;
      try {
        const parsed = JSON.parse(cached);
        return Array.isArray(parsed) ? parsed : null;
      } catch (e) {
        return null;
      }
    },
    applyDailyDecay() {
      const today = this.getTodayString();
      if (!this.lastActivityDate) {
        this.lastActivityDate = today;
        return;
      }
      const diffDays = this.calculateDayDifference(this.lastActivityDate, today);
      if (diffDays <= 0) {
        this.lastActivityDate = today;
        return;
      }
      const penalty = diffDays * 0.5;
      this.questionStats.forEach(stat => {
        if (!stat) return;
        if (typeof stat.score !== 'number') {
          stat.score = 0;
        }
        stat.score -= penalty;
      });
      this.lastActivityDate = today;
    },
    getTodayString() {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return now.toISOString().split('T')[0];
    },
    calculateDayDifference(startDateStr, endDateStr) {
      if (!startDateStr || !endDateStr) return 0;
      try {
        const start = new Date(`${startDateStr}T00:00:00`);
        const end = new Date(`${endDateStr}T00:00:00`);
        const diffMs = end.getTime() - start.getTime();
        return diffMs > 0 ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : 0;
      } catch (e) {
        return 0;
      }
    }
  },
  mounted() {
    this.loadQuestions();
  }
});
