// cubicle.js — the "401(k) Guy" Easter egg.
// A coworker corners you about his 401(k). It does not stay a one-on-one
// conversation: more and more people flash-mob in, all evangelizing the
// employer match — and then, after a while, the whole crowd turns into
// sheep hopping over a fence, still muttering about index funds.

(function () {
  "use strict";

  const lineEl = document.getElementById("koLine");
  const speakerEl = document.getElementById("koSpeaker");
  const bubbleEl = document.getElementById("koBubble");
  const choicesEl = document.getElementById("koChoices");
  const hintEl = document.getElementById("koHint");
  const meterFill = document.getElementById("koMeterFill");
  const sceneEl = document.getElementById("koScene");
  const crowdEl = document.getElementById("koCrowd");
  const fenceEl = document.getElementById("koFence");
  const dreamEl = document.getElementById("koDream");
  const captionEl = document.getElementById("koCaption");

  // ----- Lines --------------------------------------------------------------
  const PITCH = [
    "I may switch from 15 to 20% just so I can retire earlier.",
    "Wait — you aren't invested in your 401(k)?",
    "Are you even getting the full employer match?",
    "Time in the market beats timing the market, my friend.",
    "I just rebalanced into a target-date fund. Total game changer.",
    "You're basically leaving free money on the table.",
    "Have you considered a Roth, though? The tax-free growth…",
    "My expense ratio is point-oh-three percent. Point. Oh. Three.",
    "I maxed it out by August this year. Felt incredible.",
    "Set it and forget it. Dollar-cost averaging. Trust the process.",
    "Do you even know your vesting schedule?",
    "I dream in S&P 500 index funds.",
    "One percent more and you won't even notice it in your paycheck.",
    "When I retire at 52, don't say I didn't warn you.",
    "It's not gambling if it's diversified."
  ];

  // Lines the crowd murmurs (shorter, for the little bubbles).
  const MOB_LINES = [
    "Max the match!",
    "Are you even invested?",
    "Compound interest!",
    "Free money!",
    "Roth or traditional?",
    "Point-oh-three percent!",
    "Retire at 52!",
    "Index funds, baby.",
    "Up your contribution!",
    "Time in the market!",
    "Don't leave it on the table!",
    "Have you maxed it out?"
  ];

  // Sheepified versions for the finale.
  const SHEEP_LINES = [
    "Maxxx the maaatch…",
    "Invest in your 401(k)… baaa…",
    "Compound innnterest… baaaa…",
    "Free moneeey… baaa…",
    "Up your contributiooon… baaa…",
    "Indexxx funds… baaaa…",
    "Don't leave it on the taaable…",
    "Roth or traditionaaal… baaa…"
  ];

  const REACTIONS = {
    no: [
      "Good?! You'll be 'good' right up until you're 80 and still working.",
      "'No thanks' to FREE MONEY? The match, man — the MATCH!",
      "That's exactly what I said in my twenties. Don't be twenties-me."
    ],
    what: [
      "Oh, buddy. Oh, sit down. Let me tell you about compound interest.",
      "A 401(k)?! Only the greatest wealth-building vehicle ever devised."
    ],
    stop: [
      "I'll stop when you're MAXING. THAT. MATCH.",
      "Stop? We're just getting to the Roth conversion ladder.",
      "Can't stop, won't stop — not while there's unclaimed employer match."
    ]
  };

  const CAPTIONS = {
    mob: "Word is spreading across the open-plan office…",
    sheepWarn: "…is everyone okay? Why are you all so fuzzy?",
    sheep: "🐑 Now entering: the part where you try to fall asleep."
  };

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ----- State --------------------------------------------------------------
  let phase = "guy";            // guy -> mob -> sheep
  let pressure = 1;             // 1..6 meter
  let mobCount = 0;
  let sheepCount = 0;
  let typingTimer = null;
  let lineTimer = null;
  let mobTimer = null;
  let sheepTimer = null;
  const personTickers = [];

  function setMeter() {
    meterFill.style.width = (pressure / 6) * 100 + "%";
  }
  function bump(d) {
    pressure = Math.max(1, Math.min(6, pressure + d));
    setMeter();
  }

  // ----- Main bubble typewriter --------------------------------------------
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
        typingTimer = setTimeout(step, 40 + Math.random() * 38);
      } else {
        caret.remove();
        if (onDone) onDone();
      }
    })();
  }

  // ----- Choices ------------------------------------------------------------
  const MENU = [
    { id: "no", label: "I'm good, thanks.", d: 1 },
    { id: "what", label: "What even is a 401(k)?", d: 1 },
    { id: "stop", label: "Guys. Please. Stop.", d: 2 }
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
  }

  function onChoice(choice) {
    bump(choice.d);
    speakerEl.textContent = phase === "mob" ? "The whole office" : "The 401(k) guy";
    typeLine(rand(REACTIONS[choice.id]));
    // Pushing back only feeds the frenzy.
    if (phase === "guy" && pressure >= 3) startMob();
    else if (phase === "mob" && mobCount < CROWD_MAX) {
      spawnPerson(); spawnPerson();
      if (mobCount >= CROWD_MAX) queueSheep();
    }
  }

  // ----- Phase 1: the guy ---------------------------------------------------
  function startGuyLoop() {
    lineTimer = setInterval(() => {
      if (phase === "sheep") return;
      speakerEl.textContent = phase === "mob" ? "The whole office" : "The 401(k) guy";
      typeLine(rand(PITCH));
    }, 4200);
  }

  // ----- Phase 2: the flash mob --------------------------------------------
  const CROWD_MAX = 9;
  const SLOTS = [
    { l: 8, t: 30 }, { l: 16, t: 64 }, { l: 6, t: 84 }, { l: 30, t: 22 },
    { l: 26, t: 78 }, { l: 44, t: 72 }, { l: 72, t: 24 }, { l: 86, t: 58 },
    { l: 90, t: 82 }, { l: 70, t: 84 }, { l: 14, t: 46 }, { l: 94, t: 36 }
  ];
  const FACES = ["🧑‍💼", "👩‍💼", "👨‍💼", "🧑", "👩", "👨", "🧓", "🧔", "👱‍♀️", "👨‍🦱", "👩‍🦰", "🧑‍🦲"];

  function startMob() {
    if (phase !== "guy") return;
    phase = "mob";
    hintEl.textContent = "Others have heard the word \"match.\" They are coming.";
    showCaption(CAPTIONS.mob, 2200);
    spawnPerson();
    mobTimer = setInterval(() => {
      spawnPerson();
      bump(1);
      if (mobCount >= CROWD_MAX) queueSheep();
    }, 2300);
  }

  function spawnPerson() {
    if (mobCount >= CROWD_MAX) return;
    const slot = SLOTS[mobCount % SLOTS.length];
    const person = document.createElement("div");
    person.className = "ko-person";
    person.style.left = slot.l + "%";
    person.style.top = slot.t + "%";

    const avatar = document.createElement("div");
    avatar.className = "ko-avatar";
    avatar.textContent = rand(FACES);
    avatar.style.animationDelay = (Math.random() * -2.6) + "s";

    const bubble = document.createElement("div");
    bubble.className = "ko-pbubble";
    bubble.textContent = rand(MOB_LINES);

    person.append(bubble, avatar);
    crowdEl.appendChild(person);
    mobCount++;

    // each coworker keeps chirping a new line every so often
    const ticker = setInterval(() => {
      if (phase === "sheep") return;
      bubble.textContent = rand(MOB_LINES);
    }, 2600 + Math.random() * 1800);
    personTickers.push(ticker);
  }

  // ----- Phase 3: everyone becomes sheep -----------------------------------
  let sheepQueued = false;
  function queueSheep() {
    if (sheepQueued) return;
    sheepQueued = true;
    clearInterval(mobTimer);
    setTimeout(startSheep, 4200); // let the mob peak for a beat
  }

  function startSheep() {
    if (phase === "sheep") return;
    phase = "sheep";
    clearInterval(lineTimer);
    personTickers.forEach(clearInterval);

    showCaption(CAPTIONS.sheepWarn, 1800);

    // poof the crowd away, fade the office into a dream
    [...crowdEl.children].forEach((p, i) => {
      setTimeout(() => p.classList.add("ko-leaving"), i * 90);
    });
    setTimeout(() => {
      crowdEl.innerHTML = "";
      sceneEl.classList.add("ko-faded");
      dreamEl.classList.add("show");
      fenceEl.classList.add("show");
      speakerEl.textContent = "The flock";
      typeLine("Counting us yet? …Invest in your 401(k)… baaa.");
      showCaption(CAPTIONS.sheep, 2400);

      // dialog choices no longer apply — offer a way out / restart
      choicesEl.innerHTML = "";
      const sleep = document.createElement("button");
      sleep.type = "button";
      sleep.className = "tn-choice";
      sleep.textContent = "😴 Keep counting";
      sleep.addEventListener("click", () => { spawnSheep(); spawnSheep(); });
      const restart = document.createElement("button");
      restart.type = "button";
      restart.className = "tn-choice tn-agree";
      restart.textContent = "↺ Wake up (start over)";
      restart.addEventListener("click", () => location.reload());
      choicesEl.append(sleep, restart);

      hintEl.textContent = "Sheep counted: 0";
      sheepTimer = setInterval(spawnSheep, 1500);
      spawnSheep();
    }, 1600);
  }

  function spawnSheep() {
    if (phase !== "sheep") return;
    const sheep = document.createElement("div");
    sheep.className = "ko-sheep";
    sheep.style.bottom = (54 + Math.random() * 26) + "px";

    const bubble = document.createElement("div");
    bubble.className = "ko-sbubble";
    bubble.textContent = rand(SHEEP_LINES);

    const face = document.createElement("div");
    face.className = "ko-sheepface";
    face.textContent = "🐑";
    face.style.animationDelay = (Math.random() * -0.5) + "s";

    sheep.append(bubble, face);
    crowdEl.appendChild(sheep);

    sheepCount++;
    hintEl.textContent = "Sheep counted: " + sheepCount;

    sheep.addEventListener("animationend", () => sheep.remove());
  }

  // ----- Transition caption -------------------------------------------------
  let captionTimer = null;
  function showCaption(text, ms) {
    clearTimeout(captionTimer);
    captionEl.textContent = text;
    captionEl.classList.add("show");
    captionTimer = setTimeout(() => captionEl.classList.remove("show"), ms);
  }

  // ----- Boot ---------------------------------------------------------------
  setMeter();
  renderMenu();
  speakerEl.textContent = "The 401(k) guy";
  setTimeout(() => {
    typeLine("Oh hey! Quick question — you aren't invested in your 401(k)?");
    startGuyLoop();
  }, 500);

  // If you just stand there politely, he escalates on his own.
  setTimeout(() => { if (phase === "guy") startMob(); }, 14000);
})();
