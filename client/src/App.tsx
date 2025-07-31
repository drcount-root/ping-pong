import { useEffect } from "react";
import Phaser from "phaser";
import { PongGame } from "./PongGame";

export default function App() {
  useEffect(() => {
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 800,
      height: 600,
      scene: PongGame,
      parent: "game-container",
      backgroundColor: "#000000",
    };
    new Phaser.Game(config);
  }, []);

  return <div id="game-container" style={{ width: 800, height: 600 }} />;
}
