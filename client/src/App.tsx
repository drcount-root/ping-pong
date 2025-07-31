import { useEffect, useRef, useState } from "react";

interface Player {
  y: number;
}

interface Ball {
  x: number;
  y: number;
}

interface GameState {
  players: Record<string, Player>;
  ball: Ball;
}

const socket = new WebSocket("ws://localhost:8081");

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    players: {},
    ball: { x: 400, y: 300 },
  });

  useEffect(() => {
    socket.onmessage = (event: MessageEvent) => {
      const state: GameState = JSON.parse(event.data);
      setGameState(state);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        socket.send(JSON.stringify({ y }));
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw paddles
      const players = Object.values(gameState.players);
      players.forEach((player, i) => {
        ctx.fillStyle = "black";
        ctx.fillRect(i === 0 ? 20 : 760, player.y, 10, 100);
      });

      // Draw ball
      const { x, y } = gameState.ball;
      ctx.fillStyle = "red";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();

      requestAnimationFrame(render);
    };

    render();
  }, [gameState]);

  return <canvas ref={canvasRef} width={800} height={600} />;
}
