import Phaser from "phaser";
import type { GameState } from "./types";

export class PongGame extends Phaser.Scene {
  private socket!: WebSocket;
  private playerId!: string;
  private paddles: Record<string, Phaser.GameObjects.Rectangle> = {};
  private ball!: Phaser.GameObjects.Arc;

  constructor() {
    super({ key: "PongGame" });
  }

  preload() {}

  create() {
    // Connect WebSocket
    this.socket = new WebSocket("ws://localhost:8081");

    this.socket.addEventListener("open", () => console.log("WS connected"));
    this.socket.addEventListener("message", (ev) => {
      const state: GameState = JSON.parse(ev.data);
      // On first message, determine playerId
      if (!this.playerId) {
        this.playerId = Object.keys(state.players).find(
          (id) => !(id in this.paddles)
        )!;
      }
      this.syncState(state);
    });

    // Create paddles & ball
    for (let i = 0; i < 2; i++) {
      this.paddles[`player${i + 1}`] = this.add.rectangle(
        i === 0 ? 50 : 750,
        300,
        20,
        100,
        0xffffff
      );
    }
    this.ball = this.add.circle(400, 300, 10, 0xff0000);

    // Mouse input
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const y = Phaser.Math.Clamp(pointer.y, 50, 550);
      // send y
      this.socket.send(JSON.stringify({ y }));
    });
  }

  update() {
    // nothing here; rendering driven by syncState
  }

  private syncState(state: GameState) {
    // Update paddles
    for (const [id, player] of Object.entries(state.players)) {
      this.paddles[id].y = player.y;
    }
    // Update ball
    this.ball.setPosition(state.ball.x, state.ball.y);
  }
}
