(() => {
  'use strict';

  const W = 800, H = 450, PW = 15, PH = 100, MARGIN = 30, R = 10;
  const INTERP_DELAY = 100; // ms de buffer para interpolar
  const SNAP_DIST = 200; // si algo salta más que esto (saque/punto) no se interpola

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const elTitle = document.getElementById('overlay-title');
  const elSub = document.getElementById('overlay-sub');
  const btnReady = document.getElementById('btn-ready');
  const btnRematch = document.getElementById('btn-rematch');
  const elRole = document.getElementById('role');
  const elPing = document.getElementById('ping');

  let storedId = null;
  try { storedId = sessionStorage.getItem('pongPlayerId'); } catch (_) { /* sin storage */ }

  const socket = io({ auth: { playerId: storedId } });

  let mySide = null;
  let phase = null; // último payload de 'phase'
  let phaseAt = 0; // performance.now() al recibirlo
  let full = false;
  let opponentGrace = null; // { until }
  let snaps = []; // { at, s }
  let lastScore = { left: 0, right: 0 };

  // ---------- Red ----------

  socket.on('joined', ({ side, playerId }) => {
    mySide = side;
    try { sessionStorage.setItem('pongPlayerId', playerId); } catch (_) { /* ignore */ }
    elRole.textContent = `Tú eres el jugador ${side === 'left' ? 'izquierdo' : 'derecho'}`;
  });

  socket.on('connect_error', (err) => {
    if (err && err.message === 'duel_full') {
      full = true;
      elRole.textContent = 'Sin cupo: no se admiten espectadores';
      socket.disconnect(); // sin reintentos
    } else {
      elRole.textContent = 'Reconectando…';
    }
    updateOverlay();
  });
  socket.on('duel_full', () => { full = true; socket.disconnect(); updateOverlay(); });
  socket.on('kicked', () => { full = false; mySide = null; elRole.textContent = 'Expulsado por inactividad'; });
  socket.on('disconnect', () => { if (!full) elRole.textContent = 'Reconectando…'; });

  socket.on('phase', (p) => {
    phase = p;
    phaseAt = performance.now();
    if (p.phase !== 'PLAYING' && p.phase !== 'POINT_PAUSE') snaps = [];
    lastScore = p.score;
    if (p.phase === 'WAITING') opponentGrace = null; // el slot del rival ya se liberó
    btnReady.disabled = false;
    btnRematch.disabled = false;
    updateOverlay();
  });

  socket.on('state', (s) => {
    snaps.push({ at: performance.now(), s });
    if (snaps.length > 30) snaps.shift();
    lastScore = s.score;
  });

  socket.on('opponent_left', ({ graceMs }) => {
    opponentGrace = { until: performance.now() + graceMs };
    updateOverlay();
  });
  socket.on('opponent_back', () => { opponentGrace = null; updateOverlay(); });

  btnReady.addEventListener('click', () => { socket.emit('ready'); btnReady.disabled = true; });
  btnRematch.addEventListener('click', () => { socket.emit('rematch'); btnRematch.disabled = true; });

  // Ping con ack
  setInterval(() => {
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.timeout(2000).emit('latency', (err) => {
      elPing.textContent = err ? '— ms' : `${Math.round(performance.now() - t0)} ms`;
    });
  }, 2000);

  // ---------- Input ----------
  // Se trackean las teclas arriba/abajo por separado: soltar una con la otra aún pulsada
  // deja la dirección de la otra (corrige el bug del juego individual).

  const held = { up: false, down: false };
  let sentDir = 0;

  function keyToDir(e) {
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': return 'up';
      case 'ArrowDown': case 's': case 'S': return 'down';
      default: return null;
    }
  }
  function syncInput() {
    const dir = (held.down ? 1 : 0) - (held.up ? 1 : 0);
    if (dir !== sentDir) {
      sentDir = dir;
      socket.emit('input', { dir });
    }
  }
  window.addEventListener('keydown', (e) => {
    const k = keyToDir(e);
    if (!k) return;
    e.preventDefault();
    held[k] = true;
    syncInput();
  });
  window.addEventListener('keyup', (e) => {
    const k = keyToDir(e);
    if (!k) return;
    held[k] = false;
    syncInput();
  });
  window.addEventListener('blur', () => { held.up = held.down = false; syncInput(); });

  // ---------- Overlay ----------

  function show(title, sub, { clear = false, ready = false, rematch = false } = {}) {
    overlay.classList.remove('hidden');
    overlay.classList.toggle('clear', clear);
    elTitle.textContent = title;
    elSub.textContent = sub || '';
    btnReady.hidden = !ready;
    btnRematch.hidden = !rematch;
  }
  function hideOverlay() { overlay.classList.add('hidden'); }

  function updateOverlay() {
    if (full) {
      return show('Duelo lleno', 'El duelo ya tiene 2 jugadores. Intenta más tarde.');
    }
    if (!phase) return show('Conectando…', '');
    if (opponentGrace && (phase.phase === 'COUNTDOWN' || phase.phase === 'PLAYING' || phase.phase === 'POINT_PAUSE')) {
      const s = Math.max(0, Math.ceil((opponentGrace.until - performance.now()) / 1000));
      return show('Rival desconectado', `Pausa. Si no vuelve en ${s} s ganas por abandono.`);
    }
    if (opponentGrace) {
      const s = Math.max(0, Math.ceil((opponentGrace.until - performance.now()) / 1000));
      return show('Rival desconectado', `Esperando reconexión (${s} s)…`);
    }
    switch (phase.phase) {
      case 'WAITING':
        return show('Esperando rival…', 'Comparte esta página con otra persona.');
      case 'READY': {
        const iAmReady = mySide && phase.ready[mySide];
        return show(
          iAmReady ? 'Esperando al rival…' : 'Rival encontrado',
          iAmReady ? 'Tú ya estás listo.' : 'Pulsa "Listo" cuando quieras empezar.',
          { ready: !iAmReady }
        );
      }
      case 'COUNTDOWN': {
        const left = Math.max(0, phase.endsInMs - (performance.now() - phaseAt));
        return show(String(Math.max(1, Math.ceil(left / 1000))), '', { clear: true });
      }
      case 'GAME_OVER': {
        const won = phase.winner === mySide;
        const iWant = mySide && phase.rematch[mySide];
        return show(
          won ? '¡Ganaste!' : 'Perdiste',
          `${phase.score.left} – ${phase.score.right}` + (iWant ? ' · esperando al rival para la revancha' : ''),
          { rematch: !iWant }
        );
      }
      default:
        return hideOverlay();
    }
  }

  // ---------- Render ----------

  function lerp(a, b, t) { return a + (b - a) * t; }

  function interpolated() {
    if (!snaps.length) return null;
    const target = performance.now() - INTERP_DELAY;
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].at <= target) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    }
    if (!a) return snaps[0].s;
    if (!b) return a.s;
    const t = (target - a.at) / (b.at - a.at || 1);
    const A = a.s, B = b.s;
    const jump = Math.hypot(B.ball.x - A.ball.x, B.ball.y - A.ball.y) > SNAP_DIST;
    return {
      ball: jump ? B.ball : { x: lerp(A.ball.x, B.ball.x, t), y: lerp(A.ball.y, B.ball.y, t) },
      paddles: {
        left: lerp(A.paddles.left, B.paddles.left, t),
        right: lerp(A.paddles.right, B.paddles.right, t),
      },
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Línea central
    ctx.strokeStyle = '#26324d';
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 14]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Marcador
    ctx.fillStyle = '#e8ecf4';
    ctx.font = '700 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(lastScore.left), W / 2 - 70, 70);
    ctx.fillText(String(lastScore.right), W / 2 + 70, 70);

    const s = interpolated();
    const midY = (H - PH) / 2;
    const pl = s ? s.paddles.left : midY;
    const pr = s ? s.paddles.right : midY;

    ctx.fillStyle = mySide === 'left' ? '#3ddc97' : '#e8ecf4';
    ctx.fillRect(MARGIN, pl, PW, PH);
    ctx.fillStyle = mySide === 'right' ? '#3ddc97' : '#e8ecf4';
    ctx.fillRect(W - MARGIN - PW, pr, PW, PH);

    if (phase && phase.phase !== 'WAITING' && phase.phase !== 'READY') {
      const b = s ? s.ball : { x: W / 2, y: H / 2 };
      ctx.fillStyle = '#4aa8ff';
      ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.fill();
    }
  }

  function render() {
    updateOverlayTick();
    draw();
  }

  // Refresca textos que dependen del tiempo (cuenta regresiva, gracia del rival)
  let lastOverlayKey = '';
  function updateOverlayTick() {
    if (!phase) return;
    if (phase.phase === 'COUNTDOWN' || opponentGrace) {
      const key = `${phase.phase}|${Math.ceil(((opponentGrace ? opponentGrace.until - performance.now() : phase.endsInMs - (performance.now() - phaseAt))) / 1000)}`;
      if (key !== lastOverlayKey) { lastOverlayKey = key; updateOverlay(); }
    }
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  updateOverlay();
})();
