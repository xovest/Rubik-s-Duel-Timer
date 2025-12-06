// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from /public
app.use(express.static('public'));

const PORT = 3000;

// Simple state for up to 2 players
let players = {}; // { socketId: { id, ready, running, finished, elapsedMs, startTime } }
let raceArmed = false; // true once both players have been READY at the same time

function computeAllReadyNow() {
  const ids = Object.keys(players);
  if (ids.length !== 2) return false;
  return ids.every(
    (id) =>
      players[id].ready &&
      !players[id].running &&
      !players[id].finished
  );
}

function maybeUpdateRaceArmed() {
  // Arm race if both players are currently ready
  if (!raceArmed && computeAllReadyNow()) {
    raceArmed = true;
  }

  // If fewer than 2 players, disarm
  if (Object.keys(players).length < 2) {
    raceArmed = false;
  }
}

function broadcastState() {
  io.emit('state', {
    players,
    raceArmed,
  });
}

// Periodic tick to update running timers so opponents see them live
setInterval(() => {
  let changed = false;
  const now = Date.now();

  for (const id of Object.keys(players)) {
    const p = players[id];
    if (p.running && p.startTime != null) {
      const newElapsed = now - p.startTime;
      if (p.elapsedMs !== newElapsed) {
        p.elapsedMs = newElapsed;
        changed = true;
      }
    }
  }

  if (changed) {
    broadcastState();
  }
}, 50); // ~20 FPS is enough for a timer display

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Register new player
  players[socket.id] = {
    id: socket.id,
    ready: false,
    running: false,
    finished: false,
    elapsedMs: null,
    startTime: null,
  };
  broadcastState();

  socket.on('setReady', (isReady) => {
    const p = players[socket.id];
    if (!p) return;

    // Can only change ready if not running/finished
    if (!p.running && !p.finished) {
      p.ready = !!isReady;
      maybeUpdateRaceArmed();
      broadcastState();
    }
  });

  socket.on('start', () => {
    const p = players[socket.id];
    if (!p) return;
    if (!p.ready) return;

    // Only allow start if race has been armed:
    // i.e., both players were ready at the same time at least once.
    if (!raceArmed) return;

    p.running = true;
    p.ready = false;
    p.finished = false;
    p.startTime = Date.now();
    p.elapsedMs = 0;
    broadcastState();
  });

  socket.on('stop', () => {
    const p = players[socket.id];
    if (!p) return;
    if (!p.running) return;

    const now = Date.now();
    p.elapsedMs = p.startTime != null ? now - p.startTime : p.elapsedMs;
    p.running = false;
    p.finished = true;
    p.startTime = null;
    broadcastState();
  });

  socket.on('reset', () => {
    const p = players[socket.id];
    if (!p) return;

    p.ready = false;
    p.running = false;
    p.finished = false;
    p.elapsedMs = null;
    p.startTime = null;

    // If all players are idle, disarm race
    const ids = Object.keys(players);
    const allIdle =
      ids.length >= 1 &&
      ids.every((id) => {
        const pl = players[id];
        return !pl.ready && !pl.running && !pl.finished;
      });

    if (allIdle) {
      raceArmed = false;
    }

    broadcastState();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete players[socket.id];

    if (Object.keys(players).length < 2) {
      raceArmed = false;
    }

    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Rubik duel timer running on http://localhost:${PORT}`);
});
