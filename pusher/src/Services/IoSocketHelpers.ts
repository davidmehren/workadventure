import { ExSocketInterface } from "_Model/Websocket/ExSocketInterface";

export function emitInBatch(
  socket: ExSocketInterface,
  payload: SubMessage
): void {
  socket.batchedMessages.payload.push(payload);

  if (socket.batchTimeout === null) {
    socket.batchTimeout = setTimeout(() => {
      if (socket.disconnecting) {
        return;
      }

      const serverToClientMessage = new ServerToClientMessage();
      serverToClientMessage.batchMessage = socket.batchedMessages;

      socket.send(
        ServerToClientMessage.encode(serverToClientMessage).finish(),
        true
      );
      socket.batchedMessages = new BatchMessage();
      socket.batchTimeout = null;
    }, 100);
  }
}

export function emitError(Client: ExSocketInterface, message: string): void {
  const errorMessage = new ErrorMessage();
  errorMessage.message = message;

  const serverToClientMessage = new ServerToClientMessage();
  serverToClientMessage.errorMessage = errorMessage;

  if (!Client.disconnecting) {
    Client.send(
      ServerToClientMessage.encode(serverToClientMessage).finish(),
      true
    );
  }
  console.warn(message);
}
