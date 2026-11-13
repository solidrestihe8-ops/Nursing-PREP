# Nursing CBT practice app

A dependency-free CBT-style practice app using HTML, CSS, and Node.js. The bank contains 300 questions: 150 medium and 150 hard. 210 (70%) are typed written-response questions with no answer choices; the remaining 90 are multiple choice. Questions include topic tags, source-document labels, and answer explanations.

## Run locally

1. Install Node.js if it is not already installed.
2. Open a terminal in this folder and run `npm start`.
3. Keep that terminal open and visit `http://127.0.0.1:3000` in a browser.

No `npm install` is required; the server uses Node's built-in HTTP modules.
Do not open `index.html` directly or use VS Code Live Server: those serve the page without starting the Node API the exam needs.
If the terminal says the port is already in use, the app may already be running; open the URL above instead of starting another copy. To restart it, press `Ctrl+C` in the terminal running the existing server, then run `npm start` once.

## Included features

- Mixed, medium-only, or hard-only practice exams
- Topic and question-count filters
- Optional countdown timer
- Question navigation, answer tracking, and review flags
- Immediate answer feedback; incorrect answers show the reference answer and explanation before continuing
- Server-side scoring and post-exam explanations with source references
- Written responses are checked against the reference answer after normalizing case, accents, punctuation, and whitespace

Questions are for study and practice. Check current evidence, local law, and clinical protocols before applying material to patient care.
