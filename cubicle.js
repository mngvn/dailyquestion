// cubicle.js — the "401(k) Guy" Easter egg.
// One overenthusiastic coworker. He pitches his 401(k), then insists on
// running your "retirement numbers" via a short quiz with deliberately
// absurd multiple-choice answers, then confidently calculates a ridiculous
// retirement age (plus a couple more joke calculations).

(function () {
  "use strict";

  const lineEl = document.getElementById("koLine");
  const speakerEl = document.getElementById("koSpeaker");
  const bubbleEl = document.getElementById("koBubble");
  const choicesEl = document.getElementById("koChoices");
  const hintEl = document.getElementById("koHint");
  const meterFill = document.getElementById("koMeterFill");
  const readoutEl = document.getElementById("koReadout");
  const readoutLabel = document.getElementById("koReadoutLabel");
  const readoutValue = document.getElementById("koReadoutValue");
  const readoutNote = document.getElementById("koReadoutNote");

  const SPEAKER = "The 401(k) guy";

  // ----- Intro pitch lines --------------------------------------------------
  const PITCH = [
    "Oh hey! Quick question — you aren't invested in your 401(k), are you?",
    "I may switch from 15 to 20% just so I can retire earlier.",
    "Time in the market beats timing the market, my friend.",
    "Tell you what — let me just run your numbers real quick. Free of charge."
  ];

  // ----- The quiz -----------------------------------------------------------
  // Each option carries a quip (his reaction) and a few "absurdity points"
  // that feed the final calculation.
  const QUESTIONS = [
    {
      q: "First things first — when do you want to retire?",
      opts: [
        { t: "Yesterday, ideally.", p: 4, quip: "Aggressive timeline. I respect the hustle." },
        { t: "Age 9.", p: 9, quip: "Ah, a child prodigy of leisure. Noted." },
        { t: "Three weeks from Thursday.", p: 3, quip: "Tight, but the match is strong with you." },
        { t: "Never. I am one with the cubicle.", p: 7, quip: "Dedication! HR is going to be thrilled." }
      ]
    },
    {
      q: "And what household income are we working with?",
      opts: [
        { t: "I started at $10 million and worked my way down.", p: 8, quip: "A classic bootstraps story. Inspiring, truly." },
        { t: "Exactly $1, but it's a really good dollar.", p: 5, quip: "Liquidity is king. We can absolutely work with this." },
        { t: "I'm paid entirely in exposure.", p: 6, quip: "Ah, the exposure portfolio. High risk, high… exposure." },
        { t: "Define 'income.'", p: 4, quip: "A philosopher. The IRS adores those." }
      ]
    },
    {
      q: "How much are you contributing right now?",
      opts: [
        { t: "0%, but I think about it constantly.", p: 3, quip: "Thoughts don't compound, sadly. But so close!" },
        { t: "147% — I now owe my employer money.", p: 9, quip: "Over-contributing! FINALLY, someone who gets it." },
        { t: "I bury cash in the backyard.", p: 6, quip: "The dirt index fund. Underperforms, but private." },
        { t: "What is a percent.", p: 5, quip: "We'll circle back to that one. Probably." }
      ]
    },
    {
      q: "Current savings — give me the whole nest egg.",
      opts: [
        { t: "Three Beanie Babies, mint condition.", p: 7, quip: "Don't sleep on those. 1998 was a different time." },
        { t: "Negative eleven thousand dollars.", p: 8, quip: "A net-negative net worth. Nowhere to go but up!" },
        { t: "A jar of coins, mostly Canadian.", p: 5, quip: "Diversified into foreign currency. Sophisticated." },
        { t: "My net worth is vibes.", p: 6, quip: "Vibes have outperformed bonds this year, honestly." }
      ]
    },
    {
      q: "Last one — what's your risk tolerance?",
      opts: [
        { t: "I put it all on red.", p: 9, quip: "A one-fund portfolio. Elegant. Terrifying." },
        { t: "I flinch at savings accounts.", p: 2, quip: "Conservative. The mattress awaits, my friend." },
        { t: "Yes.", p: 6, quip: "'Yes.' Perfect. Crystal clear. Love it." },
        { t: "Define 'risk.'", p: 4, quip: "Two philosophers in one sitting. Remarkable." }
      ]
    }
  ];

  // ----- Joke results -------------------------------------------------------
  // The "calculation" is nonsense; it just picks a punchline. Score nudges
  // which bucket we land in so wilder answers tend toward wilder results.
  const RESULTS = [
    { age: "247", note: "Congratulations! You can comfortably retire at 247. We just need to sort out the whole 'mortality' situation first, but the math is airtight." },
    { age: "9", note: "The numbers are clear: your ideal retirement age was 9. Unfortunately that ship has sailed, and it was a very small ship." },
    { age: "−4", note: "Incredible news — you actually retired four years before you were born. The time-travel paperwork is on the third floor, by the printer." },
    { age: "∞", note: "You will achieve financial independence precisely never. On the bright side: unbeatable job security!" },
    { age: "812", note: "At this rate you're on track to retire in the year 812 of the Third Galactic Age. Pack light, and dollar-cost average into moon real estate." },
    { age: "31", note: "You could retire at 31! …in a parallel universe where you answered literally none of these questions the way you just did." }
  ];

  // Extra one-off gag calculations.
  const EXTRA = [
    { label: "Your Coast FIRE number", age: "1 goat", note: "Your Coast FIRE number is exactly one (1) goat and a firm handshake. Coast accordingly." },
    { label: "Nest egg maturity date", age: "Year 4,710", note: "Your nest egg fully matures in the year 4,710. I'll send a calendar invite. Attendance is, regrettably, optional." },
    { label: "Projected net worth", age: "$1.03", note: "Thanks to the sheer magic of compound interest, your $1 becomes $1.03 by the heat death of the universe. We're basically rich." },
    { label: "Safe withdrawal rate", age: "0.0001%", note: "Your safe annual withdrawal rate is 0.0001% — that's about one nickel every leap year. Treat yourself, champ." },
    { label: "Years to financial freedom", age: "∞ + 2", note: "You're a cool infinity-plus-two years from financial freedom. So close you can almost taste it." }
  ];

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ----- State --------------------------------------------------------------
  let confidence = 1;          // 1..6 meter
  let qIndex = 0;
  let score = 0;
  let lastResult = null;
  let lastExtra = null;
  let typingTimer = null;
  let pitchIndex = 0;

  function setMeter() { meterFill.style.width = (confidence / 6) * 100 + "%"; }
  function bump(d) { confidence = Math.max(1, Math.min(6, confidence + d)); setMeter(); }

  // ----- Slow typewriter ----------------------------------------------------
  function typeLine(text, onDone) {
    clearTimeout(typingTimer);
    lineEl.textContent = "";
    bubbleEl.classList.add("show");

    const caret = document.createElement("span");
    caret.className = "tn-caret";
    caret.innerHTML = "&nbsp;";
    lineEl.appendChild(caret);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      caret.remove();
      lineEl.textContent = text;
      if (onDone) onDone();
      return;
    }
    let i = 0;
    (function step() {
      if (i < text.length) {
        caret.insertAdjacentText("beforebegin", text.charAt(i));
        i++;
        // noticeably slower than before
        typingTimer = setTimeout(step, 62 + Math.random() * 48);
      } else {
        caret.remove();
        if (onDone) onDone();
      }
    })();
  }

  // ----- Choice rendering ---------------------------------------------------
  function setChoices(options) {
    choicesEl.innerHTML = "";
    options.forEach((o) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tn-choice" + (o.agree ? " tn-agree" : "");
      btn.textContent = o.t;
      btn.disabled = true;            // locked until he finishes talking
      btn.addEventListener("click", () => o.onPick());
      choicesEl.appendChild(btn);
    });
  }
  function lockChoices(locked) {
    [...choicesEl.children].forEach((b) => (b.disabled = locked));
    choicesEl.classList.toggle("tn-locked", locked);
  }

  // ----- Intro --------------------------------------------------------------
  function startIntro() {
    speakerEl.textContent = SPEAKER;
    hintEl.textContent = "He has a calculator and he is not afraid to use it.";
    typeLine(PITCH[0], () => {
      pitchIndex = 1;
      setChoices([
        { t: "Sure, run my numbers.", agree: true, onPick: startQuiz },
        { t: "Absolutely not.", onPick: () => {
            bump(1);
            typeLine("Ha! Love the enthusiasm. Running them anyway —", () => {
              setTimeout(startQuiz, 500);
            });
          } }
      ]);
      lockChoices(false);
    });
  }

  // ----- Quiz ---------------------------------------------------------------
  function startQuiz() {
    readoutEl.hidden = true;
    qIndex = 0;
    score = 0;
    askQuestion();
  }

  function askQuestion() {
    const q = QUESTIONS[qIndex];
    speakerEl.textContent = SPEAKER;
    hintEl.textContent = `Question ${qIndex + 1} of ${QUESTIONS.length}`;
    typeLine(q.q, () => lockChoices(false));
    setChoices(
      q.opts.map((o) => ({
        t: o.t,
        onPick: () => pickAnswer(o)
      }))
    );
  }

  function pickAnswer(opt) {
    lockChoices(true);
    score += opt.p;
    bump(1);
    speakerEl.textContent = SPEAKER;
    typeLine(opt.quip, () => {
      setTimeout(() => {
        qIndex++;
        if (qIndex < QUESTIONS.length) askQuestion();
        else calculate();
      }, 650);
    });
  }

  // ----- The "calculation" --------------------------------------------------
  function calculate() {
    choicesEl.innerHTML = "";
    hintEl.textContent = "Running advanced financial projections…";
    const steps = [
      "Okay! Crunching the numbers…",
      "Carry the one… annualizing your vibes…",
      "Adjusting for inflation, goats, and Beanie Babies…"
    ];
    let s = 0;
    (function next() {
      typeLine(steps[s], () => {
        s++;
        if (s < steps.length) setTimeout(next, 700);
        else setTimeout(revealResult, 900);
      });
    })();
  }

  function pickResult() {
    // bias toward wilder results with a higher score, but never repeat.
    let r;
    do { r = rand(RESULTS); } while (r === lastResult && RESULTS.length > 1);
    lastResult = r;
    return r;
  }

  function showReadout(label, value, note) {
    readoutLabel.textContent = label;
    readoutValue.textContent = value;
    readoutNote.textContent = note;
    readoutEl.hidden = false;
    // restart the entrance animation
    readoutEl.style.animation = "none";
    void readoutEl.offsetWidth;
    readoutEl.style.animation = "";
  }

  function revealResult() {
    const r = pickResult();
    showReadout("Recommended retirement age", r.age, r.note);
    speakerEl.textContent = SPEAKER;
    typeLine("There it is. Science.", () => {
      hintEl.textContent = "The numbers never lie. (These numbers lie.)";
      setChoices([
        { t: "Run it again (different answers).", agree: true, onPick: startQuiz },
        { t: "Calculate something else.", onPick: doExtra },
      ]);
      lockChoices(false);
    });
  }

  function doExtra() {
    lockChoices(true);
    let e;
    do { e = rand(EXTRA); } while (e === lastExtra && EXTRA.length > 1);
    lastExtra = e;
    bump(1);
    typeLine("Ooh, good call. Let me just pull this up…", () => {
      setTimeout(() => {
        showReadout(e.label, e.age, e.note);
        typeLine("Don't thank me. Thank compound interest.", () => {
          setChoices([
            { t: "Run the whole quiz again.", agree: true, onPick: startQuiz },
            { t: "Calculate something else.", onPick: doExtra },
          ]);
          lockChoices(false);
        });
      }, 700);
    });
  }

  // ----- Boot ---------------------------------------------------------------
  setMeter();
  setTimeout(startIntro, 500);
})();
