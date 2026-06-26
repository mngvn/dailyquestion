// vibecoder.js — the "Vibe Coder" Easter egg.
// A supremely confident 10x-energy developer who vibe codes, ships straight
// to prod, and has never encountered a bug that wasn't, on reflection, a
// feature. You can talk to him. He will deflect everything with dev-speak.

(function () {
  "use strict";

  const lineEl = document.getElementById("vcLine");
  const speakerEl = document.getElementById("vcSpeaker");
  const bubbleEl = document.getElementById("vcBubble");
  const choicesEl = document.getElementById("vcChoices");
  const hintEl = document.getElementById("vcHint");
  const guyEl = document.getElementById("vcGuy");
  const meterFill = document.getElementById("vcMeterFill");

  const NAME = "The vibe coder";

  // ----- Line pools ---------------------------------------------------------
  const OPENERS = [
    "Oh hey. Yeah, I'm basically a 10x engineer now. I just vibe code.",
    "Sup. Shipped three features before lunch. Didn't read a single line.",
    "Oh, you code too? That's cute. I mostly just vibe with the codebase."
  ];

  const BRAG = [
    "I don't really read code anymore. I just kind of… vibe with it.",
    "Honestly? Shipped it. We'll fix it in prod if anyone complains.",
    "The AI wrote it, sure, but the architecture? That was all me.",
    "It works on my machine, so. Sounds like a you problem.",
    "I'm like 10x now that I vibe code. Some days 12x. I don't measure, I feel it.",
    "Tech debt is a future-me problem. Future me is, frankly, cooked.",
    "I rewrote the whole thing in Rust this weekend. No reason. Pure vibes.",
    "Did I read the docs? Bro. I *am* the docs.",
    "It's not over-engineered, it's future-proof. You'll thank me in v4.",
    "I just prompt my way out of everything now. It's a superpower.",
    "All my variables are named `data`, `data2`, and `temp_final_FINAL`.",
    "I deploy on Fridays. I live on the edge. Specifically the Edge runtime.",
    "Comments are a code smell. Good code should just vibe for itself.",
    "I don't do standups. My commits speak for themselves. They all say 'wip'.",
    "I don't have bugs. I have a rich, emergent feature set."
  ];

  const REACTIONS = {
    bug: [
      "That's not a bug. That's a feature. Emergent behavior, really.",
      "Bug? I prefer the term 'undocumented feature.'",
      "Works on my machine. Respectfully? Skill issue."
    ],
    tests: [
      "Tests? Yeah, that's out of scope for this sprint.",
      "We'll circle back to tests. We won't, but we'll say we will.",
      "Tests are just vibes you don't trust. And I trust my vibes."
    ],
    explain: [
      "Honestly? No. Me and the AI have, like, an understanding.",
      "I'd explain it but it's kind of a 'you had to be in the prompt' thing.",
      "It works. Explaining *why* is, respectfully, out of scope."
    ],
    over: [
      "It's not over-engineered, it's *future-proof*. You're welcome.",
      "That's a v2 concern. Or v3. Definitely not v1-me's problem.",
      "Abstraction is a love language. I love this codebase very, very much."
    ],
    fix: [
      "Yeah yeah, I'll circle back to it. (He will not circle back to it.)",
      "Let's take this offline. And then never, ever speak of it again.",
      "Pushed a fix — by which I mean a `// TODO` and a new feature flag."
    ]
  };

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ----- State --------------------------------------------------------------
  let ego = 1;
  let typingTimer = null;
  let pendingTimer = null;

  function setMeter() { meterFill.style.width = (ego / 6) * 100 + "%"; }
  function bump(d) { ego = Math.max(1, Math.min(6, ego + d)); setMeter(); }

  // ----- Typewriter ---------------------------------------------------------
  function typeLine(text, onDone) {
    clearTimeout(typingTimer);
    lineEl.textContent = "";
    bubbleEl.classList.add("show");
    guyEl.classList.remove("vc-talk");
    void guyEl.offsetWidth;

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
        typingTimer = setTimeout(step, 55 + Math.random() * 42);
      } else {
        caret.remove();
        if (onDone) onDone();
      }
    })();
  }

  function lockChoices(locked) { choicesEl.classList.toggle("tn-locked", locked); }

  // ----- Choices ------------------------------------------------------------
  const MENU = [
    { id: "bug", label: "There's a bug in the login flow." },
    { id: "tests", label: "Did you write any tests?" },
    { id: "explain", label: "Can you explain how this works?" },
    { id: "over", label: "This is wildly over-engineered." },
    { id: "fix", label: "Can you just fix it?" }
  ];

  function renderMenu() {
    choicesEl.innerHTML = "";
    MENU.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tn-choice";
      btn.textContent = c.label;
      btn.addEventListener("click", () => onChoice(c));
      choicesEl.appendChild(btn);
    });
    lockChoices(false);
  }

  function onChoice(choice) {
    clearTimeout(pendingTimer);
    lockChoices(true);
    bump(1);
    speakerEl.textContent = NAME;
    typeLine(rand(REACTIONS[choice.id]), () => {
      pendingTimer = setTimeout(() => {
        typeLine(rand(BRAG), () => lockChoices(false));
      }, 900);
    });
  }

  // ----- Boot ---------------------------------------------------------------
  speakerEl.textContent = "???";
  setMeter();
  renderMenu();
  lockChoices(true);

  setTimeout(() => {
    speakerEl.textContent = NAME;
    typeLine(rand(OPENERS), () => lockChoices(false));
  }, 500);
})();
