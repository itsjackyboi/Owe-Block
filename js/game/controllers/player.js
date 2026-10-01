// Turns keyboard and mouse into the same intent structure the AI will produce.
export class PlayerController {
  constructor(input) { this.input = input; }

  update(f, dt, cam) {
    const i = this.input, it = f.intent;
    let mx = (i.key('KeyD') || i.key('ArrowRight') ? 1 : 0) - (i.key('KeyA') || i.key('ArrowLeft') ? 1 : 0);
    let my = (i.key('KeyS') || i.key('ArrowDown') ? 1 : 0) - (i.key('KeyW') || i.key('ArrowUp') ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    it.mx = mx; it.my = my;
    // aim at the cursor in world space; use the same camera the frame will be drawn with
    const wx = i.mx + cam.rx, wy = i.my + cam.ry;
    it.aim = Math.atan2(wy - f.y, wx - f.x);
    it.dash = i.keyPressed('Space');
  }
}

// Idle controller for ?dummies=N test fighters.
export class IdleController {
  update(f) { f.intent.mx = 0; f.intent.my = 0; f.intent.dash = false; }
}
