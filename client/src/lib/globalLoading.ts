type Listener = () => void;

let activeCount = 0;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function beginGlobalLoading() {
  activeCount += 1;
  notify();
}

export function endGlobalLoading() {
  activeCount = Math.max(0, activeCount - 1);
  notify();
}

export function getGlobalLoadingCount() {
  return activeCount;
}

export function subscribeGlobalLoading(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
