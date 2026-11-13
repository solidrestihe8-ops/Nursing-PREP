"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { questions } = require("./data/questions");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 64 * 1024;
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/assets/nursing-prep-logo.png", ["assets/nursing-prep-logo.png", "image/png"]],
]);
const topics = [...new Set(questions.map((question) => question.topic))].sort();
const examSessions = new Map();
const EXAM_SESSION_TTL_MS = 3 * 60 * 60 * 1000;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function getPublicQuestion(question) {
  const { correctIndex, answer, explanation, options, ...publicQuestion } = question;
  if (question.format === "multiple-choice") publicQuestion.options = options;
  return publicQuestion;
}

function normalizeAnswer(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function readJsonBody(request, response) {
  return new Promise((resolve) => {
    let body = "";
    let receivedBytes = 0;
    let finished = false;

    request.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        finished = true;
        sendError(response, 413, "Request body is too large.");
        request.resume();
        resolve(null);
        return;
      }
      body += chunk;
    });

    request.on("end", () => {
      if (finished) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        finished = true;
        sendError(response, 400, "Request body must be valid JSON.");
        resolve(null);
      }
    });

    request.on("error", () => {
      if (finished) return;
      finished = true;
      sendError(response, 400, "Could not read the request body.");
      resolve(null);
    });
  });
}

function handleQuestions(requestUrl, response) {
  const level = requestUrl.searchParams.get("level") || "mixed";
  const topic = requestUrl.searchParams.get("topic") || "";
  const countValue = requestUrl.searchParams.get("count") || "50";
  const count = Number(countValue);

  if (!["mixed", "medium", "hard"].includes(level)) {
    sendError(response, 400, "Level must be mixed, medium, or hard.");
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > questions.length) {
    sendError(response, 400, `Count must be a whole number from 1 to ${questions.length}.`);
    return;
  }
  if (topic && !topics.includes(topic)) {
    sendError(response, 400, "The selected topic is not available.");
    return;
  }

  let matches = questions.filter((question) => {
    const matchesLevel = level === "mixed" || question.level === level;
    const matchesTopic = !topic || question.topic === topic;
    return matchesLevel && matchesTopic;
  });
  if (matches.length === 0) {
    sendError(response, 404, "No questions match those filters.");
    return;
  }

  const examCount = Math.min(count, matches.length);
  const byFormat = {
    written: shuffle(matches.filter((question) => question.format === "written")),
    multipleChoice: shuffle(matches.filter((question) => question.format === "multiple-choice")),
  };
  const writtenCount = Math.min(Math.round(examCount * 0.7), byFormat.written.length);
  const selected = byFormat.written.slice(0, writtenCount);
  selected.push(...byFormat.multipleChoice.slice(0, examCount - selected.length));
  if (selected.length < examCount) {
    selected.push(...byFormat.written.slice(writtenCount, writtenCount + examCount - selected.length));
  }
  matches = shuffle(selected);
  const now = Date.now();
  for (const [id, exam] of examSessions) {
    if (exam.expiresAt <= now) examSessions.delete(id);
  }
  const examId = randomUUID();
  examSessions.set(examId, {
    questions: matches,
    checkedAnswers: new Map(),
    expiresAt: now + EXAM_SESSION_TTL_MS,
  });
  sendJson(response, 200, { examId, questions: matches.map(getPublicQuestion) });
}

function scoreAnswer(question, submittedAnswer) {
  if (question.format === "written") {
    const responseText = submittedAnswer.trim();
    return {
      responseText,
      correct: Boolean(responseText) && normalizeAnswer(responseText) === normalizeAnswer(question.answer),
      correctAnswer: question.answer,
      explanation: question.explanation,
    };
  }
  return {
    selectedIndex: submittedAnswer,
    correct: submittedAnswer === question.correctIndex,
    correctAnswer: question.answer,
    explanation: question.explanation,
  };
}

async function handleAnswerCheck(request, response) {
  const payload = await readJsonBody(request, response);
  if (response.writableEnded) return;
  if (!payload || typeof payload.examId !== "string" || typeof payload.questionId !== "string") {
    sendError(response, 400, "Answer check must include an examId and questionId.");
    return;
  }
  const exam = examSessions.get(payload.examId);
  if (!exam || exam.expiresAt <= Date.now()) {
    examSessions.delete(payload.examId);
    sendError(response, 400, "This exam session is invalid or expired.");
    return;
  }
  const question = exam.questions.find((item) => item.id === payload.questionId);
  if (!question) {
    sendError(response, 400, "The question does not belong to this exam.");
    return;
  }

  const submittedAnswer = payload.answer;
  if (question.format === "written") {
    if (typeof submittedAnswer !== "string" || submittedAnswer.length > 2000 || !submittedAnswer.trim()) {
      sendError(response, 400, "Enter a written answer of up to 2,000 characters before checking it.");
      return;
    }
  } else if (!Number.isInteger(submittedAnswer) || submittedAnswer < 0 || submittedAnswer >= question.options.length) {
    sendError(response, 400, "Choose a valid answer before checking it.");
    return;
  }

  const previous = exam.checkedAnswers.get(question.id);
  if (previous !== undefined) {
    const sameAnswer = question.format === "written"
      ? normalizeAnswer(previous) === normalizeAnswer(submittedAnswer)
      : previous === submittedAnswer;
    if (!sameAnswer) {
      sendError(response, 409, "This answer has already been checked and cannot be changed.");
      return;
    }
    sendJson(response, 200, { ...scoreAnswer(question, previous), alreadyChecked: true });
    return;
  }

  exam.checkedAnswers.set(question.id, submittedAnswer);
  sendJson(response, 200, { ...scoreAnswer(question, submittedAnswer), alreadyChecked: false });
}

async function handleSubmission(request, response) {
  const payload = await readJsonBody(request, response);
  if (response.writableEnded) return;
  if (!payload || typeof payload.examId !== "string" || !payload.answers || typeof payload.answers !== "object" || Array.isArray(payload.answers)) {
    sendError(response, 400, "Submission must include an examId and an answers object.");
    return;
  }
  const exam = examSessions.get(payload.examId);
  if (!exam || exam.expiresAt <= Date.now()) {
    examSessions.delete(payload.examId);
    sendError(response, 400, "This exam session is invalid, expired, or already submitted.");
    return;
  }
  const examIds = new Set(exam.questions.map((question) => question.id));
  if (Object.keys(payload.answers).some((id) => !examIds.has(id))) {
    sendError(response, 400, "Submission includes answers for questions outside this exam.");
    return;
  }
  for (const question of exam.questions) {
    const answer = payload.answers[question.id];
    if (answer === undefined) continue;
    if (question.format === "written") {
      if (typeof answer !== "string" || answer.length > 2000) {
        sendError(response, 400, `The written response for ${question.id} must be text under 2,000 characters.`);
        return;
      }
    } else if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
      sendError(response, 400, `The selected option for ${question.id} is invalid.`);
      return;
    }
  }

  const results = exam.questions.map((question) => {
    const id = question.id;
    const submittedAnswer = exam.checkedAnswers.has(id) ? exam.checkedAnswers.get(id) : payload.answers[id];
    const selectedIndex = question.format === "multiple-choice" ? submittedAnswer : undefined;
    const responseText = question.format === "written" && typeof submittedAnswer === "string" ? submittedAnswer.trim() : null;
    const isAnswered = question.format === "written"
      ? Boolean(responseText)
      : Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < question.options.length;
    const correct = question.format === "written"
      ? isAnswered && normalizeAnswer(responseText) === normalizeAnswer(question.answer)
      : isAnswered && selectedIndex === question.correctIndex;
    return {
      ...getPublicQuestion(question),
      selectedIndex: isAnswered && question.format === "multiple-choice" ? selectedIndex : null,
      responseText,
      answered: isAnswered,
      correctIndex: question.correctIndex,
      correctAnswer: question.answer,
      explanation: question.explanation,
      correct,
    };
  });
  const score = results.filter((result) => result.correct).length;
  examSessions.delete(payload.examId);
  sendJson(response, 200, {
    score,
    total: results.length,
    percent: Math.round((score / results.length) * 100),
    results,
  });
}

function serveStatic(pathname, response) {
  const file = staticFiles.get(pathname);
  if (!file) {
    sendError(response, 404, "Page not found.");
    return;
  }

  const [fileName, contentType] = file;
  const filePath = path.join(__dirname, fileName);
  fs.readFile(filePath, (error, content) => {
    if (error) {
      console.error(`Unable to read ${fileName}:`, error.message);
      sendError(response, 500, "The requested page could not be loaded.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  if (requestUrl.pathname === "/api/meta" && request.method === "GET") {
    const topicCounts = Object.fromEntries(topics.map((topic) => {
      const byTopic = questions.filter((question) => question.topic === topic);
      return [topic, {
        total: byTopic.length,
        medium: byTopic.filter((question) => question.level === "medium").length,
        hard: byTopic.filter((question) => question.level === "hard").length,
      }];
    }));
    sendJson(response, 200, {
      total: questions.length,
      levels: {
        medium: questions.filter((question) => question.level === "medium").length,
        hard: questions.filter((question) => question.level === "hard").length,
      },
      topics,
      topicCounts,
    });
    return;
  }
  if (requestUrl.pathname === "/api/questions" && request.method === "GET") {
    handleQuestions(requestUrl, response);
    return;
  }
  if (requestUrl.pathname === "/api/submit" && request.method === "POST") {
    handleSubmission(request, response).catch((error) => {
      console.error("Submission processing failed:", error.message);
      if (!response.writableEnded) sendError(response, 500, "The submission could not be scored.");
    });
    return;
  }
  if (requestUrl.pathname === "/api/check-answer" && request.method === "POST") {
    handleAnswerCheck(request, response).catch((error) => {
      console.error("Answer check failed:", error.message);
      if (!response.writableEnded) sendError(response, 500, "The answer could not be checked.");
    });
    return;
  }
  if (requestUrl.pathname.startsWith("/api/")) {
    sendError(response, 404, "API endpoint not found.");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendError(response, 405, "Method not allowed.");
    return;
  }
  serveStatic(requestUrl.pathname, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Nursing CBT is running at http://${HOST}:${PORT}`);
  console.log(`${questions.length} questions available (${topics.length} topics).`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. The CBT app may already be running at http://127.0.0.1:${PORT}. If not, stop the other server with Ctrl+C before starting this one.`);
  } else {
    console.error("Server failed to start:", error.message);
  }
  process.exitCode = 1;
});
