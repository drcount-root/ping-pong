"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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
  const movePadRef = useRef<HTMLDivElement | null>(null);

  // Mutable refs
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

  // Mode/state
  const inputModeRef = useRef<"none" | "canvas" | "movePad">("none");

  // Mobile detection (client-side)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      // Heuristic: if device primarily uses coarse pointer (touch) and no hover, treat as mobile
      const coarse =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches;
      const smallWidth =
        typeof window !== "undefined" && window.innerWidth <= 900;
      setIsMobile(coarse || smallWidth);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Server helpers
  const sendTouchMoveToServer = (desiredY: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "touchMove", desiredY }));
    }
  };
  const sendTouchEndToServer = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "touchEnd" }));
    }
  };

  // Pointer input on canvas (absolute desiredY drag)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Only enable canvas drag for touch pointers on mobile to avoid interfering with mouse on desktop
    const handlePointer = (e: PointerEvent) => {
      e.preventDefault(); // requires touchAction: "none" on canvas
      inputModeRef.current = "canvas";
      const rect = canvas.getBoundingClientRect();
      const yCanvas = ((e.clientY - rect.top) / rect.height) * HEIGHT;
      const clamped = Math.max(0, Math.min(HEIGHT, yCanvas));
      sendTouchMoveToServer(clamped);
    };

    const clearPointer = (e: PointerEvent) => {
      e.preventDefault();
      sendTouchEndToServer();
      inputModeRef.current = "none";
    };

    canvas.addEventListener("pointerdown", handlePointer, { passive: false });
    canvas.addEventListener("pointermove", handlePointer, { passive: false });
    canvas.addEventListener("pointerup", clearPointer, { passive: false });
    canvas.addEventListener("pointercancel", clearPointer, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", handlePointer);
      canvas.removeEventListener("pointermove", handlePointer);
      canvas.removeEventListener("pointerup", clearPointer);
      canvas.removeEventListener("pointercancel", clearPointer);
    };
  }, [isMobile]);

  // Pointer input on Move Pad (absolute desiredY drag) - mobile only
  useEffect(() => {
    if (!isMobile) return;
    const pad = movePadRef.current;
    if (!pad) return;

    const handlePointer = (e: PointerEvent) => {
      e.preventDefault();
      inputModeRef.current = "movePad";
      const rect = pad.getBoundingClientRect();
      const yRel = (e.clientY - rect.top) / rect.height; // 0..1 within the pad
      const yCanvas = Math.max(0, Math.min(HEIGHT, yRel * HEIGHT));
      sendTouchMoveToServer(yCanvas);
    };

    const clearPointer = (e: PointerEvent) => {
      e.preventDefault();
      sendTouchEndToServer();
      inputModeRef.current = "none";
    };

    pad.addEventListener("pointerdown", handlePointer, { passive: false });
    pad.addEventListener("pointermove", handlePointer, { passive: false });
    pad.addEventListener("pointerup", clearPointer, { passive: false });
    pad.addEventListener("pointercancel", clearPointer, { passive: false });

    return () => {
      pad.removeEventListener("pointerdown", handlePointer);
      pad.removeEventListener("pointermove", handlePointer);
      pad.removeEventListener("pointerup", clearPointer);
      pad.removeEventListener("pointercancel", clearPointer);
    };
  }, [isMobile]);

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
        statusRef.current.textContent = "Connected • Waiting for opponent…";
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
          statusRef.current.textContent = `You are ${msg.side.toUpperCase()}`;
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

      // Clear
      ctx.clearRect(0, 0, W, H);

      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#05060a");
      grad.addColorStop(1, "#000000");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Subtle vignette
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "#00f7ff33";
      ctx.shadowBlur = 25;
      ctx.fillStyle = "#00f7ff0d";
      for (let y = 0; y < H; y += 18) ctx.fillRect(W / 2 - 2, y, 4, 10);
      ctx.restore();

      // Paddles
      ctx.shadowColor = "#00f7ff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#00eaff";
      if (s.left) ctx.fillRect(20, s.left.y, PADDLE_W, PADDLE_H);
      if (s.right)
        ctx.fillRect(W - 20 - PADDLE_W, s.right.y, PADDLE_W, PADDLE_H);

      // Ball
      ctx.beginPath();
      ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = "#ff2ba6";
      ctx.fill();

      // Scores
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#e8f8ff";
      ctx.font =
        "600 48px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String((s.left && s.left.score) || 0), W * 0.25, 64);
      ctx.fillText(String((s.right && s.right.score) || 0), W * 0.75, 64);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Side-aware Move Pad positioning (mobile only)
  const movePadStyle = useMemo<React.CSSProperties>(() => {
    const side = sideRef.current ?? "right";
    const isLeft = side === "left";
    return {
      position: "fixed",
      [isLeft ? "left" : "right"]: 10,
      bottom: 12,
      top: 110, // leave space for status
      width: 64,
      borderRadius: 18,
      background:
        "linear-gradient(180deg, rgba(0,255,255,0.10), rgba(0,255,255,0.20))",
      border: "1px solid rgba(0,255,255,0.35)",
      boxShadow:
        "0 0 24px rgba(0,255,255,0.25), inset 0 0 16px rgba(0,255,255,0.15)",
      backdropFilter: "blur(8px)",
      zIndex: 10,
      userSelect: "none",
      WebkitUserSelect: "none",
      msUserSelect: "none",
      touchAction: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#aefcff",
      fontSize: 13,
      letterSpacing: 0.6,
      textShadow: "0 0 10px #00eaff",
    } as React.CSSProperties;
  }, [sideRef.current]);

  // Layout styles tuned for Desktop & Mobile
  const containerStyle: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 600px at 50% -100px, #0b0e14 20%, #05070b 60%, #000 100%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: isMobile ? "12px 10px 16px" : "18px 16px 24px",
    gap: 12,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    position: "relative",
    userSelect: "none",
    WebkitUserSelect: "none",
    msUserSelect: "none",
  };

  const contentCardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 980,
    borderRadius: 18,
    padding: isMobile ? 10 : 14,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow:
      "0 10px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  };

  const headerStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: isMobile ? 8 : 12,
    padding: isMobile ? "6px 10px" : "8px 12px",
  };

  const titleStyle: React.CSSProperties = {
    color: "#e8f8ff",
    fontSize: isMobile ? 16 : 18,
    fontWeight: 600,
    letterSpacing: 0.4,
    textShadow: "0 0 10px rgba(0,234,255,0.35)",
    display: "flex",
    alignItems: "center",
    gap: 10,
  };

  const statusBadgeStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 10,
    background: "rgba(0,234,255,0.10)",
    border: "1px solid rgba(0,234,255,0.35)",
    color: "#9feeff",
    fontSize: 12,
    backdropFilter: "blur(6px)",
    textShadow: "0 0 8px rgba(0,234,255,0.35)",
  };

  return (
    <main style={containerStyle}>
      <div style={contentCardStyle}>
        <div style={headerStyle}>
          <div style={titleStyle}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background:
                  "radial-gradient(circle at 30% 30%, #00f7ff, #008cff)",
                boxShadow: "0 0 10px #00eaff",
              }}
            />
            Neon Pong
          </div>
          <div ref={statusRef} style={statusBadgeStyle}>
            Connecting…
          </div>
        </div>

        <div
          style={{
            width: "100%",
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 980,
              aspectRatio: `${WIDTH} / ${HEIGHT}`,
              borderRadius: 16,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.98))",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow:
                "0 10px 40px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,234,255,0.08)",
              overflow: "hidden",
            }}
          >
            <canvas
              ref={canvasRef}
              width={WIDTH}
              height={HEIGHT}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                touchAction: "none", // so preventDefault works on touch
                userSelect: "none",
                WebkitUserSelect: "none",
                msUserSelect: "none",
                // Crisp rendering
                imageRendering: "pixelated",
              }}
            />
            {/* Mobile-only drag Move Pad */}
            {isMobile && (
              <div ref={movePadRef} style={movePadStyle}>
                Drag
              </div>
            )}
          </div>
        </div>

        {/* Hints */}
        <div
          style={{
            marginTop: isMobile ? 10 : 12,
            color: "#9fb6c3",
            fontSize: isMobile ? 12 : 13,
            opacity: 0.9,
            textAlign: "center",
          }}
        >
          {isMobile
            ? "Drag anywhere on the canvas or the side pad to move your paddle."
            : "Use your mouse to observe. Mobile devices support drag control."}
        </div>
      </div>
    </main>
  );
}
