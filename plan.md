# Plan: Pong Dual (1 vs 1) en Node.js con sockets

Siguiente nivel del proyecto `ping-pong-individual` (Pong vs Pared, solo cliente con canvas 800x450). Ahora: **dos jugadores humanos, cliente-servidor, servidor autoritativo**, y el duelo queda **cerrado a exactamente 2 jugadores**.

## 1. Objetivo y alcance

- Un único duelo 1 vs 1 en tiempo real entre dos navegadores.
- Cuando ya hay 2 jugadores, **nadie más puede entrar** (ni como jugador ni como espectador): se le rechaza con un mensaje "Duelo lleno".
- Se gana al llegar a 7 puntos (configurable).
- Fuera de alcance (posibles extensiones): múltiples salas, espectadores, matchmaking, cuentas de usuario, persistencia.

## 2. Stack

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 20+ | Pedido del proyecto |
| Servidor HTTP | Express | Sirve los archivos estáticos del cliente |
| Sockets | **Socket.IO** | Continúa con el enfoque de sockets; reconexión y eventos nombrados listos |
| Cliente | HTML + Canvas + JS vanilla | Igual que el juego individual, sin build |
| Tests | `node:test` + `socket.io-client` | Probar la lógica y el flujo de conexión sin dependencias extra |

## 3. Estructura del proyecto

```
juegos-dual/
├── package.json
├── plan.md
├── README.md
├── server/
│   ├── index.js        # Express + Socket.IO, manejo de conexiones
│   ├── game.js         # Lógica pura del juego (física, colisiones, puntaje) sin sockets
│   ├── duel.js         # Estado del duelo: slots, fases, reinicio
│   └── config.js       # Constantes (tamaño, velocidades, puntos, tick rate, puerto)
├── public/
│   ├── index.html      # Canvas + overlays (lobby, cuenta regresiva, fin, "duelo lleno")
│   ├── client.js       # Socket, input, render, interpolación
│   └── style.css
└── test/
    ├── game.test.js    # Física y puntaje
    └── duel.test.js    # Slots, límite de 2, desconexión, revancha
```

Separar `game.js` (lógica pura) de `index.js` (red) permite probar la física sin abrir sockets.

## 4. Reglas de entrada: duelo cerrado a 2

El servidor mantiene dos slots: `left` y `right`.

1. Al conectar, si hay slot libre → se asigna (`left` primero, luego `right`) y se emite `joined { side }`.
2. Si ambos slots están ocupados → se emite `duel_full` y se **desconecta el socket** (`socket.disconnect(true)`). El middleware de `io.use()` rechaza la conexión **antes** de entrar al duelo, así que ni siquiera recibe el estado del juego.
3. El control de cupo se hace **solo en el servidor**; el cliente solo muestra el aviso.
4. Un mismo navegador no puede ocupar los 2 slots (se bloquea por `playerId` guardado en `sessionStorage`, además del socket id). Para pruebas locales se documenta usar dos pestañas con modo incógnito o dos navegadores; se puede activar `ALLOW_SAME_BROWSER=1` en desarrollo.
5. Si un jugador se desconecta, su slot se **reserva 10 s** (gracia de reconexión por `playerId`). Pasado ese tiempo se libera y puede entrar otra persona. Durante esos 10 s el slot sigue ocupado, por lo que nadie puede colarse.

## 5. Arquitectura de red (servidor autoritativo)

El servidor es la única fuente de verdad: simula la pelota, paletas, colisiones y marcador. Los clientes solo envían **intención de movimiento** y dibujan lo que reciben. Así ningún jugador puede hacer trampa modificando su cliente.

### Bucle del servidor
- Simulación a **60 ticks/s** (`setInterval` con corrección de deriva, o `setTimeout` con delta).
- Emisión de `state` a **30–60 Hz** al duelo.
- Movimiento basado en `dt` (no en frames) para velocidad constante.

### Eventos Cliente → Servidor
| Evento | Payload | Descripción |
|---|---|---|
| `input` | `{ dir: -1 \| 0 \| 1 }` | Dirección de la paleta (arriba / quieto / abajo). Se valida y se limita; se ignora si el socket no es jugador |
| `ready` | — | El jugador marca que está listo |
| `rematch` | — | Pide revancha al terminar |

### Eventos Servidor → Cliente
| Evento | Payload | Descripción |
|---|---|---|
| `joined` | `{ side, playerId }` | Slot asignado |
| `duel_full` | `{ message }` | Rechazo por duelo lleno |
| `phase` | `{ phase, ... }` | Cambio de fase (ver §6) |
| `state` | `{ ball, paddles, score, t }` | Snapshot del juego |
| `point` | `{ scorer, score }` | Punto anotado |
| `game_over` | `{ winner, score }` | Fin de la partida |
| `opponent_left` | `{ graceMs }` | El rival se desconectó |

### Validación en servidor
- `dir` solo acepta -1, 0 o 1 (cualquier otro valor se descarta).
- Límite de frecuencia de `input` (p. ej. máx. 120/s por socket).
- El cliente nunca envía posiciones, solo direcciones.

## 6. Fases del duelo (máquina de estados)

```
WAITING ──(2 jugadores)──▶ READY ──(ambos listos)──▶ COUNTDOWN ──(3s)──▶ PLAYING
   ▲                                                                       │
   │                                          punto ──▶ POINT_PAUSE ──(1.5s)┘
   │                                                                       │
   └───────────(revancha o abandono)──────────── GAME_OVER ◀──(7 puntos)───┘
```

- **WAITING**: hay 0 o 1 jugador. Pantalla "Esperando rival…".
- **READY**: 2 jugadores conectados; cada uno pulsa "Listo".
- **COUNTDOWN**: 3-2-1 antes del saque.
- **PLAYING**: física activa.
- **POINT_PAUSE**: pausa corta tras un punto; la pelota se reinicia al centro y saca hacia quien recibió el punto.
- **GAME_OVER**: gana quien llegue a 7. Botón "Revancha" (requiere que ambos acepten).
- Si un jugador se va durante **PLAYING**, la partida se **pausa** durante la gracia de 10 s; si no vuelve, el rival gana por abandono y se vuelve a WAITING.

## 7. Lógica de juego (a partir del juego individual)

Se reutiliza lo ya hecho y se extiende:

- Canvas lógico **800x450** (el servidor usa estas mismas dimensiones).
- Paletas: 15x100, velocidad 6 px/tick equivalente (en unidades por segundo con `dt`). `left` en x=30, `right` en x=800-30-15.
- Pelota: radio 10, velocidad inicial 5 (equivalente), ángulo de saque aleatorio acotado (±30°) para evitar saques casi verticales.
- Rebote en techo y piso (igual que antes).
- **Se elimina la pared derecha** del modo individual: ahora ahí hay un segundo jugador.
- **Ángulo según el punto de impacto**: al golpear la paleta, la salida depende de dónde pegó (centro = recto, extremos = más inclinado), hasta un máximo de ~60°.
- **Aceleración progresiva**: +4 % de velocidad por golpe (el original sumaba 0.2), con tope máximo.
- **Colisión corregida**: se usa el radio completo de la pelota y se evita el *tunneling* a alta velocidad (comprobación del segmento recorrido, no solo la posición final). Al detectar choque se reposiciona la pelota fuera de la paleta.
- **Punto**: si la pelota sale por la izquierda, suma el jugador derecho; si sale por la derecha, suma el izquierdo.

## 8. Cliente

- Al cargar: se conecta; si recibe `duel_full`, muestra pantalla "El duelo ya tiene 2 jugadores" y no dibuja el juego.
- Overlays de estado: esperando rival, listo, cuenta regresiva, ganador/perdedor, rival desconectado, reconectando.
- Controles: **W/S** o **Flechas**. Solo se envía `input` cuando la dirección **cambia** (no cada frame). Manejar `keydown`/`keyup` sin el bug del original donde soltar una tecla cancelaba la otra si se cruzaban.
- Render con `requestAnimationFrame`; **interpolación** entre los dos últimos snapshots (~100 ms de buffer) para que el movimiento se vea fluido aunque lleguen menos de 60 snapshots/s.
- Se indica qué lado controla cada jugador ("Tú eres el jugador izquierdo") y se resalta su paleta.
- Marcador en pantalla con ambos puntajes, además del indicador de latencia (ping) vía `socket.emit('ping')` con ack.

## 9. Fases de implementación

1. **Esqueleto**: `package.json`, Express sirviendo `public/`, Socket.IO conectando, página con canvas vacío.
2. **Lógica pura (`game.js`)**: pelota, paletas, colisiones, puntaje, con pruebas unitarias.
3. **Duelo y cupo (`duel.js`)**: slots, rechazo del 3er jugador, fases, gracia de reconexión.
4. **Bucle del servidor + eventos de red**: `input`, `state`, `phase`, `point`, `game_over`.
5. **Cliente**: render, input, overlays, interpolación.
6. **Pulido**: cuenta regresiva, revancha, ping, mensajes de error, sonidos opcionales.
7. **Pruebas y documentación**: tests de integración con `socket.io-client`, README con instrucciones.

## 10. Plan de pruebas

**Unitarias (`game.js`)**
- La pelota rebota en techo/piso.
- Golpe en el centro → ángulo recto; en el borde → ángulo mayor.
- No hay *tunneling* a velocidad máxima.
- Punto al jugador correcto según el lado por el que sale la pelota.
- La paleta no sale del canvas.

**Integración (`duel.js` + sockets)**
- El 1.er y 2.º cliente reciben `joined` con lados distintos.
- **El 3.er cliente recibe `duel_full` y es desconectado; nunca recibe `state`.**
- Un 3.er cliente tampoco puede entrar mientras un jugador está en gracia de reconexión.
- Tras la gracia de 10 s sin reconexión, el slot se libera y un nuevo cliente puede entrar.
- Reconexión con el mismo `playerId` recupera el mismo lado.
- Un `input` con valor inválido o de un no-jugador se ignora.
- Llegar a 7 puntos emite `game_over` y la revancha reinicia el marcador.

**Manual**
- Dos pestañas/navegadores jugando; abrir una tercera y confirmar el rechazo.
- Cerrar una pestaña en pleno juego y verificar pausa → reconexión / victoria por abandono.
- Probar en dos equipos de la misma red (LAN) para comprobar latencia real.

## 11. Cómo se ejecutará

```bash
npm install
npm start          # http://localhost:3000
npm test
PORT=4000 npm start
```

Variables de entorno: `PORT`, `WIN_SCORE`, `RECONNECT_GRACE_MS`, `ALLOW_SAME_BROWSER`.

## 12. Riesgos y decisiones abiertas

- **Latencia**: el cliente no predice su paleta (el servidor manda); con latencia alta se sentirá un retraso en el control. Mitigación posible: predicción local de la paleta propia con reconciliación.
- **Un solo duelo global**: una sola persona "ocupando" el slot podría bloquear el juego. Mitigación: tiempo de gracia limitado y expulsión por inactividad en WAITING/READY (p. ej. 60 s sin pulsar "Listo").
- **Identidad**: `playerId` en `sessionStorage` no es seguridad real, solo evita colisiones accidentales. Si se necesita, se agrega un token firmado.
- Decidir más adelante si se quiere pasar a **múltiples salas con código** (la estructura de `duel.js` se deja lista para instanciarse varias veces).
