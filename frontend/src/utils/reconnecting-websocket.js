const RETRY_DELAYS = [500, 1000, 2000, 5000, 5000, 5000, 5000, 5000];

export class ReconnectingWebSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    this.socket = null;
    this.stopped = false;
    this.retryCount = 0;
    this.retryTimer = null;
    this.stableTimer = null;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    this.readyState = WebSocket.CONNECTING;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.readyState = WebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      window.clearTimeout(this.stableTimer);
      this.stableTimer = window.setTimeout(() => {
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) this.retryCount = 0;
      }, 5000);
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || this.stopped) return;
      this.dispatchEvent(new MessageEvent('message', { data: event.data }));
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket && !this.stopped) this.dispatchEvent(new Event('error'));
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      window.clearTimeout(this.stableTimer);
      this.readyState = WebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent('close', { code: event.code, reason: event.reason, wasClean: event.wasClean }));
      if (this.stopped || this.retryCount >= RETRY_DELAYS.length) return;
      const delay = RETRY_DELAYS[this.retryCount];
      this.retryCount += 1;
      this.readyState = WebSocket.CONNECTING;
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    });
  }

  send(data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    }
    this.socket.send(data);
  }

  close(code, reason) {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.stableTimer);
    this.readyState = WebSocket.CLOSING;
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close(code, reason);
    this.readyState = WebSocket.CLOSED;
  }
}

export function createReconnectingWebSocket(url) {
  return new ReconnectingWebSocket(url);
}
