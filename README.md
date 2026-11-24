# dailyquestion

The city at night, from close to. Every so often a light comes on in a window —
click it before it goes out and there is a fun fact inside, to read or copy.
The hoarding on the roof is The Daily Mini, a five-by-five crossword that is
new every day and keeps your streak; the sign down the front of a tower is the
arcade, where the other games are.

Plain static files, served from the repo root (GitHub Pages).

| File | What it is |
| --- | --- |
| `index.html`, `home.css` | The home page and what is laid over the city: the date, the two signs, the fact card, the arcade |
| `city.js` | Puts it all together: the frame loop, the lights going on and off, the card and the arcade |
| `skyline.js` | The towers, the skyline behind them and the sky: how they are laid out and drawn |
| `app.js`, `deck.js`, `data.js` | Today's facts, dealt by date |
| `crossword.html`, `crossword.css`, `crossword.js` | The Daily Mini: the grid, the clues, the clock, check and reveal, the week's puzzles, and the streak |
| `crossword-data.js` | Its puzzles: 372 grids and a clue or two for every answer in them |
| `boat.js`, `boat.css` | Adrift, the leaking-rowboat game, laid over the home page |
| `sun.*`, `orbit.*`, `park.*`, `cave.*` | The other games, each a page of its own |

## The crossword's streak

A day counts toward the streak when that day's puzzle is solved on that day
with nothing revealed (checking is free). Miss a day and the run ends, but it
isn't forgotten: the record card keeps the longest streak and the length and
end date of the last one. It is all in `localStorage`, under `daily.cross.v1`.
