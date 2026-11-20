'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Duel } = require('../server/duel');

function setup(opts = {}) {
  const events = [];
  const duel = new Duel({ RECONNECT_GRACE_MS: 1000, WIN_SCORE: 3, ...opts }, (e, p, side) => events.push({ e, p, side }));
  const names = () => events.map((x) => x.e);
  return { duel, events, names };
}

function startPlaying(duel) {
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.ready('left');
  duel.ready('right');
  duel.tick(duel.cfg.COUNTDOWN_MS);
  assert.equal(duel.phase, 'PLAYING');
}

test('1er y 2º jugador reciben lados distintos; el 3º es rechazado', () => {
  const { duel } = setup();
  const a = duel.join('player-aaaa', 's1');
  const b = duel.join('player-bbbb', 's2');
  assert.deepEqual([a.side, b.side], ['left', 'right']);
  assert.equal(duel.canJoin('player-cccc'), false);
  const c = duel.join('player-cccc', 's3');
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'duel_full');
});

test('fases: WAITING → READY → COUNTDOWN → PLAYING', () => {
  const { duel } = setup();
  assert.equal(duel.phase, 'WAITING');
  duel.join('player-aaaa', 's1');
  assert.equal(duel.phase, 'WAITING');
  duel.join('player-bbbb', 's2');
  assert.equal(duel.phase, 'READY');
  duel.ready('left');
  assert.equal(duel.phase, 'READY');
  duel.ready('right');
  assert.equal(duel.phase, 'COUNTDOWN');
  duel.tick(duel.cfg.COUNTDOWN_MS - 1);
  assert.equal(duel.phase, 'COUNTDOWN');
  duel.tick(2);
  assert.equal(duel.phase, 'PLAYING');
});

test('input inválido o de un no-jugador se ignora', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  assert.equal(duel.input('left', 2), false);
  assert.equal(duel.input('left', '1'), false);
  assert.equal(duel.input('left', 0.5), false);
  assert.equal(duel.input('right', 1), false); // slot vacío
  assert.equal(duel.input(null, 1), false);
  assert.equal(duel.game.paddles.left.dir, 0);
  assert.equal(duel.input('left', -1), true);
  assert.equal(duel.game.paddles.left.dir, -1);
});

test('desconexión: el slot se reserva durante la gracia y nadie se cuela', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.leave('s1');
  duel.tick(500);
  assert.equal(duel.canJoin('player-cccc'), false);
  assert.equal(duel.join('player-cccc', 's3').ok, false);
});

test('reconectar con el mismo playerId recupera el mismo lado', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.leave('s2');
  duel.tick(300);
  const r = duel.join('player-bbbb', 's9');
  assert.equal(r.ok, true);
  assert.equal(r.side, 'right');
  assert.equal(r.reconnected, true);
  assert.equal(duel.sideOf('s9'), 'right');
});

test('pasada la gracia el slot se libera y entra otra persona', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.leave('s2');
  duel.tick(1001);
  assert.equal(duel.phase, 'WAITING');
  const n = duel.join('player-cccc', 's3');
  assert.equal(n.ok, true);
  assert.equal(n.side, 'right');
});

test('mismo playerId conectado dos veces toma el slot, no ocupa los dos', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  const dup = duel.join('player-aaaa', 's2');
  assert.equal(dup.side, 'left');
  assert.equal(dup.replacedSocketId, 's1');
  assert.equal(duel.slots.right, null);
});

test('abandono en PLAYING: pausa durante la gracia y luego gana el rival', () => {
  const { duel, events } = setup();
  startPlaying(duel);
  duel.tick(100);
  duel.leave('s1');
  const before = { ...duel.game.ball };
  duel.tick(500);
  assert.deepEqual({ ...duel.game.ball }, before, 'la partida está en pausa');
  duel.tick(600);
  const over = events.find((x) => x.e === 'game_over');
  assert.ok(over);
  assert.equal(over.p.winner, 'right');
  assert.equal(over.p.reason, 'abandon');
  assert.equal(duel.phase, 'WAITING');
});

function scoreFor(duel, side) {
  // Pelota fuera del campo por el lado correspondiente, en un tick anota
  const b = duel.game.ball;
  b.y = 100;
  b.vy = 0;
  if (side === 'left') { b.x = duel.cfg.WIDTH + 30; b.vx = 100; } else { b.x = -30; b.vx = -100; }
  duel.tick(16);
}

test('llegar a WIN_SCORE emite game_over; la revancha reinicia el marcador', () => {
  const { duel, events } = setup();
  startPlaying(duel);

  scoreFor(duel, 'left');
  assert.equal(duel.phase, 'POINT_PAUSE');
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  assert.equal(duel.phase, 'PLAYING');
  scoreFor(duel, 'left');
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  scoreFor(duel, 'left');

  assert.equal(duel.phase, 'GAME_OVER');
  const over = events.filter((x) => x.e === 'game_over').pop();
  assert.equal(over.p.winner, 'left');
  assert.deepEqual(over.p.score, { left: 3, right: 0 });

  duel.rematch('left');
  assert.equal(duel.phase, 'GAME_OVER', 'requiere ambos');
  duel.rematch('right');
  assert.equal(duel.phase, 'COUNTDOWN');
  assert.deepEqual({ ...duel.game.score }, { left: 0, right: 0 });
});

test('tras un punto el saque va hacia quien lo anotó', () => {
  const { duel } = setup();
  startPlaying(duel);
  scoreFor(duel, 'right');
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  assert.ok(duel.game.ball.vx > 0, 'saca hacia el jugador derecho (anotó)');
});

test('expulsión por inactividad en READY libera el slot', () => {
  const { duel, events } = setup({ IDLE_KICK_MS: 2000 });
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.ready('left');
  duel.tick(2100);
  const kick = events.find((x) => x.e === 'kick');
  assert.ok(kick);
  assert.equal(kick.p.socketId, 's2');
  assert.equal(duel.slots.right, null);
  assert.equal(duel.phase, 'WAITING');
});
