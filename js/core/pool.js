// Fixed-capacity object pool. `active` is a dense array; iterate it backwards when releasing during a loop.
export class Pool {
  constructor(create, cap) {
    this.create = create;
    this.cap = cap;
    this.total = 0;
    this.free = [];
    this.active = [];
  }

  acquire() {
    let o = this.free.pop();
    if (!o) {
      if (this.total >= this.cap) return null;
      this.total++;
      o = this.create();
    }
    o._pi = this.active.length;
    this.active.push(o);
    return o;
  }

  release(o) {
    const i = o._pi;
    const last = this.active.pop();
    if (last !== o) {
      this.active[i] = last;
      last._pi = i;
    }
    this.free.push(o);
  }

  clear() {
    while (this.active.length) this.free.push(this.active.pop());
  }
}
