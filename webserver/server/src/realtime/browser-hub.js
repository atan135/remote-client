import WebSocket from "ws";

const MAX_BROWSER_SOCKET_BUFFER_BYTES = 4 * 1024 * 1024;

function createMessage(type, payload) {
  return JSON.stringify({
    type,
    payload,
    sentAt: new Date().toISOString()
  });
}

export class BrowserHub {
  constructor() {
    this.sockets = new Set();
  }

  add(socket) {
    this.sockets.add(socket);
  }

  remove(socket) {
    this.sockets.delete(socket);
  }

  send(socket, type, payload) {
    this.sendRaw(socket, createMessage(type, payload));
  }

  broadcast(type, payload) {
    const message = createMessage(type, payload);

    for (const socket of this.sockets) {
      this.sendRaw(socket, message);
    }
  }

  sendRaw(socket, message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.remove(socket);
      return;
    }

    if (Number(socket.bufferedAmount || 0) > MAX_BROWSER_SOCKET_BUFFER_BYTES) {
      this.drop(socket);
      return;
    }

    try {
      socket.send(message);
    } catch {
      this.drop(socket);
    }
  }

  drop(socket) {
    this.remove(socket);

    try {
      socket.terminate();
    } catch {}
  }
}
