// Tiny pub/sub. Systems talk through events instead of importing each other.
export class Events {
  constructor() { this.map = new Map(); }

  on(name, fn) {
    let list = this.map.get(name);
    if (!list) this.map.set(name, (list = []));
    list.push(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const list = this.map.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(name, a, b, c) {
    const list = this.map.get(name);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](a, b, c);
  }
}
