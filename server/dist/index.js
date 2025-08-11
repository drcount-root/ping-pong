"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const dotenv_1 = __importDefault(require("dotenv"));
const ws_1 = require("ws");
dotenv_1.default.config();
const PORT = Number(process.env.PORT) || 8081;
const TICK_RATE = 60;
const WIDTH = 800;
const HEIGHT = 500;
const PADDLE_W = 12;
const PADDLE_H = 90;
const BALL_R = 8;
const PADDLE_SPEED = 6;
const LAG_COMP_MS = 100;
function makeMatch() {
    return {
        players: [],
        ball: {
            x: WIDTH / 2,
            y: HEIGHT / 2,
            vx: 5 * (Math.random() < 0.5 ? -1 : 1),
            vy: (Math.random() * 2 - 1) * 4,
        },
        seq: 0,
        startedAt: Date.now(),
    };
}
const match = makeMatch();
const server = http_1.default.createServer();
const wss = new ws_1.WebSocketServer({ server });
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
function resetBall(dir) {
    match.ball.x = WIDTH / 2;
    match.ball.y = HEIGHT / 2;
    const angle = Math.random() * 0.6 - 0.3;
    const speed = 5;
    match.ball.vx = Math.cos(angle) * speed * dir;
    match.ball.vy = Math.sin(angle) * speed;
}
function broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const p of match.players) {
        if (p.ws.readyState === ws_1.WebSocket.OPEN) {
            p.ws.send(msg);
        }
    }
}
function teardownMatch(reason = "reset") {
    try {
        broadcast({ type: "end", reason });
    }
    catch (_a) { }
    for (const p of match.players) {
        try {
            p.ws.close();
        }
        catch (_b) { }
    }
    match.players = [];
    match.seq = 0;
    resetBall(Math.random() < 0.5 ? 1 : -1);
}
wss.on("connection", (ws) => {
    if (match.players.length >= 2) {
        ws.send(JSON.stringify({ type: "full" }));
        ws.close();
        return;
    }
    const side = match.players.length === 0 ? "left" : "right";
    const y = HEIGHT / 2 - PADDLE_H / 2;
    const player = {
        ws,
        side,
        y,
        score: 0,
        up: false,
        down: false,
        lastPong: Date.now(),
    };
    match.players.push(player);
    ws.send(JSON.stringify({
        type: "init",
        side,
        width: WIDTH,
        height: HEIGHT,
        lagCompMs: LAG_COMP_MS,
    }));
    ws.on("message", (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        }
        catch (_a) {
            return;
        }
        if (msg.type === "input") {
            player.up = !!msg.up;
            player.down = !!msg.down;
        }
        else if (msg.type === "pong") {
            player.lastPong = Date.now();
        }
        else if (msg.type === "touchMove" && typeof msg.desiredY === "number") {
            // Clamp desiredY to canvas
            player.desiredY = Math.max(PADDLE_H / 2, Math.min(HEIGHT - PADDLE_H / 2, msg.desiredY));
        }
    });
    ws.on("close", () => {
        teardownMatch("player_left");
    });
});
// Heartbeat
setInterval(() => {
    const now = Date.now();
    for (const p of match.players) {
        if (p.ws.readyState === ws_1.WebSocket.OPEN) {
            try {
                p.ws.send(JSON.stringify({ type: "ping", t: now }));
            }
            catch (_a) { }
        }
        if (now - p.lastPong > 10000) {
            try {
                p.ws.terminate();
            }
            catch (_b) { }
        }
    }
}, 3000);
setInterval(() => {
    // update paddles
    // for (const p of match.players) {
    //   const vy = (p.up ? -PADDLE_SPEED : 0) + (p.down ? PADDLE_SPEED : 0);
    //   p.y = clamp(p.y + vy, 0, HEIGHT - PADDLE_H);
    // }
    for (const p of match.players) {
        if (typeof p.desiredY === "number") {
            // Target paddle center to desiredY; adjust speed multiplier to tune responsiveness
            const currentCenter = p.y + PADDLE_H / 2;
            const delta = p.desiredY - currentCenter;
            const maxStep = 18; // faster than keyboard speed for touch
            const step = Math.max(-maxStep, Math.min(maxStep, delta));
            p.y = Math.max(0, Math.min(HEIGHT - PADDLE_H, p.y + step));
        }
        else {
            // fallback to keyboard up/down logic
            const vy = (p.up ? -PADDLE_SPEED : 0) + (p.down ? PADDLE_SPEED : 0);
            p.y = Math.max(0, Math.min(HEIGHT - PADDLE_H, p.y + vy));
        }
    }
    // update ball
    const b = match.ball;
    b.x += b.vx;
    b.y += b.vy;
    if (b.y - BALL_R <= 0 && b.vy < 0) {
        b.y = BALL_R;
        b.vy *= -1;
    }
    if (b.y + BALL_R >= HEIGHT && b.vy > 0) {
        b.y = HEIGHT - BALL_R;
        b.vy *= -1;
    }
    // paddles
    const left = match.players.find((p) => p.side === "left");
    const right = match.players.find((p) => p.side === "right");
    function collide(padX, padY, isLeft) {
        if (b.x - BALL_R < padX + PADDLE_W &&
            b.x + BALL_R > padX &&
            b.y + BALL_R > padY &&
            b.y - BALL_R < padY + PADDLE_H) {
            if (b.vx < 0 && isLeft)
                b.x = padX + PADDLE_W + BALL_R;
            if (b.vx > 0 && !isLeft)
                b.x = padX - BALL_R;
            const relative = (b.y - (padY + PADDLE_H / 2)) / (PADDLE_H / 2);
            const maxBounce = Math.PI / 4;
            const speed = Math.min(Math.hypot(b.vx, b.vy) * 1.03, 12);
            const angle = relative * maxBounce;
            const dir = isLeft ? 1 : -1;
            b.vx = Math.cos(angle) * speed * dir;
            b.vy = Math.sin(angle) * speed;
        }
    }
    if (left)
        collide(20, left.y, true);
    if (right)
        collide(WIDTH - 20 - PADDLE_W, right.y, false);
    if (b.x < -BALL_R * 2) {
        if (right)
            right.score++;
        resetBall(1);
    }
    if (b.x > WIDTH + BALL_R * 2) {
        if (left)
            left.score++;
        resetBall(-1);
    }
    // send state
    match.seq++;
    const payload = {
        type: "state",
        seq: match.seq,
        serverTime: Date.now(),
        ball: match.ball,
        left: left ? { y: left.y, score: left.score } : null,
        right: right ? { y: right.y, score: right.score } : null,
    };
    broadcast(payload);
}, 1000 / TICK_RATE);
server.listen(PORT, () => {
    console.log("WebSocket server on :" + PORT);
});
