// movies.js — the watchlist behind the 🎬 button in the corner controls.
//
// To add a film, put it in the list below. The whole list lives here; nothing
// else in the app needs touching. A plain title on its own is fine:
//
//   "Stalker",
//
// and so is the longer form, where `year` and `note` are both optional:
//
//   { title: "Stalker", year: 1979 },
//   { title: "Stalker", year: 1979, note: "Bring a thermos." },
//
// Mixing the two is fine too. They're listed in the order they appear here, so
// new ones go at the bottom unless you want them further up. A trailing comma
// on the last line is allowed — one less thing to get wrong at midnight.

window.Movies = [
  { title: "Brazil", year: 1985 },
];
