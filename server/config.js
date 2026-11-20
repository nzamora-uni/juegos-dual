'use strict';

// Constantes del juego. Las unidades de movimiento son px/segundo (se usa dt).
// Se leen del entorno en cada llamada para poder sobreescribirlas en pruebas.
function getConfig() {
  const num = (name, def) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : def;
  };
  return {
    PORT: num('PORT', 3000),

    // Canvas lógico (igual que ping-pong-individual)
    WIDTH: 800,
    HEIGHT: 450,

    PADDLE_W: 15,
    PADDLE_H: 100,
    PADDLE_MARGIN: 30,
    PADDLE_SPEED: 360, // 6 px/tick a 60 ticks/s

    BALL_RADIUS: 10,
    BALL_SPEED: 300, // 5 px/tick a 60 ticks/s
    BALL_MAX_SPEED: 900,
    BALL_SPEEDUP: 1.04, // +4 % por golpe
    SERVE_ANGLE: Math.PI / 6, // ±30°
    MAX_BOUNCE_ANGLE: Math.PI / 3, // ~60°

    WIN_SCORE: num('WIN_SCORE', 7),

    TICK_RATE: 60,
    STATE_RATE: 30,

    COUNTDOWN_MS: 3000,
    POINT_PAUSE_MS: 1500,
    RECONNECT_GRACE_MS: num('RECONNECT_GRACE_MS', 10000),
    IDLE_KICK_MS: 60000, // sin pulsar "Listo" en READY
    INPUT_MAX_PER_SEC: 120,

    ALLOW_SAME_BROWSER: process.env.ALLOW_SAME_BROWSER === '1',
  };
}

module.exports = { getConfig };
