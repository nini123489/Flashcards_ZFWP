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
    questionStats: [],
    activeOrder: [],
    showStats: false,
    showQuestionList: false,
    answerHistory: []
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
    }
  },
  methods: {
    async loadQuestions() {
      let loaded = false;
      try {
        const response = await fetch('questions.json');
        if (response.ok) {
          const data = await response.json();
          this.questions = Array.isArray(data) ? data : [];
          loaded = this.questions.length > 0;
        }
      } catch (e) {console.warn('Die Fragen konnten nicht aus der Datei geladen werden. Fallback wird verwendet:', e);}
      if (!loaded) {
        this.questions = fallbackQuestions;
      }
      this.initializeStatsAndOrder();
      this.loadState();
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
        if (typeof merged.score !== 'number') {
          const positiveScore = merged.excellent * 3 + merged.good * 2;
          const negativeScore = merged.fair * 1 + merged.poor * 2;
          const penalty = merged.total * 0.5;
          merged.score = positiveScore - negativeScore - penalty;
        }
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
    shuffleActiveOrder() {
      for (let i = this.activeOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.activeOrder[i], this.activeOrder[j]] = [this.activeOrder[j], this.activeOrder[i]];
      }
    },
    toggleAnswer() {
      this.showAnswer = !this.showAnswer;
    },
    rateAnswer(difficulty) {
      if (!this.questions.length || !this.activeOrder.length) return;
      const questionIndex = this.activeOrder[this.currentQuestionIndex];
      const qs = this.questionStats[questionIndex];
      if (!qs) return;
      qs[difficulty]++;
      qs.total++;
      qs.lastRating = difficulty;
      const positiveScore = qs.excellent * 3 + qs.good * 2;
      const negativeScore = qs.fair * 1 + qs.poor * 2;
      const penalty = qs.total * 0.5;
      qs.score = positiveScore - negativeScore - penalty;
      this.stats.total++;
      if (['excellent', 'good'].includes(difficulty)) {
        this.stats.correct++;
      } else {
        this.stats.incorrect++;
      }
      this.stats[difficulty]++;
      this.evaluateMastery(questionIndex);
      this.answerHistory.push(difficulty);
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
      this.nextQuestion();
    },
    saveState() {
      localStorage.setItem('currentQuestionIndex', this.currentQuestionIndex);
      localStorage.setItem('stats', JSON.stringify(this.stats));
      localStorage.setItem('questionStats', JSON.stringify(this.questionStats));
      localStorage.setItem('activeOrder', JSON.stringify(this.activeOrder));
      localStorage.setItem('showStats', this.showStats);
      localStorage.setItem('showQuestionList', this.showQuestionList);
      localStorage.setItem('answerHistory', JSON.stringify(this.answerHistory));
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
    resetAllQuestions() {
      if (!confirm('Möchtest du wirklich alle Fortschritte und Statistiken zurücksetzen?')) {
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
      this.saveState();
    },
    toggleStats() {
      this.showStats = !this.showStats;
      this.saveState();
    },
    toggleQuestionList() {
      this.showQuestionList = !this.showQuestionList;
      this.saveState();
    }
  },
  mounted() {
    this.loadQuestions();
  }
});
