import {
  AdminPusherToBackMessage,
  ServerToAdminClientMessage,
} from "../../Messages/generated/messages_pb";
import { WebSocket } from "uWebSockets.js";
import { ClientDuplexStream } from "grpc";

export type AdminConnection = ClientDuplexStream<
  AdminPusherToBackMessage,
  ServerToAdminClientMessage
>;

export interface ExAdminSocketInterface extends WebSocket {
  adminConnection: AdminConnection;
  disconnecting: boolean;
}
