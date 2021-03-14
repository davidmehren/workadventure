import {
  ErrorMessage,
  ServerToClientMessage,
} from "../Messages/generated/messages_pb";
import { UserSocket } from "_Model/User";

export function emitError(Client: UserSocket, message: string): void {
  const errorMessage = new ErrorMessage();
  errorMessage.message = message;

  const serverToClientMessage = new ServerToClientMessage();
  serverToClientMessage.errorMessage = errorMessage;

  //if (!Client.disconnecting) {
  Client.write(serverToClientMessage);
  //}
  console.warn(message);
}
