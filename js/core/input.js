// Keyboard + mouse state. Edge flags (pressed/released/wheel) live until consumed by endStep().
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.clientX = 0; this.clientY = 0;
    this.mx = 0; this.my = 0; // internal-resolution mouse position, set by Renderer.mapMouse
    this.wheel = 0;
    this.gesture = false; // true once the user has interacted (needed for WebAudio)

    const kd = (e) => {
      this.gesture = true;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F3') e.preventDefault();
      if (!e.repeat) { this.down.add(e.code); this.pressed.add(e.code); }
    };
    const ku = (e) => { this.down.delete(e.code); this.released.add(e.code); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.down.clear(); this.mouseDown.fill(false); });
    window.addEventListener('mousemove', (e) => { this.clientX = e.clientX; this.clientY = e.clientY; });
    canvas.addEventListener('mousedown', (e) => {
      this.gesture = true;
      this.clientX = e.clientX; this.clientY = e.clientY;
      if (e.button < 3) { this.mouseDown[e.button] = true; this.mousePressed[e.button] = true; }
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) { this.mouseDown[e.button] = false; this.mouseReleased[e.button] = true; }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  key(code) { return this.down.has(code); }
  keyPressed(code) { return this.pressed.has(code); }
  keyReleased(code) { return this.released.has(code); }

  // Call once after every fixed update step so a click or key press is seen by exactly one step.
  endStep() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.fill(false);
    this.mouseReleased.fill(false);
    this.wheel = 0;
  }
}
