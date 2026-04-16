import WebSocket from "ws";

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
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(createMessage(type, payload));
  }

  broadcast(type, payload) {
    for (const socket of this.sockets) {
      this.send(socket, type, payload);
    }
  }
}

