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
const FINGER_OFFSET = 150;

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

  // For throttling pointer/touch sends
  const lastTouchSendRef = useRef(0);
  const lastDesiredYRef = useRef<number | null>(null);

  const sendInput = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const up = inputDownRef.current.has("up");
    const down = inputDownRef.current.has("down");
    ws.send(JSON.stringify({ type: "input", up, down }));
  };

  // Keyboard input (desktop)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ArrowUp" || e.code === "KeyW") inputDownRef.current.add("up");
      if (e.code === "ArrowDown" || e.code === "KeyS") inputDownRef.current.add("down");
      sendInput();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowUp" || e.code === "KeyW") inputDownRef.current.delete("up");
      if (e.code === "ArrowDown" || e.code === "KeyS") inputDownRef.current.delete("down");
      sendInput();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Pointer input (mobile + desktop)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sendDesiredY = (yCanvas: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const now = performance.now();
      // Cap ~125 Hz and ignore tiny changes
      if (
        lastDesiredYRef.current !== null &&
        Math.abs(lastDesiredYRef.current - yCanvas) < 0.5 &&
        now - lastTouchSendRef.current < 8
      ) {
        return;
      }
      if (now - lastTouchSendRef.current < 8) return;

      lastDesiredYRef.current = yCanvas;
      lastTouchSendRef.current = now;
      ws.send(JSON.stringify({ type: "touchMove", desiredY: yCanvas }));
    };

    const handlePointer = (e: PointerEvent) => {
      // Ignore stray mouse moves with no button pressed
      if (e.pointerType === "mouse" && e.buttons === 0) return;

      const rect = canvas.getBoundingClientRect();
      const rawY = ((e.clientY - rect.top) / rect.height) * HEIGHT;
      const yCanvas = Math.max(PADDLE_H / 2, Math.min(HEIGHT - PADDLE_H / 2, rawY - FINGER_OFFSET));
      sendDesiredY(yCanvas);
    };

    const clearPointer = () => {
      inputDownRef.current.delete("up");
      inputDownRef.current.delete("down");
      sendInput();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "touchEnd" }));
      }
      lastDesiredYRef.current = null;
    };

    // Using pointer events reduces duplication across touch/mouse/stylus
    canvas.addEventListener("pointerdown", handlePointer, { passive: true });
    canvas.addEventListener("pointermove", handlePointer, { passive: true });
    window.addEventListener("pointerup", clearPointer, { passive: true });
    window.addEventListener("pointercancel", clearPointer, { passive: true });

    return () => {
      canvas.removeEventListener("pointerdown", handlePointer);
      canvas.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("pointerup", clearPointer);
      window.removeEventListener("pointercancel", clearPointer);
    };
  }, []);

  // WebSocket connection
  useEffect(() => {
    const envUrl = process.env.NEXT_PUBLIC_WS_URL;
    const defaultUrl =
      (location.protocol === "https:" ? "wss://" : "ws://") +
      (location.host || "localhost:8081");
    const WS_URL = envUrl || defaultUrl;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (statusRef.current)
        statusRef.current.textContent = "Connected ⚡ Waiting for opponent...";
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
          statusRef.current.textContent = `You are ${msg.side.toUpperCase()} 🕹`;
      } else if (msg.type === "state") {
        stateBufferRef.current.push({
          t: msg.serverTime,
          ball: { x: msg.ball.x, y: msg.ball.y },
          left: msg.left ? { y: msg.left.y, score: msg.left.score } : null,
          right: msg.right ? { y: msg.right.y, score: msg.right.score } : null,
        });
        const cutoff = performance.now() - 1500;
        while (
          stateBufferRef.current.length > 2 &&
          stateBufferRef.current[0].t < cutoff
        )
          stateBufferRef.current.shift();
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
      } else if (msg.type === "full") {
        if (statusRef.current)
          statusRef.current.textContent = "⚠ Server full. Try again later.";
      } else if (msg.type === "end") {
        if (statusRef.current)
          statusRef.current.textContent = `🏁 Match ended: ${msg.reason}`;
      }
    };

    ws.onclose = () => {
      if (statusRef.current) statusRef.current.textContent = "🔌 Disconnected.";
    };

    return () => {
      try {
        ws.close();
      } catch {}
      wsRef.current = null;
    };
  }, []);

  // Render loop
  useEffect(() => {
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

      // Glow effect
      ctx.shadowColor = "#00f7ff";
      ctx.shadowBlur = 15;

      // Net
      ctx.fillStyle = "#0ff8";
      for (let y = 0; y < H; y += 16) ctx.fillRect(W / 2 - 2, y, 4, 10);

      // Paddles
      ctx.fillStyle = "#0ff";
      if (s.left) ctx.fillRect(20, s.left.y, PADDLE_W, PADDLE_H);
      if (s.right) ctx.fillRect(W - 20 - PADDLE_W, s.right.y, PADDLE_W, PADDLE_H);

      // Ball (glowing pulse)
      ctx.beginPath();
      ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = "#ff00aa";
      ctx.fill();

      // Scores
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 48px Orbitron, sans-serif";
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
        background: "radial-gradient(circle at top, #0a0a0a, #000)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 20,
        fontFamily: "'Orbitron', sans-serif",
        position: "relative",
      }}
    >
      <div
        ref={statusRef}
        style={{
          position: "absolute",
          top: 16,
          padding: "6px 12px",
          background: "rgba(0,255,255,0.1)",
          borderRadius: 8,
          backdropFilter: "blur(6px)",
          color: "#0ff",
          fontSize: 14,
          textShadow: "0 0 8px #0ff",
        }}
      >
        Connecting...
      </div>

      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{
          background: "#000",
          border: "2px solid rgba(0,255,255,0.3)",
          borderRadius: 12,
          boxShadow: "0 0 30px rgba(0,255,255,0.5)",
          width: "100%",
          maxWidth: 800,
          height: "auto",
          touchAction: "none",
        }}
      />

      {/* On-screen buttons */}
      <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 10,
          userSelect: "none",
        }}
      >
        {["↑", "↓"].map((arrow, idx) => (
          <button
            key={arrow}
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(10px)",
              color: "#0ff",
              border: "1px solid rgba(0,255,255,0.3)",
              fontSize: 24,
              boxShadow: "0 0 10px rgba(0,255,255,0.5)",
              userSelect: "none",
              WebkitUserSelect: "none",
              msUserSelect: "none",
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              inputDownRef.current.add(idx === 0 ? "up" : "down");
              sendInput();
            }}
            onPointerUp={(e) => {
              inputDownRef.current.delete(idx === 0 ? "up" : "down");
              sendInput();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {arrow}
          </button>
        ))}
      </div>
    </main>
  );
}
