import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

import { GameState } from "./types/types";

dotenv.config();

const PORT = (process.env.PORT || 8081) as number;
const wss = new WebSocketServer({ port: PORT });

const gameState: GameState = {
  players: {},
  ball: { x: 400, y: 300, vx: 3, vy: 3 },
};

function broadcastState() {
  const message = JSON.stringify(gameState);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

setInterval(() => {
  const ball = gameState.ball;
  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.y <= 0 || ball.y >= 600) ball.vy *= -1;

  broadcastState();
}, 16);

wss.on("connection", (ws: WebSocket) => {
  const playerId = `player${Object.keys(gameState.players).length + 1}`;
  gameState.players[playerId] = { y: 300 };

  ws.on("message", (data: string) => {
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed.y === "number") {
        gameState.players[playerId].y = parsed.y;
      }
    } catch (err) {
      console.error("Invalid message received", err);
    }
  });

  ws.on("close", () => {
    delete gameState.players[playerId];
  });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);
