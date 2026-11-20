'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connectClient } = require('socket.io-client');
const { createServer } = require('../server/index');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withServer(fn, opts = {}) {
  const server = createServer({ RECONNECT_GRACE_MS: 300, ...opts });
  const port = await server.start(0);
  const url = `http://127.0.0.1:${port}`;
  const clients = [];
  const connect = (playerId) =>
    new Promise((resolve) => {
      const socket = connectClient(url, {
        auth: { playerId },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });
      const c = { socket, states: 0, joined: null, connected: false, error: null };
      socket.on('state', () => c.states++);
      socket.on('joined', (j) => (c.joined = j));
      socket.on('connect', () => (c.connected = true));
      socket.on('connect_error', (e) => {
        c.error = e.message;
        resolve(c);
      });
      socket.on('phase', () => {
        if (c.joined) resolve(c); // ya entró y recibió fase inicial
      });
      clients.push(c);
    });
  try {
    await fn({ server, connect, url });
  } finally {
    for (const c of clients) c.socket.close();
    await server.close();
  }
}

test('1º y 2º cliente reciben lados distintos', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    assert.equal(a.joined.side, 'left');
    assert.equal(b.joined.side, 'right');
  }));

test('el 3º cliente recibe duel_full, no conecta y nunca recibe state', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    const c = await connect('player-cccc');
    assert.equal(c.error, 'duel_full');
    assert.equal(c.connected, false);
    assert.equal(c.joined, null);
    await sleep(300); // el servidor emite state a 30 Hz
    assert.ok(a.states > 0 && b.states > 0, 'los jugadores sí reciben state');
    assert.equal(c.states, 0, 'el rechazado nunca recibe state');
  }));

test('un 3º tampoco entra mientras un jugador está en gracia de reconexión', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    await connect('player-bbbb');
    a.socket.close();
    await sleep(80);
    const c = await connect('player-cccc');
    assert.equal(c.error, 'duel_full');
  }));

test('reconexión con el mismo playerId recupera el lado; tras la gracia se libera', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    await connect('player-bbbb');
    a.socket.close();
    await sleep(80);
    const a2 = await connect('player-aaaa');
    assert.equal(a2.joined.side, 'left');

    // Ahora se va el derecho y no vuelve: tras la gracia entra otra persona
    const b2 = await connect('player-bbbb').catch(() => null);
    if (b2) b2.socket.close(); // (ya estaba conectado: toma su slot y lo cerramos)
    await sleep(500);
    const n = await connect('player-dddd');
    assert.equal(n.joined.side, 'right');
  }));

test('input inválido o de no-jugador se ignora en el servidor', () =>
  withServer(async ({ connect, server }) => {
    const a = await connect('player-aaaa');
    await connect('player-bbbb');
    a.socket.emit('input', { dir: 7 });
    a.socket.emit('input', 'basura');
    a.socket.emit('input', { dir: '1' });
    await sleep(100);
    assert.equal(server.duel.game.paddles.left.dir, 0);
    a.socket.emit('input', { dir: 1 });
    await sleep(100);
    assert.equal(server.duel.game.paddles.left.dir, 1);
  }));

test('flujo completo: ambos listos → cuenta regresiva → PLAYING', () =>
  withServer(async ({ connect, server }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    a.socket.emit('ready');
    b.socket.emit('ready');
    await sleep(100);
    assert.equal(server.duel.phase, 'COUNTDOWN');
    await sleep(server.cfg.COUNTDOWN_MS + 200);
    assert.equal(server.duel.phase, 'PLAYING');
  }));
