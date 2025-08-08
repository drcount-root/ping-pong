"use client";

import React, { useEffect, useRef } from "react";

type ServerInit = {
  type: "init";
  side: "left" | "right";
  width: number;
  height: number;
  lagCompMs?: number;
};

type ServerState = {
  type: "state";
  seq: number;
  serverTime: number;
  ball: { x: number; y: number; vx?: number; vy?: number };
  left: { y: number; score: number } | null;
  right: { y: number; score: number } | null;
};

type ServerPing = { type: "ping"; t: number };
type ServerFull = { type: "full" };
type ServerEnd = { type: "end"; reason: string };

type ServerMsg = ServerInit | ServerState | ServerPing | ServerFull | ServerEnd;

const WIDTH = 800;
const HEIGHT = 500;
const PADDLE_W = 12;
const PADDLE_H = 90;
const BALL_R = 8;

export default function GameEngine() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);

  // Mutable state kept in refs to avoid re-renders
  const wsRef = useRef<WebSocket | null>(null);
  const sideRef = useRef<"left" | "right" | null>(null);
  const lagCompMsRef = useRef<number>(100);
  const stateBufferRef = useRef<
    Array<{
      t: number;
      ball: { x: number; y: number };
      left: { y: number; score: number } | null;
      right: { y: number; score: number } | null;
    }>
  >([]);

  const inputDownRef = useRef<Set<"up" | "down">>(new Set());

  function sendInput() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const up = inputDownRef.current.has("up");
    const down = inputDownRef.current.has("down");
    ws.send(JSON.stringify({ type: "input", up, down }));
  }

  useEffect(() => {
    // Keyboard input
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ArrowUp" || e.code === "KeyW")
        inputDownRef.current.add("up");
      if (e.code === "ArrowDown" || e.code === "KeyS")
        inputDownRef.current.add("down");
      sendInput();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowUp" || e.code === "KeyW")
        inputDownRef.current.delete("up");
      if (e.code === "ArrowDown" || e.code === "KeyS")
        inputDownRef.current.delete("down");
      sendInput();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    // Open WebSocket
    const envUrl = process.env.NEXT_PUBLIC_WS_URL;
    const defaultUrl =
      (location.protocol === "https:" ? "wss://" : "ws://") +
      (location.host || "localhost:8080");
    const WS_URL = envUrl || defaultUrl;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (statusRef.current)
        statusRef.current.textContent = "Connected. Waiting for opponent...";
    };

    ws.onmessage = (evt: MessageEvent) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }

      if (msg.type === "init") {
        sideRef.current = msg.side;
        lagCompMsRef.current = msg.lagCompMs ?? 100;
        if (statusRef.current)
          statusRef.current.textContent = `You are ${msg.side}. Use W/S or Arrow keys.`;
      } else if (msg.type === "state") {
        stateBufferRef.current.push({
          t: msg.serverTime,
          ball: { x: msg.ball.x, y: msg.ball.y },
          left: msg.left ? { y: msg.left.y, score: msg.left.score } : null,
          right: msg.right ? { y: msg.right.y, score: msg.right.score } : null,
        });
        // Keep last ~1.5s of states
        const cutoff = performance.now() - 1500;
        const buf = stateBufferRef.current;
        while (buf.length > 2 && buf[0].t < cutoff) buf.shift();
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
      } else if (msg.type === "full") {
        if (statusRef.current)
          statusRef.current.textContent = "Server full. Try again later.";
      } else if (msg.type === "end") {
        if (statusRef.current)
          statusRef.current.textContent = `Match ended: ${msg.reason}`;
      }
    };

    ws.onclose = () => {
      if (statusRef.current) statusRef.current.textContent = "Disconnected.";
    };

    return () => {
      try {
        ws.close();
      } catch {}
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Render loop
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    function lerp(a: number, b: number, t: number) {
      return a + (b - a) * t;
    }
    function clamp01(v: number) {
      return Math.max(0, Math.min(1, v));
    }

    function sampleState(renderTime: number) {
      const buf = stateBufferRef.current;
      if (buf.length === 0) return null;

      let i = buf.length - 1;
      while (i > 0 && buf[i - 1].t > renderTime) i--;
      const prev = buf[Math.max(0, i - 1)];
      const next = buf[i];

      if (!prev || !next) return buf[buf.length - 1];

      const total = next.t - prev.t || 1;
      const alpha = clamp01((renderTime - prev.t) / total);

      return {
        ball: {
          x: lerp(prev.ball.x, next.ball.x, alpha),
          y: lerp(prev.ball.y, next.ball.y, alpha),
        },
        left:
          next.left && prev.left
            ? {
                y: lerp(prev.left.y, next.left.y, alpha),
                score: next.left.score,
              }
            : next.left || prev.left,
        right:
          next.right && prev.right
            ? {
                y: lerp(prev.right.y, next.right.y, alpha),
                score: next.right.score,
              }
            : next.right || prev.right,
      };
    }

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const renderTime = Date.now() - lagCompMsRef.current;
      const s = sampleState(renderTime);
      if (!s) return;

      ctx.clearRect(0, 0, W, H);

      // net
      ctx.fillStyle = "#333";
      for (let y = 0; y < H; y += 16) ctx.fillRect(W / 2 - 2, y, 4, 10);

      // paddles
      ctx.fillStyle = "#fff";
      if (s.left) ctx.fillRect(20, s.left.y, PADDLE_W, PADDLE_H);
      if (s.right)
        ctx.fillRect(W - 20 - PADDLE_W, s.right.y, PADDLE_W, PADDLE_H);

      // ball
      ctx.beginPath();
      ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();

      // score
      ctx.font = "48px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String((s.left && s.left.score) || 0), W * 0.25, 60);
      ctx.fillText(String((s.right && s.right.score) || 0), W * 0.75, 60);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#111",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 20,
      }}
    >
      <div
        ref={statusRef}
        style={{
          position: "absolute",
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          color: "#fff",
          font: "14px system-ui",
        }}
      >
        Connecting...
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{
          display: "block",
          margin: "auto",
          background: "#000",
          border: "2px solid #444",
        }}
      />
    </main>
  );
}
