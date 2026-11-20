# juegos-dual

Pong Dual 1 vs 1 en tiempo real con Node.js + Socket.IO. Siguiente nivel de `ping-pong-individual`:
**servidor autoritativo** y duelo **cerrado a exactamente 2 jugadores**. El diseño completo está en [`plan.md`](plan.md).

## Uso

```bash
npm install
npm start          # http://localhost:3000
npm test
PORT=4000 npm start
```

Variables de entorno: `PORT`, `WIN_SCORE` (7), `RECONNECT_GRACE_MS` (10000), `ALLOW_SAME_BROWSER` (`1` solo en desarrollo).

## Cómo jugar

1. Abre la página en dos navegadores (o dos pestañas) — el primero es el jugador izquierdo, el segundo el derecho.
2. Ambos pulsan **Listo** → cuenta regresiva 3-2-1.
3. **W/S** o **↑/↓**. Gana quien llegue a 7.
4. Una tercera persona que abra la página ve "Duelo lleno" y no recibe nunca el estado del juego.
5. Si un jugador se desconecta, su slot se reserva 10 s (la partida se pausa); si no vuelve, el rival gana por abandono.

## Estructura

- `server/game.js` — física pura (swept collision, ángulo por impacto, aceleración +4 %).
- `server/duel.js` — slots, fases, gracia de reconexión, revancha. Sin sockets; el tiempo avanza con `tick(dt)`.
- `server/index.js` — Express + Socket.IO; el cupo se decide en `io.use()`, antes de entrar al duelo.
- `public/` — cliente canvas con interpolación (~100 ms) y overlays por fase.
- `test/` — `node:test`: física, duelo e integración con `socket.io-client`.

## Notas

- El rechazo del 3er cliente llega como `connect_error` con mensaje `duel_full` (middleware); además hay un respaldo
  que emite `duel_full` y desconecta si el cupo se llenara entre el middleware y la conexión.
- El evento de latencia se llama `latency` (con ack), para no chocar con eventos internos de Socket.IO.
- `playerId` en `sessionStorage` evita colisiones accidentales; no es seguridad real.
