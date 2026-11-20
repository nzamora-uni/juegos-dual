'use strict';

// Lógica pura del juego: sin sockets, sin timers. Todo se mueve con dt (segundos).

function createGame(cfg) {
  const y0 = (cfg.HEIGHT - cfg.PADDLE_H) / 2;
  return {
    cfg,
    paddles: {
      left: { y: y0, dir: 0 },
      right: { y: y0, dir: 0 },
    },
    ball: { x: cfg.WIDTH / 2, y: cfg.HEIGHT / 2, vx: 0, vy: 0, speed: cfg.BALL_SPEED },
    score: { left: 0, right: 0 },
  };
}

// Pelota al centro y quieta (pausa entre puntos / antes del saque).
function placeBall(game) {
  const { cfg, ball } = game;
  ball.x = cfg.WIDTH / 2;
  ball.y = cfg.HEIGHT / 2;
  ball.vx = 0;
  ball.vy = 0;
  ball.speed = cfg.BALL_SPEED;
}

// Saque hacia `toward` ('left' | 'right' | null = aleatorio), ángulo acotado a ±SERVE_ANGLE.
function serve(game, toward, rng = Math.random) {
  const { cfg, ball } = game;
  const side = toward || (rng() < 0.5 ? 'left' : 'right');
  const dir = side === 'left' ? -1 : 1;
  const angle = (rng() * 2 - 1) * cfg.SERVE_ANGLE;
  placeBall(game);
  ball.vx = dir * ball.speed * Math.cos(angle);
  ball.vy = ball.speed * Math.sin(angle);
}

function resetPaddles(game) {
  const y0 = (game.cfg.HEIGHT - game.cfg.PADDLE_H) / 2;
  for (const p of Object.values(game.paddles)) p.y = y0;
}

function resetScore(game) {
  game.score.left = 0;
  game.score.right = 0;
}

function movePaddles(game, dt) {
  const { cfg } = game;
  for (const p of Object.values(game.paddles)) {
    p.y += p.dir * cfg.PADDLE_SPEED * dt;
    if (p.y < 0) p.y = 0;
    if (p.y > cfg.HEIGHT - cfg.PADDLE_H) p.y = cfg.HEIGHT - cfg.PADDLE_H;
  }
}

// Rebote en paleta: el ángulo depende del punto de impacto y la pelota acelera.
function bounceOffPaddle(game, side, yAt) {
  const { cfg, ball } = game;
  const p = game.paddles[side];
  const half = cfg.PADDLE_H / 2;
  let rel = (yAt - (p.y + half)) / half;
  rel = Math.max(-1, Math.min(1, rel));
  const angle = rel * cfg.MAX_BOUNCE_ANGLE;
  ball.speed = Math.min(ball.speed * cfg.BALL_SPEEDUP, cfg.BALL_MAX_SPEED);
  const dir = side === 'left' ? 1 : -1; // sale hacia el centro
  ball.vx = dir * ball.speed * Math.cos(angle);
  ball.vy = ball.speed * Math.sin(angle);
  ball.y = yAt;
}

// Avanza la pelota. Devuelve 'left' | 'right' (quien anotó) o null.
// La colisión con paletas es "swept": se intersecta el segmento recorrido con la cara
// de la paleta, así no hay tunneling a velocidades altas.
function moveBall(game, dt) {
  const { cfg, ball } = game;
  const r = cfg.BALL_RADIUS;
  if (ball.vx === 0 && ball.vy === 0) return null;

  const prevX = ball.x;
  const prevY = ball.y;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Techo y piso
  if (ball.y - r < 0) {
    ball.y = r;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y + r > cfg.HEIGHT) {
    ball.y = cfg.HEIGHT - r;
    ball.vy = -Math.abs(ball.vy);
  }

  // Paleta izquierda (cara derecha de la paleta)
  if (ball.vx < 0) {
    const face = cfg.PADDLE_MARGIN + cfg.PADDLE_W;
    if (prevX - r >= face && ball.x - r <= face) {
      const t = (prevX - r - face) / (prevX - ball.x);
      const yAt = prevY + (ball.y - prevY) * t;
      const p = game.paddles.left;
      if (yAt + r >= p.y && yAt - r <= p.y + cfg.PADDLE_H) {
        ball.x = face + r;
        bounceOffPaddle(game, 'left', yAt);
      }
    }
  }

  // Paleta derecha (cara izquierda de la paleta)
  if (ball.vx > 0) {
    const face = cfg.WIDTH - cfg.PADDLE_MARGIN - cfg.PADDLE_W;
    if (prevX + r <= face && ball.x + r >= face) {
      const t = (face - (prevX + r)) / (ball.x - prevX);
      const yAt = prevY + (ball.y - prevY) * t;
      const p = game.paddles.right;
      if (yAt + r >= p.y && yAt - r <= p.y + cfg.PADDLE_H) {
        ball.x = face - r;
        bounceOffPaddle(game, 'right', yAt);
      }
    }
  }

  // Punto: sale por la izquierda → anota el derecho, y viceversa.
  if (ball.x + r < 0) return 'right';
  if (ball.x - r > cfg.WIDTH) return 'left';
  return null;
}

function step(game, dt, { moveBallToo = true } = {}) {
  movePaddles(game, dt);
  return moveBallToo ? moveBall(game, dt) : null;
}

module.exports = { createGame, placeBall, serve, resetPaddles, resetScore, movePaddles, moveBall, step };
