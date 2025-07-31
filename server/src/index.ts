import { WebSocketServer } from "ws";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8081;

// Create HTTP server (optional health check)
const httpServer = http.createServer((_, res) => {
  res.writeHead(200);
  res.end("Pong WebSocket Server");
});

// Attach WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// Game state types
type Player = { y: number };
type Ball = { x: number; y: number; vx: number; vy: number };
type GameState = { players: Record<string, Player>; ball: Ball };

// Initialize state
const state: GameState = {
  players: {},
  ball: { x: 400, y: 300, vx: 200, vy: 150 },
};

// Broadcast every tick
const TICK_RATE = 60;
setInterval(() => {
  // Update ball physics
  const ball = state.ball;
  ball.x += ball.vx / TICK_RATE;
  ball.y += ball.vy / TICK_RATE;
  if (ball.y <= 0 || ball.y >= 600) ball.vy *= -1;

  // Broadcast state
  const payload = JSON.stringify(state);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}, 1000 / TICK_RATE);

// Handle connections
wss.on("connection", (ws) => {
  // Assign new player
  const id = `player${Object.keys(state.players).length + 1}`;
  state.players[id] = { y: 300 };

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (typeof msg.y === "number") {
        state.players[id].y = msg.y;
      }
    } catch {}
  });

  ws.on("close", () => {
    delete state.players[id];
  });
});

// Start servers
httpServer.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
