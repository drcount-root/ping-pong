import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 8081;

const server = createServer();
const wss = new WebSocketServer({ server });

interface Peer {
  id: string;
  socket: WebSocket;
}

const peers = new Map<string, WebSocket>();

wss.on("connection", (socket) => {
  let peerId: string | null = null;

  socket.on("message", (message) => {
    const data = JSON.parse(message.toString());

    switch (data.type) {
      case "join":
        peerId = data.id;
        if (peerId !== null) {
          peers.set(peerId, socket);
        }
        console.log(`[JOIN] ${peerId}`);
        break;

      case "signal":
        const { target, payload } = data;
        const targetSocket = peers.get(target);
        if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(
            JSON.stringify({
              type: "signal",
              from: peerId,
              payload,
            })
          );
        }
        break;

      default:
        console.log(`[UNKNOWN]`, data);
    }
  });

  socket.on("close", () => {
    if (peerId) {
      peers.delete(peerId);
      console.log(`[LEAVE] ${peerId}`);
    }
  });
});

server.listen(port, () => {
  console.log(`✅ Signaling server listening on ws://localhost:${port}`);
});
