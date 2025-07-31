export interface Player {
  y: number;
}

export interface Ball {
  x: number;
  y: number;
}

export interface GameState {
  players: Record<string, Player>;
  ball: Ball;
}
