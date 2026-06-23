// tunnel.js — the looping dialog for the hidden "Tunnel" page.
// A brown-haired guy in front of a drain tunnel who will, under no
// circumstances, let the subject of the tunnel (or the 60-mile walk to his
// farm) go. He never actually goes anywhere — he just keeps pitching.

(function () {
  "use strict";

  const lineEl = document.getElementById("tnLine");
  const speakerEl = document.getElementById("tnSpeaker");
  const bubbleEl = document.getElementById("tnBubble");
  const choicesEl = document.getElementById("tnChoices");
  const hintEl = document.getElementById("tnHint");
  const guyEl = document.getElementById("tnGuy");
  const meterFill = document.getElementById("tnMeterFill");

  // ----- Line pools ---------------------------------------------------------
  const OPENERS = [
    "Oh — perfect timing. Let's go in the tunnel.",
    "Hey! You're here. Great. So. The tunnel. Let's go in.",
    "There you are. I've been standing by this tunnel for ages. Let's go in."
  ];

  const TUNNEL_PITCH = [
    "Let's go in the tunnel.",
    "Come on, don't wuss out — let's go in.",
    "Imagine how cool this tunnel is.",
    "Picture it: us, the tunnel, an adventure of a lifetime.",
    "It's right there. The tunnel. Practically calling our names.",
    "I've got a really good feeling about this tunnel.",
    "We go in, we have the time of our lives, we come out. Simple.",
    "You and me. This tunnel. History in the making.",
    "Don't overthink it. Tunnel. Now. Let's go.",
    "I heard the acoustics in there are unbelievable. Let's go in.",
    "Every great story starts with a tunnel. Probably. Let's find out."
  ];

  const FARM_PITCH = [
    "Or… we could walk 60 miles to my farm.",
    "Alternatively — quick 60-mile walk, my farm, you'll love it.",
    "The farm's only 60 miles. We'd basically be there if we'd left already.",
    "60 miles to the farm. Honestly the fresh air alone is worth it.",
    "We could be at my farm by sundown. Sundown in, like, three days.",
    "My farm has goats. So: 60 miles of walking, and then — goats.",
    "Tunnel, or 60 miles to the farm. Either way, we go together.",
    "Honestly the 60-mile walk is half the fun. Then: the farm.",
    "You haven't lived 'til you've walked 60 miles to a farm. My farm.",
    "We'll chat the whole 60 miles. Then the farm. Then probably back to this tunnel."
  ];

  // Reactions keyed to each player choice. One is picked at random, then a
  // fresh pitch line is tacked on a beat later.
  const REACTIONS = {
    refuse: [
      "\"No\" isn't a destination, though. The tunnel is.",
      "You say no, but your eyes are saying \"tunnel.\"",
      "No? Bold. Respect. Anyway —",
      "Noted. Overruled, but noted.",
      "See, \"no\" is just \"go\" with a little typo."
    ],
    why: [
      "Why NOT the tunnel? Boom. Checkmate.",
      "Because it's there. Because we're here. Because: tunnel.",
      "I can't fully explain it. It's a tunnel thing. You'd get it inside.",
      "The tunnel doesn't need a reason. The tunnel IS the reason."
    ],
    howFar: [
      "60 miles. Maybe 61. We round down out of optimism.",
      "60 miles as the crow flies. We are not crows, so… 70-ish?",
      "60 miles. That's, what, a couple of podcasts? Easy.",
      "Far enough to really bond. Close enough to start right now. 60 miles."
    ],
    whatsInside: [
      "Mystery. Wonder. Possibly an abandoned shopping cart. Let's find out.",
      "If I told you, it wouldn't be a tunnel anymore. It'd be a spoiler.",
      "Stuff. Cool stuff. Tunnel stuff. Come on, come on.",
      "I genuinely don't know! That's the beautiful part! Let's GO."
    ],
    hardNo: [
      "Okay, okay. The farm then? 60 miles. We leave at dawn.",
      "Fine. Tunnel's off the table. … Unless?",
      "Understood completely. Counter-offer: the tunnel.",
      "Respect the boundary. Rephrasing: how do you feel about a 60-mile walk?"
    ]
  };

  // The "fine, let's go" gag — he sends you in and never follows.
  const GO_SEQUENCE = [
    "Wait — really? Yes! Okay. After you.",
    "Go on. I'm right behind you.",
    "You first. I insist. I'll be two steps back.",
    "…You go ahead. I just need to, uh, tie my shoe.",
    "Actually — you know what? Let's do the farm first."
  ];

  // ----- State --------------------------------------------------------------
  let persistence = 1;          // 1..6, fills the meter
  let goStage = 0;              // progress through GO_SEQUENCE
  let typingTimer = null;
  let pendingTimer = null;

  function bumpPersistence(delta) {
    persistence = Math.max(1, Math.min(6, persistence + delta));
    meterFill.style.width = (persistence / 6) * 100 + "%";
  }

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // The guy mostly pitches the tunnel; the more he's pushed, the more he
  // starts floating the farm as a "compromise."
  function nextPitch() {
    const farmBias = 0.25 + persistence * 0.06;
    return Math.random() < farmBias ? rand(FARM_PITCH) : rand(TUNNEL_PITCH);
  }

  // ----- Typewriter ---------------------------------------------------------
  function typeLine(text, onDone) {
    clearTimeout(typingTimer);
    lineEl.textContent = "";
    bubbleEl.classList.add("show");
    guyEl.classList.remove("tn-talk");
    void guyEl.offsetWidth; // restart the talk nudge
    guyEl.classList.add("tn-talk");

    const caret = document.createElement("span");
    caret.className = "tn-caret";
    caret.innerHTML = "&nbsp;";
    lineEl.appendChild(caret);

    let i = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      caret.remove();
      lineEl.textContent = text;
      if (onDone) onDone();
      return;
    }
    (function step() {
      if (i < text.length) {
        caret.insertAdjacentText("beforebegin", text.charAt(i));
        i++;
        typingTimer = setTimeout(step, 42 + Math.random() * 40);
      } else {
        caret.remove();
        if (onDone) onDone();
      }
    })();
  }

  function lockChoices(locked) {
    choicesEl.classList.toggle("tn-locked", locked);
  }

  // ----- Choice menu --------------------------------------------------------
  const MENU = [
    { id: "refuse", label: "Nope.", d: -0 },
    { id: "why", label: "Why the tunnel?", d: 1 },
    { id: "howFar", label: "How far's the farm again?", d: 1 },
    { id: "whatsInside", label: "What's actually in there?", d: 1 },
    { id: "hardNo", label: "I am NOT going in there.", d: 1 },
    { id: "go", label: "Ugh, fine. Let's go.", agree: true }
  ];

  function renderMenu() {
    choicesEl.innerHTML = "";
    MENU.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tn-choice" + (c.agree ? " tn-agree" : "");
      btn.textContent = c.label;
      btn.addEventListener("click", () => onChoice(c));
      choicesEl.appendChild(btn);
    });
    lockChoices(false);
  }

  function onChoice(choice) {
    clearTimeout(pendingTimer);
    lockChoices(true);
    speakerEl.textContent = "The guy";

    if (choice.agree) {
      runGoGag();
      return;
    }

    bumpPersistence(choice.d || 0);
    const reaction = rand(REACTIONS[choice.id]);
    typeLine(reaction, () => {
      // beat, then he pitches again
      pendingTimer = setTimeout(() => {
        typeLine(nextPitch(), () => lockChoices(false));
      }, 850);
    });
  }

  // The black-out gag: you "go in," he doesn't, and you're back where you
  // started — slightly more committed than before.
  function runGoGag() {
    bumpPersistence(1);
    const blackout = document.createElement("div");
    blackout.className = "tn-blackout";
    const p = document.createElement("p");
    blackout.appendChild(p);
    document.body.appendChild(blackout);

    const steps = GO_SEQUENCE.slice();
    let idx = 0;

    function show(text, after) {
      p.textContent = text;
      setTimeout(after, 1600);
    }

    // fade to black, walk through his "after you" routine, then fade back.
    requestAnimationFrame(() => blackout.classList.add("show"));
    setTimeout(function loop() {
      if (idx < steps.length - 1) {
        show(steps[idx], () => { idx++; loop(); });
      } else {
        // last line, then return to the scene
        show(steps[idx], () => {
          blackout.classList.remove("show");
          setTimeout(() => {
            blackout.remove();
            typeLine(GO_SEQUENCE[GO_SEQUENCE.length - 1], () => {
              pendingTimer = setTimeout(() => {
                typeLine(nextPitch(), () => lockChoices(false));
              }, 850);
            });
          }, 800);
        });
      }
    }, 900);

    hintEl.textContent = "…you went in. He did not. Funny how that works.";
  }

  // ----- Boot ---------------------------------------------------------------
  speakerEl.textContent = "???";
  bumpPersistence(0);
  renderMenu();
  lockChoices(true);

  setTimeout(() => {
    speakerEl.textContent = "The guy";
    typeLine(rand(OPENERS), () => lockChoices(false));
  }, 500);
})();
