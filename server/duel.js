'use strict';

const { getConfig } = require('./config');
const G = require('./game');

const SIDES = ['left', 'right'];
const opposite = (s) => (s === 'left' ? 'right' : 'left');
const IN_PROGRESS = new Set(['COUNTDOWN', 'PLAYING', 'POINT_PAUSE']);

/**
 * Estado del duelo: dos slots (left/right), fases y reglas de entrada.
 * No conoce sockets: recibe ids de socket/jugador y avisa por `emit(event, payload, side?)`.
 * Todo el tiempo avanza con tick(dtMs) (sin setTimeout) para que sea determinista y testeable.
 */
class Duel {
  constructor(opts = {}, emit = () => {}) {
    this.cfg = { ...getConfig(), ...opts };
    this.emit = emit;
    this.rng = opts.rng || Math.random;
    this.game = G.createGame(this.cfg);
    this.slots = { left: null, right: null };
    this.phase = 'WAITING';
    this.phaseMs = 0;
    this.serveTo = null;
    this.winner = null;
  }

  // ---------- Entrada ----------

  _findByPlayer(playerId) {
    if (this.cfg.ALLOW_SAME_BROWSER) return null; // solo desarrollo: cada conexión cuenta como jugador nuevo
    return SIDES.find((s) => this.slots[s] && this.slots[s].playerId === playerId) || null;
  }

  canJoin(playerId) {
    return !!this._findByPlayer(playerId) || SIDES.some((s) => !this.slots[s]);
  }

  join(playerId, socketId) {
    const existing = this._findByPlayer(playerId);
    if (existing) {
      const slot = this.slots[existing];
      const replacedSocketId = slot.connected && slot.socketId !== socketId ? slot.socketId : null;
      slot.socketId = socketId;
      slot.connected = true;
      slot.graceLeft = 0;
      this.emit('opponent_back', {}, opposite(existing));
      this._maybeStart();
      return { ok: true, side: existing, reconnected: true, replacedSocketId };
    }

    const side = SIDES.find((s) => !this.slots[s]);
    if (!side) return { ok: false, reason: 'duel_full' };

    this.slots[side] = {
      playerId,
      socketId,
      connected: true,
      ready: false,
      rematch: false,
      graceLeft: 0,
      idleMs: 0,
    };
    if (SIDES.every((s) => this.slots[s]) && this.phase === 'WAITING') this._setPhase('READY');
    else this.emit('phase', this.phasePayload());
    return { ok: true, side, reconnected: false, replacedSocketId: null };
  }

  sideOf(socketId) {
    return SIDES.find((s) => this.slots[s] && this.slots[s].connected && this.slots[s].socketId === socketId) || null;
  }

  leave(socketId) {
    const side = this.sideOf(socketId);
    if (!side) return; // socket ya reemplazado o expulsado
    const slot = this.slots[side];
    slot.connected = false;
    slot.graceLeft = this.cfg.RECONNECT_GRACE_MS;
    this.emit('opponent_left', { graceMs: this.cfg.RECONNECT_GRACE_MS }, opposite(side));
  }

  // ---------- Acciones de jugador ----------

  input(side, dir) {
    if (!SIDES.includes(side) || !this.slots[side]) return false;
    if (dir !== -1 && dir !== 0 && dir !== 1) return false;
    this.game.paddles[side].dir = dir;
    return true;
  }

  ready(side) {
    if (this.phase !== 'READY' || !this.slots[side]) return false;
    this.slots[side].ready = true;
    this.emit('phase', this.phasePayload());
    this._maybeStart();
    return true;
  }

  rematch(side) {
    if (this.phase !== 'GAME_OVER' || !this.slots[side]) return false;
    this.slots[side].rematch = true;
    this.emit('phase', this.phasePayload());
    if (SIDES.every((s) => this.slots[s] && this.slots[s].connected && this.slots[s].rematch)) {
      G.resetScore(this.game);
      G.resetPaddles(this.game);
      G.placeBall(this.game);
      this.winner = null;
      this._resetFlags();
      this._setPhase('COUNTDOWN');
    }
    return true;
  }

  // ---------- Bucle ----------

  _paused() {
    return IN_PROGRESS.has(this.phase) && SIDES.some((s) => this.slots[s] && !this.slots[s].connected);
  }

  tick(dtMs) {
    // Gracia de reconexión
    for (const s of SIDES) {
      const slot = this.slots[s];
      if (slot && !slot.connected) {
        slot.graceLeft -= dtMs;
        if (slot.graceLeft <= 0) this._release(s);
      }
    }
    if (this._paused()) return;

    this.phaseMs += dtMs;
    const dt = dtMs / 1000;

    switch (this.phase) {
      case 'READY':
        for (const s of SIDES) {
          const slot = this.slots[s];
          if (slot && slot.connected && !slot.ready) {
            slot.idleMs += dtMs;
            if (slot.idleMs >= this.cfg.IDLE_KICK_MS) {
              this.emit('kick', { socketId: slot.socketId, reason: 'idle' });
              this._release(s);
              break;
            }
          }
        }
        break;

      case 'COUNTDOWN':
        G.movePaddles(this.game, dt);
        if (this.phaseMs >= this.cfg.COUNTDOWN_MS) {
          G.serve(this.game, null, this.rng);
          this._setPhase('PLAYING');
        }
        break;

      case 'PLAYING': {
        const scorer = G.step(this.game, dt);
        if (scorer) this._onPoint(scorer);
        break;
      }

      case 'POINT_PAUSE':
        G.movePaddles(this.game, dt);
        if (this.phaseMs >= this.cfg.POINT_PAUSE_MS) {
          G.serve(this.game, this.serveTo, this.rng);
          this._setPhase('PLAYING');
        }
        break;

      default:
        break;
    }
  }

  _onPoint(scorer) {
    this.game.score[scorer] += 1;
    const score = { ...this.game.score };
    this.emit('point', { scorer, score });
    G.placeBall(this.game);
    if (score[scorer] >= this.cfg.WIN_SCORE) {
      this.winner = scorer;
      this._resetFlags();
      this._setPhase('GAME_OVER');
      this.emit('game_over', { winner: scorer, score, reason: 'score' });
    } else {
      this.serveTo = scorer; // saca hacia quien recibió el punto
      this._setPhase('POINT_PAUSE');
    }
  }

  // ---------- Internos ----------

  _maybeStart() {
    if (this.phase !== 'READY') return;
    if (SIDES.every((s) => this.slots[s] && this.slots[s].connected && this.slots[s].ready)) {
      this._setPhase('COUNTDOWN');
    }
  }

  _resetFlags() {
    for (const s of SIDES) {
      if (this.slots[s]) {
        this.slots[s].ready = false;
        this.slots[s].rematch = false;
        this.slots[s].idleMs = 0;
      }
    }
  }

  // Libera un slot (gracia agotada o expulsión por inactividad).
  _release(side) {
    const other = opposite(side);
    const wasInProgress = IN_PROGRESS.has(this.phase);
    this.slots[side] = null;

    if (wasInProgress && this.slots[other]) {
      this.emit('game_over', { winner: other, score: { ...this.game.score }, reason: 'abandon' });
    }
    G.resetScore(this.game);
    G.resetPaddles(this.game);
    G.placeBall(this.game);
    this.winner = null;
    this._resetFlags();
    this._setPhase('WAITING');
  }

  _setPhase(phase) {
    this.phase = phase;
    this.phaseMs = 0;
    this.emit('phase', this.phasePayload());
  }

  phasePayload() {
    const occ = {};
    const ready = {};
    const rematch = {};
    const connected = {};
    for (const s of SIDES) {
      const slot = this.slots[s];
      occ[s] = !!slot;
      connected[s] = !!(slot && slot.connected);
      ready[s] = !!(slot && slot.ready);
      rematch[s] = !!(slot && slot.rematch);
    }
    return {
      phase: this.phase,
      occupied: occ,
      connected,
      ready,
      rematch,
      score: { ...this.game.score },
      winScore: this.cfg.WIN_SCORE,
      winner: this.winner,
      endsInMs:
        this.phase === 'COUNTDOWN'
          ? Math.max(0, this.cfg.COUNTDOWN_MS - this.phaseMs)
          : this.phase === 'POINT_PAUSE'
          ? Math.max(0, this.cfg.POINT_PAUSE_MS - this.phaseMs)
          : 0,
    };
  }

  snapshot() {
    const { ball, paddles, score } = this.game;
    return {
      ball: { x: ball.x, y: ball.y },
      paddles: { left: paddles.left.y, right: paddles.right.y },
      score: { ...score },
      t: Date.now(),
    };
  }
}

module.exports = { Duel, SIDES };
