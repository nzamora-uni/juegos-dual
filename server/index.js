'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { getConfig } = require('./config');
const { Duel } = require('./duel');

const ROOM = 'duel';
const PLAYER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function createServer(opts = {}) {
  const cfg = { ...getConfig(), ...opts };
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  const duel = new Duel(cfg, (event, payload, side) => {
    if (event === 'kick') {
      const s = io.sockets.sockets.get(payload.socketId);
      if (s) {
        s.emit('kicked', { reason: payload.reason });
        s.disconnect(true);
      }
      return;
    }
    if (side) {
      const slot = duel.slots[side];
      if (slot && slot.connected) io.to(slot.socketId).emit(event, payload);
    } else {
      io.to(ROOM).emit(event, payload);
    }
  });

  // El cupo se controla SOLO aquí: el 3er cliente es rechazado antes de entrar al duelo,
  // así que nunca llega a la sala ni recibe `state`.
  io.use((socket, next) => {
    const raw = socket.handshake.auth && socket.handshake.auth.playerId;
    const playerId = typeof raw === 'string' && PLAYER_ID_RE.test(raw) ? raw : crypto.randomUUID();
    if (!duel.canJoin(playerId)) {
      const err = new Error('duel_full');
      err.data = { message: 'Duelo lleno' };
      return next(err);
    }
    socket.data.playerId = playerId;
    next();
  });

  io.on('connection', (socket) => {
    const res = duel.join(socket.data.playerId, socket.id);
    if (!res.ok) {
      socket.emit('duel_full', { message: 'Duelo lleno' });
      socket.disconnect(true);
      return;
    }
    if (res.replacedSocketId) {
      const old = io.sockets.sockets.get(res.replacedSocketId);
      if (old) old.disconnect(true);
    }
    socket.join(ROOM);
    socket.emit('joined', { side: res.side, playerId: socket.data.playerId });
    socket.emit('phase', duel.phasePayload());

    // Límite de frecuencia de input (por socket)
    let windowStart = Date.now();
    let count = 0;
    socket.on('input', (msg) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > cfg.INPUT_MAX_PER_SEC) return;
      const side = duel.sideOf(socket.id);
      if (!side || !msg || typeof msg !== 'object') return;
      duel.input(side, msg.dir); // valida dir ∈ {-1,0,1}
    });
    socket.on('ready', () => {
      const side = duel.sideOf(socket.id);
      if (side) duel.ready(side);
    });
    socket.on('rematch', () => {
      const side = duel.sideOf(socket.id);
      if (side) duel.rematch(side);
    });
    socket.on('latency', (ack) => {
      if (typeof ack === 'function') ack();
    });
    socket.on('disconnect', () => duel.leave(socket.id));
  });

  // Bucle del servidor: simulación a TICK_RATE con dt real (sin deriva), `state` a STATE_RATE.
  let timer = null;
  function startLoop() {
    let last = process.hrtime.bigint();
    let stateAcc = 0;
    timer = setInterval(() => {
      const now = process.hrtime.bigint();
      let dt = Number(now - last) / 1e6;
      last = now;
      if (dt > 100) dt = 100;
      duel.tick(dt);
      stateAcc += dt;
      if (stateAcc >= 1000 / cfg.STATE_RATE) {
        stateAcc %= 1000 / cfg.STATE_RATE;
        const room = io.sockets.adapter.rooms.get(ROOM);
        if (room && room.size) io.to(ROOM).emit('state', duel.snapshot());
      }
    }, 1000 / cfg.TICK_RATE);
  }

  return {
    app,
    httpServer,
    io,
    duel,
    cfg,
    start(port = cfg.PORT) {
      return new Promise((resolve) => {
        httpServer.listen(port, () => {
          startLoop();
          resolve(httpServer.address().port);
        });
      });
    },
    close() {
      clearInterval(timer);
      io.disconnectSockets(true);
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}

if (require.main === module) {
  const server = createServer();
  server.start().then((port) => {
    console.log(`Pong Dual escuchando en http://localhost:${port}`);
  });
}

module.exports = { createServer };
