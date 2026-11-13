"use strict";

const setupScreen = document.querySelector("#setup-screen");
const examScreen = document.querySelector("#exam-screen");
const resultScreen = document.querySelector("#result-screen");
const setupForm = document.querySelector("#setup-form");
const levelSelect = document.querySelector("#level-select");
const topicSelect = document.querySelector("#topic-select");
const countInput = document.querySelector("#question-count");
const durationSelect = document.querySelector("#duration-select");
const availabilityNote = document.querySelector("#availability-note");
const setupError = document.querySelector("#setup-error");
const startButton = document.querySelector("#start-button");
const questionNav = document.querySelector("#question-nav");
const optionList = document.querySelector("#option-list");
const examMessage = document.querySelector("#exam-message");
const progressTrack = document.querySelector(".progress-track");

let bankMeta;
let session;

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function setupHeroMotion() {
  const hero = document.querySelector(".landing-hero");
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || !window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ) {
    return;
  }

  let pointerX = 0;
  let pointerY = 0;
  let framePending = false;
  hero.addEventListener("pointermove", (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(() => {
      framePending = false;
      const bounds = hero.getBoundingClientRect();
      const horizontal = Math.max(0, Math.min(1, (pointerX - bounds.left) / bounds.width));
      const vertical = Math.max(0, Math.min(1, (pointerY - bounds.top) / bounds.height));
      hero.style.setProperty("--pointer-x", `${(horizontal * 100).toFixed(1)}%`);
      hero.style.setProperty("--pointer-y", `${(vertical * 100).toFixed(1)}%`);
      hero.style.setProperty("--pointer-tilt-x", `${((horizontal - 0.5) * 10).toFixed(2)}deg`);
      hero.style.setProperty("--pointer-tilt-y", `${((0.5 - vertical) * 7).toFixed(2)}deg`);
    });
  });
  hero.addEventListener("pointerleave", () => {
    hero.style.setProperty("--pointer-x", "72%");
    hero.style.setProperty("--pointer-y", "42%");
    hero.style.setProperty("--pointer-tilt-x", "0deg");
    hero.style.setProperty("--pointer-tilt-y", "0deg");
  });
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      "The question-bank API is not running. Live Server only serves the page. In the project folder run `npm start`, then open http://127.0.0.1:3000."
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The question-bank API returned invalid data. Stop and restart it with `npm start`.");
  }
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

function availableQuestionCount() {
  const topic = topicSelect.value;
  const level = levelSelect.value;
  if (!topic) {
    return level === "mixed" ? bankMeta.total : bankMeta.levels[level];
  }
  const counts = bankMeta.topicCounts[topic];
  if (!counts) return 0;
  return level === "mixed" ? counts.total : counts[level];
}

function updateAvailability() {
  if (!bankMeta) return;
  const available = availableQuestionCount();
  countInput.max = String(available);
  countInput.min = "1";
  if (available === 0) {
    countInput.value = "0";
    startButton.disabled = true;
    availabilityNote.textContent = "No questions are available for this selection.";
    return;
  }
  startButton.disabled = false;
  if (Number(countInput.value) > available) {
    countInput.value = String(available);
  }
  if (!Number.isInteger(Number(countInput.value)) || Number(countInput.value) < 1) {
    countInput.value = "1";
  }
  availabilityNote.textContent = `${available} question${available === 1 ? "" : "s"} available for this selection.`;
}

function populateSetup(meta) {
  bankMeta = meta;
  document.querySelector("#total-count").textContent = String(meta.total);
  document.querySelector("#medium-count").textContent = String(meta.levels.medium);
  document.querySelector("#hard-count").textContent = String(meta.levels.hard);
  for (const topic of meta.topics) {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    topicSelect.append(option);
  }
  updateAvailability();
}

function setScreen(screen) {
  setupScreen.hidden = screen !== "setup";
  examScreen.hidden = screen !== "exam";
  resultScreen.hidden = screen !== "result";
  document.querySelector("#mobile-submit-bar").hidden = screen !== "exam";
  const activeScreen = screen === "setup" ? setupScreen : screen === "exam" ? examScreen : resultScreen;
  activeScreen.classList.remove("is-entering");
  requestAnimationFrame(() => activeScreen.classList.add("is-entering"));
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  window.scrollTo({ top: 0, behavior });
}

function examTitle() {
  const level = levelSelect.value;
  const topic = topicSelect.value;
  const levelText = level === "mixed" ? "Mixed" : level[0].toUpperCase() + level.slice(1);
  return `${levelText} nursing questions${topic ? ` · ${topic}` : ""}`;
}

async function startExam(event) {
  event.preventDefault();
  showMessage(setupError, "");
  const count = Number(countInput.value);
  const available = availableQuestionCount();
  if (!Number.isInteger(count) || count < 1 || count > available) {
    showMessage(setupError, `Enter a whole number between 1 and ${available}.`);
    return;
  }

  startButton.disabled = true;
  startButton.textContent = "Preparing questions…";
  try {
    const params = new URLSearchParams({
      level: levelSelect.value,
      count: String(count),
    });
    if (topicSelect.value) params.set("topic", topicSelect.value);
    const payload = await requestJson(`/api/questions?${params}`);
    const duration = Number(durationSelect.value);
    session = {
      examId: payload.examId,
      questions: payload.questions,
      answers: {},
      feedback: {},
      checking: new Set(),
      marked: new Set(),
      index: 0,
      secondsLeft: duration * 60,
      timerId: null,
      submitting: false,
      finished: false,
    };
    document.querySelector("#exam-title").textContent = examTitle();
    showMessage(examMessage, "");
    setScreen("exam");
    renderQuestion();
    if (duration > 0) {
      updateTimer();
      session.timerId = window.setInterval(tick, 1000);
    } else {
      document.querySelector("#timer").textContent = "No timer";
    }
  } catch (error) {
    session = null;
    setScreen("setup");
    showMessage(setupError, error.message);
  } finally {
    startButton.disabled = false;
    startButton.innerHTML = 'Start practice exam <span aria-hidden="true">→</span>';
  }
}

function renderQuestion() {
  const question = session.questions[session.index];
  const questionCard = document.querySelector(".question-card");
  questionCard.classList.remove("is-entering");
  requestAnimationFrame(() => questionCard.classList.add("is-entering"));
  document.querySelector("#progress-text").textContent = `Question ${session.index + 1} of ${session.questions.length}`;
  const questionType = question.format === "written" ? "Written response" : "Multiple choice";
  document.querySelector("#question-level").textContent = `${question.level[0].toUpperCase() + question.level.slice(1)} · ${questionType}`;
  document.querySelector("#question-level").className = `pill ${question.level} ${question.format}`;
  optionList.querySelector("legend").textContent = question.format === "written" ? "Type your answer" : "Choose one answer";
  document.querySelector("#question-topic").textContent = question.topic;
  document.querySelector("#question-stem").textContent = question.stem;
  document.querySelector("#previous-button").disabled = session.index === 0;
  document.querySelector("#next-button").textContent = session.index === session.questions.length - 1 ? "Last question" : "Next →";
  const feedback = session.feedback[question.id];
  const checking = session.checking.has(question.id);
  const hasAnswer = session.answers[question.id] !== undefined;
  document.querySelector("#question-card").classList.toggle("has-feedback", Boolean(feedback));
  document.querySelector("#next-button").disabled = (hasAnswer && !feedback) || checking;
  showMessage(examMessage, "");
  renderAnswerFeedback(feedback);

  const marked = session.marked.has(question.id);
  const markButton = document.querySelector("#mark-button");
  markButton.setAttribute("aria-pressed", String(marked));
  markButton.textContent = marked ? "★ Marked for review" : "☆ Mark for review";
  markButton.classList.toggle("is-marked", marked);

  optionList.replaceChildren(optionList.querySelector("legend"));
  if (question.format === "written") {
    const label = document.createElement("label");
    label.className = "written-response-label";
    label.htmlFor = "written-response";
    label.textContent = "Your answer";
    const response = document.createElement("textarea");
    response.id = "written-response";
    response.name = "written-response";
    response.rows = 3;
    response.maxLength = 2000;
    response.placeholder = "Type your answer here…";
    response.value = session.answers[question.id] || "";
    response.disabled = Boolean(feedback) || checking;
    response.addEventListener("input", () => {
      const value = response.value;
      if (value.trim()) session.answers[question.id] = value;
      else delete session.answers[question.id];
      renderProgress();
      renderQuestionNav();
      checkButton.disabled = !value.trim() || Boolean(session.feedback[question.id]) || session.checking.has(question.id);
      document.querySelector("#next-button").disabled = Boolean(value.trim());
    });
    const checkButton = document.createElement("button");
    checkButton.type = "button";
    checkButton.className = "button button-check";
    checkButton.textContent = checking ? "Checking answer…" : "Check answer";
    checkButton.disabled = !hasAnswer || Boolean(feedback) || checking;
    checkButton.addEventListener("click", () => checkCurrentAnswer());
    optionList.append(label, response, checkButton);
  } else {
    question.options.forEach((text, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option-row";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "answer";
      radio.value = String(optionIndex);
      radio.checked = session.answers[question.id] === optionIndex;
      radio.disabled = Boolean(feedback) || checking;
      radio.addEventListener("change", () => {
        session.answers[question.id] = optionIndex;
        renderProgress();
        renderQuestionNav();
        checkCurrentAnswer();
      });
      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.textContent = String.fromCharCode(65 + optionIndex);
      const answer = document.createElement("span");
      answer.className = "option-text";
      answer.textContent = text;
      label.append(radio, letter, answer);
      optionList.append(label);
    });
  }
  renderProgress();
  renderQuestionNav();
  document.querySelector("#question-stem").focus({ preventScroll: true });
}

function renderAnswerFeedback(feedback) {
  const panel = document.querySelector("#answer-feedback");
  panel.hidden = !feedback;
  panel.classList.toggle("is-correct", Boolean(feedback?.correct));
  panel.classList.toggle("is-incorrect", Boolean(feedback && !feedback.correct));
  if (!feedback) {
    document.querySelector("#feedback-heading").textContent = "";
    document.querySelector("#feedback-answer").textContent = "";
    document.querySelector("#feedback-explanation").textContent = "";
    return;
  }
  document.querySelector("#feedback-heading").textContent = feedback.correct ? "Correct!" : "Not quite";
  document.querySelector("#feedback-answer").textContent = feedback.correct
    ? "Your answer is correct."
    : `Correct answer: ${feedback.correctAnswer}`;
  document.querySelector("#feedback-explanation").textContent = feedback.explanation;
}

async function checkCurrentAnswer() {
  if (!session || session.finished) return;
  const question = session.questions[session.index];
  const answer = session.answers[question.id];
  if (answer === undefined || session.feedback[question.id] || session.checking.has(question.id)) return;
  showMessage(examMessage, "");
  session.checking.add(question.id);
  renderQuestion();
  try {
    const feedback = await requestJson("/api/check-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId: session.examId,
        questionId: question.id,
        answer,
      }),
    });
    session.feedback[question.id] = feedback;
  } catch (error) {
    showMessage(examMessage, error.message);
  } finally {
    session.checking.delete(question.id);
    renderQuestion();
    renderProgress();
    renderQuestionNav();
  }
}

function moveToQuestion(index) {
  const currentQuestion = session.questions[session.index];
  if (
    index !== session.index
    && session.answers[currentQuestion.id] !== undefined
    && !session.feedback[currentQuestion.id]
  ) {
    showMessage(examMessage, "Check your answer before moving to another question.");
    return;
  }
  session.index = index;
  renderQuestion();
}

function renderProgress() {
  const answered = Object.keys(session.answers).length;
  document.querySelector("#answered-text").textContent = `${answered} answered`;
  document.querySelector("#mobile-answered-count").textContent = `${answered} of ${session.questions.length} answered`;
  const percentage = Math.round(((session.index + 1) / session.questions.length) * 100);
  document.querySelector("#progress-fill").style.width = `${percentage}%`;
  progressTrack.setAttribute("aria-valuenow", String(percentage));
}

function renderQuestionNav() {
  questionNav.replaceChildren();
  session.questions.forEach((question, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(index + 1);
    button.className = "nav-question";
    if (session.answers[question.id] !== undefined) button.classList.add("answered");
    if (session.marked.has(question.id)) button.classList.add("marked");
    if (index === session.index) button.classList.add("current");
    button.setAttribute("aria-label", `Go to question ${index + 1}${session.answers[question.id] !== undefined ? ", answered" : ", unanswered"}${session.marked.has(question.id) ? ", marked for review" : ""}`);
    button.setAttribute("aria-current", index === session.index ? "step" : "false");
    button.addEventListener("click", () => {
      moveToQuestion(index);
    });
    questionNav.append(button);
  });
  const unanswered = session.questions.length - Object.keys(session.answers).length;
  document.querySelector("#unanswered-warning").textContent = unanswered ? `${unanswered} unanswered` : "All questions answered";
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateTimer() {
  const timer = document.querySelector("#timer");
  timer.textContent = formatTime(session.secondsLeft);
  timer.classList.toggle("timer-warning", session.secondsLeft <= 300);
}

function tick() {
  if (!session || session.finished) return;
  session.secondsLeft -= 1;
  updateTimer();
  if (session.secondsLeft <= 0) {
    finishExam(true);
  }
}

async function finishExam(automatic = false) {
  if (!session || session.finished || session.submitting) return;
  const uncheckedIndex = session.questions.findIndex((question) => (
    session.answers[question.id] !== undefined && !session.feedback[question.id]
  ));
  if (!automatic && uncheckedIndex !== -1) {
    moveToQuestion(uncheckedIndex);
    showMessage(examMessage, "Check your answer before submitting the exam.");
    return;
  }
  const unanswered = session.questions.length - Object.keys(session.answers).length;
  const confirmation = unanswered > 0
    ? `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway? You cannot change answers after submission.`
    : "Submit your exam now? You cannot change answers after submission.";
  if (!automatic && !window.confirm(confirmation)) {
    return;
  }

  session.submitting = true;
  document.querySelector("#submit-button").disabled = true;
  document.querySelector("#mobile-submit-button").disabled = true;
  showMessage(examMessage, automatic ? "Time is up. Your answers are being scored…" : "");
  try {
    const result = await requestJson("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId: session.examId,
        answers: session.answers,
      }),
    });
    session.finished = true;
    window.clearInterval(session.timerId);
    renderResults(result);
    setScreen("result");
  } catch (error) {
    showMessage(examMessage, error.message);
  } finally {
    session.submitting = false;
    document.querySelector("#submit-button").disabled = false;
    document.querySelector("#mobile-submit-button").disabled = false;
  }
}

function renderResults(result) {
  const incorrect = result.total - result.score;
  document.querySelector("#score-percent").textContent = `${result.percent}%`;
  document.querySelector(".score-card").classList.toggle("is-celebrating", result.percent >= 80);
  document.querySelector("#score-detail").textContent = `${result.score} of ${result.total} correct`;
  document.querySelector("#score-message").textContent = result.percent >= 80
    ? `Strong work. You answered ${result.score} correctly and missed ${incorrect}.`
    : `Keep practicing. Review the explanations below, then try another session.`;
  session.results = result.results;
  renderReviewList();
}

function renderReviewList() {
  const filter = document.querySelector("#review-filter").value;
  const container = document.querySelector("#review-list");
  container.replaceChildren();
  const results = session.results.filter((result) => {
    if (filter === "incorrect") return !result.correct && result.answered;
    if (filter === "unanswered") return !result.answered;
    return true;
  });
  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-review";
    empty.textContent = "No questions match this review filter.";
    container.append(empty);
    return;
  }

  results.forEach((result, index) => {
    const card = document.createElement("article");
    card.className = `review-card ${result.correct ? "review-correct" : "review-incorrect"}`;
    const heading = document.createElement("div");
    heading.className = "review-card-heading";
    const number = document.createElement("span");
    number.className = "review-number";
    number.textContent = `Question ${index + 1}`;
    const status = document.createElement("span");
    status.className = "review-status";
    status.textContent = result.correct ? "Correct" : !result.answered ? "Unanswered" : "Review";
    heading.append(number, status);
    const stem = document.createElement("h3");
    stem.textContent = result.stem;
    const selected = document.createElement("p");
    selected.className = "review-answer";
    selected.textContent = !result.answered
      ? "Your answer: Not answered"
      : `Your answer: ${result.format === "written" ? result.responseText : result.options[result.selectedIndex]}`;
    const correct = document.createElement("p");
    correct.className = "review-answer correct-answer";
    correct.textContent = `Correct answer: ${result.correctAnswer}`;
    const explanation = document.createElement("p");
    explanation.className = "review-explanation";
    explanation.textContent = result.explanation;
    const meta = document.createElement("p");
    meta.className = "review-meta";
    meta.textContent = `${result.level[0].toUpperCase() + result.level.slice(1)} · ${result.format === "written" ? "Written response" : "Multiple choice"} · ${result.topic} · Source: ${result.source}`;
    card.append(heading, stem, selected, correct, explanation, meta);
    container.append(card);
  });
}

function returnToSetup() {
  if (session?.timerId) window.clearInterval(session.timerId);
  session = null;
  showMessage(setupError, "");
  setScreen("setup");
}

setupForm.addEventListener("submit", startExam);
levelSelect.addEventListener("change", updateAvailability);
topicSelect.addEventListener("change", updateAvailability);
countInput.addEventListener("change", updateAvailability);
document.querySelector("#previous-button").addEventListener("click", () => {
  if (session.index > 0) {
    moveToQuestion(session.index - 1);
  }
});
document.querySelector("#next-button").addEventListener("click", () => {
  if (session.index < session.questions.length - 1) {
    moveToQuestion(session.index + 1);
  }
});
document.querySelector("#mark-button").addEventListener("click", () => {
  const id = session.questions[session.index].id;
  if (session.marked.has(id)) session.marked.delete(id);
  else session.marked.add(id);
  renderQuestion();
});
document.querySelector("#submit-button").addEventListener("click", () => finishExam());
document.querySelector("#mobile-submit-button").addEventListener("click", () => finishExam());
document.querySelector("#retry-button").addEventListener("click", returnToSetup);
document.querySelector("#review-filter").addEventListener("change", renderReviewList);

setupHeroMotion();

requestJson("/api/meta")
  .then(populateSetup)
  .catch((error) => {
    showMessage(setupError, `Could not load the question bank: ${error.message}`);
    startButton.disabled = true;
  });
