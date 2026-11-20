'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../server/config');
const G = require('../server/game');

const cfg = getConfig();
const newGame = () => G.createGame(cfg);

test('la pelota rebota en el techo', () => {
  const g = newGame();
  Object.assign(g.ball, { x: 400, y: cfg.BALL_RADIUS + 1, vx: 100, vy: -300 });
  G.moveBall(g, 0.05);
  assert.ok(g.ball.vy > 0, 'vy debe invertirse');
  assert.ok(g.ball.y >= cfg.BALL_RADIUS);
});

test('la pelota rebota en el piso', () => {
  const g = newGame();
  Object.assign(g.ball, { x: 400, y: cfg.HEIGHT - cfg.BALL_RADIUS - 1, vx: 100, vy: 300 });
  G.moveBall(g, 0.05);
  assert.ok(g.ball.vy < 0);
  assert.ok(g.ball.y <= cfg.HEIGHT - cfg.BALL_RADIUS);
});

function hitLeftPaddleAt(yOffsetFromCenter) {
  const g = newGame();
  const face = cfg.PADDLE_MARGIN + cfg.PADDLE_W;
  const center = g.paddles.left.y + cfg.PADDLE_H / 2;
  Object.assign(g.ball, {
    x: face + cfg.BALL_RADIUS + 2,
    y: center + yOffsetFromCenter,
    vx: -cfg.BALL_SPEED,
    vy: 0,
    speed: cfg.BALL_SPEED,
  });
  G.moveBall(g, 0.05);
  return g;
}

test('golpe en el centro de la paleta → sale recto', () => {
  const g = hitLeftPaddleAt(0);
  assert.ok(g.ball.vx > 0, 'sale hacia el centro');
  assert.ok(Math.abs(g.ball.vy) < 1e-6);
});

test('golpe en el borde → ángulo mayor que en el centro, hasta ~60°', () => {
  const edge = hitLeftPaddleAt(cfg.PADDLE_H / 2);
  const mid = hitLeftPaddleAt(cfg.PADDLE_H / 4);
  const angle = (g) => Math.abs(Math.atan2(g.ball.vy, g.ball.vx));
  assert.ok(angle(edge) > angle(mid));
  assert.ok(angle(edge) <= cfg.MAX_BOUNCE_ANGLE + 1e-9);
});

test('cada golpe acelera la pelota (+4 %) con tope', () => {
  const g = hitLeftPaddleAt(0);
  assert.ok(Math.abs(g.ball.speed - cfg.BALL_SPEED * cfg.BALL_SPEEDUP) < 1e-9);
  const fast = newGame();
  const face = cfg.PADDLE_MARGIN + cfg.PADDLE_W;
  Object.assign(fast.ball, { x: face + 12, y: fast.paddles.left.y + 50, vx: -cfg.BALL_MAX_SPEED, vy: 0, speed: cfg.BALL_MAX_SPEED });
  G.moveBall(fast, 0.05);
  assert.equal(fast.ball.speed, cfg.BALL_MAX_SPEED);
});

test('no hay tunneling a velocidad máxima (dt grande)', () => {
  const g = newGame();
  const face = cfg.PADDLE_MARGIN + cfg.PADDLE_W;
  Object.assign(g.ball, {
    x: face + 100,
    y: g.paddles.left.y + 50,
    vx: -cfg.BALL_MAX_SPEED,
    vy: 0,
    speed: cfg.BALL_MAX_SPEED,
  });
  // 0.1 s a 900 px/s = 90 px: atraviesa la paleta de 15 px de un solo paso
  const scorer = G.moveBall(g, 0.1);
  assert.equal(scorer, null);
  assert.ok(g.ball.vx > 0, 'debe rebotar y no atravesar');
});

test('si la paleta no está, la pelota pasa y anota el rival', () => {
  const g = newGame();
  g.paddles.left.y = 0; // paleta arriba
  Object.assign(g.ball, { x: 100, y: cfg.HEIGHT - 20, vx: -400, vy: 0, speed: 400 });
  let scorer = null;
  for (let i = 0; i < 120 && !scorer; i++) scorer = G.moveBall(g, 1 / 60);
  assert.equal(scorer, 'right'); // sale por la izquierda → anota el derecho
});

test('sale por la derecha → anota el izquierdo', () => {
  const g = newGame();
  g.paddles.right.y = 0;
  Object.assign(g.ball, { x: 700, y: cfg.HEIGHT - 20, vx: 400, vy: 0, speed: 400 });
  let scorer = null;
  for (let i = 0; i < 120 && !scorer; i++) scorer = G.moveBall(g, 1 / 60);
  assert.equal(scorer, 'left');
});

test('la paleta no sale del canvas', () => {
  const g = newGame();
  g.paddles.left.dir = -1;
  g.paddles.right.dir = 1;
  for (let i = 0; i < 300; i++) G.movePaddles(g, 1 / 60);
  assert.equal(g.paddles.left.y, 0);
  assert.equal(g.paddles.right.y, cfg.HEIGHT - cfg.PADDLE_H);
});

test('el saque respeta ±30° y la dirección pedida', () => {
  const g = newGame();
  for (let i = 0; i < 200; i++) {
    G.serve(g, i % 2 ? 'left' : 'right');
    const ang = Math.abs(Math.atan2(g.ball.vy, Math.abs(g.ball.vx)));
    assert.ok(ang <= cfg.SERVE_ANGLE + 1e-9);
    assert.equal(Math.sign(g.ball.vx), i % 2 ? -1 : 1);
  }
});
