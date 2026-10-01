// Turns keyboard and mouse into the same intent structure the AI will produce.
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

export class PlayerController {
  constructor(input) { this.input = input; }

  update(f, dt, cam) {
    const i = this.input, it = f.intent;
    let mx = (i.key('KeyD') || i.key('ArrowRight') ? 1 : 0) - (i.key('KeyA') || i.key('ArrowLeft') ? 1 : 0);
    let my = (i.key('KeyS') || i.key('ArrowDown') ? 1 : 0) - (i.key('KeyW') || i.key('ArrowUp') ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    it.mx = mx; it.my = my;
    // aim at the cursor in world space, using the same camera the frame is drawn with
    it.tx = i.mx + cam.rx; it.ty = i.my + cam.ry;
    it.aim = Math.atan2(it.ty - f.y, it.tx - f.x);
    it.dash = i.keyPressed('Space');
    it.use = i.mouseDown[0] || i.mousePressed[0];
    it.special = i.key('KeyQ') || i.keyPressed('KeyQ');
    it.stance = i.mouseDown[2];
    it.pickup = i.keyPressed('KeyE');
    it.swapTo = -1;
    for (let k = 0; k < f.slots.length; k++) if (i.keyPressed(DIGITS[k])) it.swapTo = k;
    it.swapDir = i.wheel > 0 ? 1 : i.wheel < 0 ? -1 : 0;
  }
}

// Idle controller for ?dummies=N test fighters: stands still, never acts.
export class IdleController {
  update(f) {
    const it = f.intent;
    it.mx = 0; it.my = 0; it.dash = false; it.use = false; it.special = false; it.stance = false; it.pickup = false; it.swapTo = -1; it.swapDir = 0;
  }
}
