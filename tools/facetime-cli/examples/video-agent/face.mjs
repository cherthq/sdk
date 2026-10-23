// The picture your caller sees: one RGBA frame per call to drawFace. Replace this file to show anything you like.
// It is plain JavaScript with no dependencies, so you can run and test it on its own.
export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 15;

const BACKGROUND = [16, 40, 52], FACE = [141, 224, 196], INK = [16, 40, 52], ACCENT = [255, 200, 118];

/**
 * A simple animated face. `tick` counts frames; `speaking` is true while the agent talks, and opens the mouth.
 * Returns WIDTH x HEIGHT pixels, four bytes each: red, green, blue, alpha.
 */
export function drawFace(tick, speaking) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const cx = WIDTH / 2, cy = HEIGHT / 2 - 10, radius = HEIGHT * 0.36;
  const blink = tick % 60 < 3;                                  // a short blink every four seconds
  const mouth = speaking ? 6 + 14 * Math.abs(Math.sin(tick * 0.8)) : 4;
  const bar = (tick * 6) % (WIDTH - 40);                        // a moving bar, so a frozen picture is easy to spot
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let color = BACKGROUND;
      if ((x - cx) ** 2 + (y - cy) ** 2 < radius ** 2) color = FACE;
      const eye = Math.abs(x - (cx - 45)) < 10 || Math.abs(x - (cx + 45)) < 10;
      if (eye && Math.abs(y - (cy - 35)) < (blink ? 2 : 14)) color = INK;
      if (((x - cx) / 48) ** 2 + ((y - (cy + 45)) / mouth) ** 2 < 1) color = INK;
      if (y > HEIGHT - 22 && y < HEIGHT - 12 && x > bar && x < bar + 40) color = ACCENT;
      const i = (y * WIDTH + x) * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    }
  }
  return pixels;
}
