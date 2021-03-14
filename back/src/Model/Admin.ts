import { Group } from "./Group";
import { PointInterface } from "./Websocket/PointInterface";
import { Zone } from "_Model/Zone";
import { Movable } from "_Model/Movable";
import { PositionNotifier } from "_Model/PositionNotifier";
import { ServerDuplexStream } from "grpc";
import {
  BatchMessage,
  PusherToBackMessage,
  ServerToAdminClientMessage,
  ServerToClientMessage,
  SubMessage,
  UserJoinedRoomMessage,
  UserLeftRoomMessage,
} from "../Messages/generated/messages_pb";
import { CharacterLayer } from "_Model/Websocket/CharacterLayer";
import { AdminSocket } from "../RoomManager";

export class Admin {
  public constructor(private readonly socket: AdminSocket) {}

  public sendUserJoin(uuid: string, name: string, ip: string): void {
    const serverToAdminClientMessage = new ServerToAdminClientMessage();

    const userJoinedRoomMessage = new UserJoinedRoomMessage();
    userJoinedRoomMessage.uuid = uuid;
    userJoinedRoomMessage.name = name;
    userJoinedRoomMessage.ipAddress = ip;

    serverToAdminClientMessage.userJoinedRoom = userJoinedRoomMessage;

    this.socket.write(serverToAdminClientMessage);
  }

  public sendUserLeft(uuid: string /*, name: string, ip: string*/): void {
    const serverToAdminClientMessage = new ServerToAdminClientMessage();

    const userLeftRoomMessage = new UserLeftRoomMessage();
    userLeftRoomMessage.uuid = uuid;

    serverToAdminClientMessage.userLeftRoom = userLeftRoomMessage;

    this.socket.write(serverToAdminClientMessage);
  }
}
