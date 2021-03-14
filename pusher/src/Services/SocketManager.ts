import { PusherRoom } from "../Model/PusherRoom";
import {
  BackConnection,
  CharacterLayer,
  ExSocketInterface,
} from "../Model/Websocket/ExSocketInterface";
import {
  GroupDeleteMessage,
  ItemEventMessage,
  PlayGlobalMessage,
  PositionMessage,
  RoomJoinedMessage,
  ServerToClientMessage,
  SetPlayerDetailsMessage,
  SilentMessage,
  SubMessage,
  ReportPlayerMessage,
  UserLeftMessage,
  UserMovesMessage,
  ViewportMessage,
  WebRtcSignalToServerMessage,
  QueryJitsiJwtMessage,
  SendJitsiJwtMessage,
  JoinRoomMessage,
  CharacterLayerMessage,
  PusherToBackMessage,
  AdminPusherToBackMessage,
  ServerToAdminClientMessage,
  SendUserMessage,
  BanUserMessage,
  UserJoinedRoomMessage,
  UserLeftRoomMessage,
} from "../Messages/generated/messages_pb";
import { PointInterface } from "../Model/Websocket/PointInterface";
import { ProtobufUtils } from "../Model/Websocket/ProtobufUtils";
import { cpuTracker } from "./CpuTracker";
import {
  GROUP_RADIUS,
  JITSI_ISS,
  MINIMUM_DISTANCE,
  SECRET_JITSI_KEY,
} from "../Enum/EnvironmentVariable";
import { Movable } from "../Model/Movable";
import { PositionInterface } from "../Model/PositionInterface";
import { adminApi, CharacterTexture } from "./AdminApi";
import Direction = PositionMessage.Direction;
import { emitError, emitInBatch } from "./IoSocketHelpers";
import Jwt from "jsonwebtoken";
import { JITSI_URL } from "../Enum/EnvironmentVariable";
import { clientEventsEmitter } from "./ClientEventsEmitter";
import { gaugeManager } from "./GaugeManager";
import { apiClientRepository } from "./ApiClientRepository";
import { Server, ServiceError } from "@grpc/grpc-js";
import {
  GroupDescriptor,
  UserDescriptor,
  ZoneEventListener,
} from "_Model/Zone";
import Debug from "debug";
import {
  AdminConnection,
  ExAdminSocketInterface,
} from "_Model/Websocket/ExAdminSocketInterface";

const debug = Debug("socket");

interface AdminSocketRoomsList {
  [index: string]: number;
}
interface AdminSocketUsersList {
  [index: string]: boolean;
}

export interface AdminSocketData {
  rooms: AdminSocketRoomsList;
  users: AdminSocketUsersList;
}

export class SocketManager implements ZoneEventListener {
  private Worlds: Map<string, PusherRoom> = new Map<string, PusherRoom>();
  private sockets: Map<number, ExSocketInterface> = new Map<
    number,
    ExSocketInterface
  >();

  constructor() {
    clientEventsEmitter.registerToClientJoin(
      (clientUUid: string, roomId: string) => {
        gaugeManager.incNbClientPerRoomGauge(roomId);
      }
    );
    clientEventsEmitter.registerToClientLeave(
      (clientUUid: string, roomId: string) => {
        gaugeManager.decNbClientPerRoomGauge(roomId);
      }
    );
  }

  async handleAdminRoom(
    client: ExAdminSocketInterface,
    roomId: string
  ): Promise<void> {
    const apiClient = await apiClientRepository.getClient(roomId);
    const adminRoomStream = apiClient.adminRoom();
    client.adminConnection = adminRoomStream as AdminConnection;

    adminRoomStream
      .on("data", (message: ServerToAdminClientMessage) => {
        if (message.userJoinedRoom) {
          const userJoinedRoomMessage = message.userJoinedRoom as UserJoinedRoomMessage;
          if (!client.disconnecting) {
            client.send(
              JSON.stringify({
                type: "MemberJoin",
                data: {
                  uuid: userJoinedRoomMessage.uuid,
                  name: userJoinedRoomMessage.name,
                  ipAddress: userJoinedRoomMessage.ipAddress,
                  roomId: roomId,
                },
              })
            );
          }
        } else if (message.userLeftRoom) {
          const userLeftRoomMessage = message.userLeftRoom as UserLeftRoomMessage;
          if (!client.disconnecting) {
            client.send(
              JSON.stringify({
                type: "MemberLeave",
                data: {
                  uuid: userLeftRoomMessage.uuid,
                },
              })
            );
          }
        } else {
          throw new Error("Unexpected admin message");
        }
      })
      .on("end", () => {
        console.warn("Admin connection lost to back server");
        // Let's close the front connection if the back connection is closed. This way, we can retry connecting from the start.
        if (!client.disconnecting) {
          this.closeWebsocketConnection(
            client,
            1011,
            "Connection lost to back server"
          );
        }
        console.log("A user left");
      })
      .on("error", (err: Error) => {
        console.error("Error in connection to back server:", err);
        if (!client.disconnecting) {
          this.closeWebsocketConnection(
            client,
            1011,
            "Error while connecting to back server"
          );
        }
      });

    const message = new AdminPusherToBackMessage();
    message.subscribeToRoom = roomId;

    adminRoomStream.write(message);
  }

  leaveAdminRoom(socket: ExAdminSocketInterface) {
    if (socket.adminConnection) {
      socket.adminConnection.end();
    }
  }

  getAdminSocketDataFor(roomId: string): AdminSocketData {
    throw new Error("Not reimplemented yet");
    /*const data:AdminSocketData = {
            rooms: {},
            users: {},
        }
        const room = this.Worlds.get(roomId);
        if (room === undefined) {
            return data;
        }
        const users = room.getUsers();
        data.rooms[roomId] = users.size;
        users.forEach(user => {
            data.users[user.uuid] = true
        })
        return data;*/
  }

  async handleJoinRoom(client: ExSocketInterface): Promise<void> {
    const viewport = client.viewport;
    try {
      const joinRoomMessage = new JoinRoomMessage();
      joinRoomMessage.userUuid = client.userUuid;
      joinRoomMessage.IPAddress = client.IPAddress;
      joinRoomMessage.roomId = client.roomId;
      joinRoomMessage.name = client.name;
      joinRoomMessage.positionMessage = ProtobufUtils.toPositionMessage(
        client.position
      );
      joinRoomMessage.tag = client.tags;
      for (const characterLayer of client.characterLayers) {
        const characterLayerMessage = new CharacterLayerMessage();
        characterLayerMessage.name = characterLayer.name;
        if (characterLayer.url !== undefined) {
          characterLayerMessage.url = characterLayer.url;
        }

        joinRoomMessage.characterLayer.push(characterLayerMessage);
      }

      console.log("Calling joinRoom");
      const apiClient = await apiClientRepository.getClient(client.roomId);
      const streamToPusher = apiClient.joinRoom();
      clientEventsEmitter.emitClientJoin(client.userUuid, client.roomId);

      client.backConnection = streamToPusher as BackConnection;

      streamToPusher
        .on("data", (message: ServerToClientMessage) => {
          if (message.roomJoinedMessage) {
            client.userId = (message.roomJoinedMessage as RoomJoinedMessage).currentUserId;
            // TODO: do we need this.sockets anymore?
            this.sockets.set(client.userId, client);

            // If this is the first message sent, send back the viewport.
            this.handleViewport(client, viewport);
          }

          // Let's pass data over from the back to the client.
          if (!client.disconnecting) {
            client.send(ServerToClientMessage.encode(message).finish(), true);
          }
        })
        .on("end", () => {
          console.warn("Connection lost to back server");
          // Let's close the front connection if the back connection is closed. This way, we can retry connecting from the start.
          if (!client.disconnecting) {
            this.closeWebsocketConnection(
              client,
              1011,
              "Connection lost to back server"
            );
          }
          console.log("A user left");
        })
        .on("error", (err: Error) => {
          console.error("Error in connection to back server:", err);
          if (!client.disconnecting) {
            this.closeWebsocketConnection(
              client,
              1011,
              "Error while connecting to back server"
            );
          }
        });

      const pusherToBackMessage = new PusherToBackMessage();
      pusherToBackMessage.joinRoomMessage = joinRoomMessage;
      streamToPusher.write(pusherToBackMessage);
    } catch (e) {
      console.error('An error occurred on "join_room" event');
      console.error(e);
    }
  }

  private closeWebsocketConnection(
    client: ExSocketInterface | ExAdminSocketInterface,
    code: number,
    reason: string
  ) {
    client.disconnecting = true;
    //this.leaveRoom(client);
    //client.close();
    client.end(code, reason);
  }

  handleViewport(client: ExSocketInterface, viewport: any) {
    try {
      client.viewport = viewport;

      const world = this.Worlds.get(client.roomId);
      if (!world) {
        console.error(
          "In SET_VIEWPORT, could not find world with id '",
          client.roomId,
          "'"
        );
        return;
      }
      world.setViewport(client, client.viewport);
    } catch (e) {
      console.error('An error occurred on "SET_VIEWPORT" event');
      console.error(e);
    }
  }

  handleUserMovesMessage(
    client: ExSocketInterface,
    userMovesMessage: UserMovesMessage
  ) {
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.userMovesMessage = userMovesMessage;

    client.backConnection.write(pusherToBackMessage);

    const viewport = userMovesMessage.viewport;
    if (viewport === undefined) {
      throw new Error("Missing viewport in UserMovesMessage");
    }

    // Now, we need to listen to the correct viewport.
    this.handleViewport(client, viewport);
  }

  // Useless now, will be useful again if we allow editing details in game
  handleSetPlayerDetails(
    client: ExSocketInterface,
    playerDetailsMessage: SetPlayerDetailsMessage
  ) {
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.setPlayerDetailsMessage = playerDetailsMessage;

    client.backConnection.write(pusherToBackMessage);
  }

  handleSilentMessage(client: ExSocketInterface, silentMessage: SilentMessage) {
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.silentMessage = silentMessage;

    client.backConnection.write(pusherToBackMessage);
  }

  handleItemEvent(
    client: ExSocketInterface,
    itemEventMessage: ItemEventMessage
  ) {
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.itemEventMessage = itemEventMessage;

    client.backConnection.write(pusherToBackMessage);

    /*const itemEvent = ProtobufUtils.toItemEvent(itemEventMessage);

        try {
            const world = this.Worlds.get(ws.roomId);
            if (!world) {
                console.error("Could not find world with id '", ws.roomId, "'");
                return;
            }

            const subMessage = new SubMessage();
            subMessage.setItemeventmessage(itemEventMessage);

            // Let's send the event without using the SocketIO room.
            for (const user of world.getUsers().values()) {
                const client = this.searchClientByIdOrFail(user.id);
                //client.emit(SocketIoEvent.ITEM_EVENT, itemEvent);
                emitInBatch(client, subMessage);
            }

            world.setItemState(itemEvent.itemId, itemEvent.state);
        } catch (e) {
            console.error('An error occurred on "item_event"');
            console.error(e);
        }*/
  }

  async handleReportMessage(
    client: ExSocketInterface,
    reportPlayerMessage: ReportPlayerMessage
  ) {
    try {
      const reportedSocket = this.sockets.get(
        reportPlayerMessage.reportedUserId
      );
      if (!reportedSocket) {
        throw "reported socket user not found";
      }
      //TODO report user on admin application
      await adminApi.reportPlayer(
        reportedSocket.userUuid,
        reportPlayerMessage.reportComment,
        client.userUuid,
        client.roomId.split("/")[2]
      );
    } catch (e) {
      console.error('An error occurred on "handleReportMessage"');
      console.error(e);
    }
  }

  emitVideo(
    socket: ExSocketInterface,
    data: WebRtcSignalToServerMessage
  ): void {
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.webRtcSignalToServerMessage = data;

    socket.backConnection.write(pusherToBackMessage);

    //send only at user
    /*const client = this.sockets.get(data.getReceiverid());
        if (client === undefined) {
            console.warn("While exchanging a WebRTC signal: client with id ", data.getReceiverid(), " does not exist. This might be a race condition.");
            return;
        }

        const webrtcSignalToClient = new WebRtcSignalToClientMessage();
        webrtcSignalToClient.setUserid(socket.userId);
        webrtcSignalToClient.setSignal(data.getSignal());

        const serverToClientMessage = new ServerToClientMessage();
        serverToClientMessage.setWebrtcsignaltoclientmessage(webrtcSignalToClient);

        if (!client.disconnecting) {
            client.send(serverToClientMessage.serializeBinary().buffer, true);
        }*/
  }

  emitScreenSharing(
    socket: ExSocketInterface,
    data: WebRtcSignalToServerMessage
  ): void {
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.webRtcScreenSharingSignalToServerMessage = data;

    socket.backConnection.write(pusherToBackMessage);

    //send only at user
    /*const client = this.sockets.get(data.getReceiverid());
        if (client === undefined) {
            console.warn("While exchanging a WEBRTC_SCREEN_SHARING signal: client with id ", data.getReceiverid(), " does not exist. This might be a race condition.");
            return;
        }

        const webrtcSignalToClient = new WebRtcSignalToClientMessage();
        webrtcSignalToClient.setUserid(socket.userId);
        webrtcSignalToClient.setSignal(data.getSignal());

        const serverToClientMessage = new ServerToClientMessage();
        serverToClientMessage.setWebrtcscreensharingsignaltoclientmessage(webrtcSignalToClient);

        if (!client.disconnecting) {
            client.send(serverToClientMessage.serializeBinary().buffer, true);
        }*/
  }

  private searchClientByIdOrFail(userId: number): ExSocketInterface {
    const client: ExSocketInterface | undefined = this.sockets.get(userId);
    if (client === undefined) {
      throw new Error("Could not find user with id " + userId);
    }
    return client;
  }

  leaveRoom(socket: ExSocketInterface) {
    // leave previous room and world
    try {
      if (socket.roomId) {
        try {
          //user leaves room
          const room: PusherRoom | undefined = this.Worlds.get(socket.roomId);
          if (room) {
            debug("Leaving room %s.", socket.roomId);
            room.leave(socket);
            if (room.isEmpty()) {
              this.Worlds.delete(socket.roomId);
              debug("Room %s is empty. Deleting.", socket.roomId);
            }
          } else {
            console.error("Could not find the GameRoom the user is leaving!");
          }
          //user leave previous room
          //Client.leave(Client.roomId);
        } finally {
          //delete Client.roomId;
          this.sockets.delete(socket.userId);
          clientEventsEmitter.emitClientLeave(socket.userUuid, socket.roomId);
          console.log("A user left (", this.sockets.size, " connected users)");
        }
      }
    } finally {
      if (socket.backConnection) {
        socket.backConnection.end();
      }
    }
  }

  async getOrCreateRoom(roomId: string): Promise<PusherRoom> {
    //check and create new world for a room
    let world = this.Worlds.get(roomId);
    if (world === undefined) {
      world = new PusherRoom(
        roomId,
        this
        /*                (user: User, group: Group) => this.joinWebRtcRoom(user, group),
                (user: User, group: Group) => this.disConnectedUser(user, group),
                MINIMUM_DISTANCE,
                GROUP_RADIUS,
                (thing: Movable, listener: User) => this.onRoomEnter(thing, listener),
                (thing: Movable, position:PositionInterface, listener:User) => this.onClientMove(thing, position, listener),
                (thing: Movable, listener:User) => this.onClientLeave(thing, listener)*/
      );
      if (!world.anonymous) {
        const data = await adminApi.fetchMapDetails(
          world.organizationSlug,
          world.worldSlug,
          world.roomSlug
        );
        world.tags = data.tags;
        world.policyType = Number(data.policy_type);
      }
      this.Worlds.set(roomId, world);
    }
    return Promise.resolve(world);
  }

  /*    private joinRoom(client : ExSocketInterface, position: PointInterface): PusherRoom {

        const roomId = client.roomId;
        client.position = position;

        const world = this.Worlds.get(roomId)
        if(world === undefined){
            throw new Error('Could not find room for ID: '+client.roomId)
        }

        // Dispatch groups position to newly connected user
        world.getGroups().forEach((group: Group) => {
            this.emitCreateUpdateGroupEvent(client, group);
        });
        //join world
        world.join(client, client.position);
        clientEventsEmitter.emitClientJoin(client.userUuid, client.roomId);
        console.log(new Date().toISOString() + ' A user joined (', this.sockets.size, ' connected users)');
        return world;
    }

    private onClientMove(thing: Movable, position:PositionInterface, listener:User): void {
        const clientListener = this.searchClientByIdOrFail(listener.id);
        if (thing instanceof User) {
            const clientUser = this.searchClientByIdOrFail(thing.id);

            const userMovedMessage = new UserMovedMessage();
            userMovedMessage.setUserid(clientUser.userId);
            userMovedMessage.setPosition(ProtobufUtils.toPositionMessage(clientUser.position));

            const subMessage = new SubMessage();
            subMessage.setUsermovedmessage(userMovedMessage);

            clientListener.emitInBatch(subMessage);
            //console.log("Sending USER_MOVED event");
        } else if (thing instanceof Group) {
            this.emitCreateUpdateGroupEvent(clientListener, thing);
        } else {
            console.error('Unexpected type for Movable.');
        }
    }

    private onClientLeave(thing: Movable, listener:User) {
        const clientListener = this.searchClientByIdOrFail(listener.id);
        if (thing instanceof User) {
            const clientUser = this.searchClientByIdOrFail(thing.id);
            this.emitUserLeftEvent(clientListener, clientUser.userId);
        } else if (thing instanceof Group) {
            this.emitDeleteGroupEvent(clientListener, thing.getId());
        } else {
            console.error('Unexpected type for Movable.');
        }
    }*/

  emitPlayGlobalMessage(
    client: ExSocketInterface,
    playglobalmessage: PlayGlobalMessage
  ) {
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.playGlobalMessage = playglobalmessage;

    client.backConnection.write(pusherToBackMessage);
  }

  public getWorlds(): Map<string, PusherRoom> {
    return this.Worlds;
  }

  /**
   *
   * @param token
   */
  searchClientByUuid(uuid: string): ExSocketInterface | null {
    for (const socket of this.sockets.values()) {
      if (socket.userUuid === uuid) {
        return socket;
      }
    }
    return null;
  }

  public handleQueryJitsiJwtMessage(
    client: ExSocketInterface,
    queryJitsiJwtMessage: QueryJitsiJwtMessage
  ) {
    const room = queryJitsiJwtMessage.jitsiRoom;
    const tag = queryJitsiJwtMessage.tag; // FIXME: this is not secure. We should load the JSON for the current room and check rights associated to room instead.

    if (SECRET_JITSI_KEY === "") {
      throw new Error(
        "You must set the SECRET_JITSI_KEY key to the secret to generate JWT tokens for Jitsi."
      );
    }

    // Let's see if the current client has
    const isAdmin = client.tags.includes(tag);

    const jwt = Jwt.sign(
      {
        aud: "jitsi",
        iss: JITSI_ISS,
        sub: JITSI_URL,
        room: room,
        moderator: isAdmin,
      },
      SECRET_JITSI_KEY,
      {
        expiresIn: "1d",
        algorithm: "HS256",
        header: {
          alg: "HS256",
          typ: "JWT",
        },
      }
    );

    const sendJitsiJwtMessage = new SendJitsiJwtMessage();
    sendJitsiJwtMessage.jitsiRoom = room;
    sendJitsiJwtMessage.jwt = jwt;

    const serverToClientMessage = new ServerToClientMessage();
    serverToClientMessage.sendJitsiJwtMessage = sendJitsiJwtMessage;

    client.send(
      ServerToClientMessage.encode(serverToClientMessage).finish(),
      true
    );
  }

  public emitSendUserMessage(
    userUuid: string,
    message: string,
    type: string
  ): void {
    const client = this.searchClientByUuid(userUuid);
    if (!client) {
      throw Error("client not found");
    }

    const adminMessage = new SendUserMessage();
    adminMessage.message = message;
    adminMessage.type = type;
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.sendUserMessage = adminMessage;
    client.backConnection.write(pusherToBackMessage);

    /*const backConnection = await apiClientRepository.getClient(client.roomId);
        const adminMessage = new AdminMessage();
        adminMessage.setMessage(message);
        adminMessage.setRoomid(client.roomId);
        adminMessage.setRecipientuuid(client.userUuid);
        backConnection.sendAdminMessage(adminMessage, (error) => {
            if (error !== null) {
                console.error('Error while sending admin message', error);
            }
        });*/
  }

  public emitBan(userUuid: string, message: string, type: string): void {
    const client = this.searchClientByUuid(userUuid);
    if (!client) {
      throw Error("client not found");
    }

    const banUserMessage = new BanUserMessage();
    banUserMessage.message = message;
    banUserMessage.type = type;
    const pusherToBackMessage = new PusherToBackMessage();
    pusherToBackMessage.banUserMessage = banUserMessage;
    client.backConnection.write(pusherToBackMessage);

    /*const backConnection = await apiClientRepository.getClient(client.roomId);
        const adminMessage = new AdminMessage();
        adminMessage.setMessage(message);
        adminMessage.setRoomid(client.roomId);
        adminMessage.setRecipientuuid(client.userUuid);
        backConnection.sendAdminMessage(adminMessage, (error) => {
            if (error !== null) {
                console.error('Error while sending admin message', error);
            }
        });*/
  }

  /**
   * Merges the characterLayers received from the front (as an array of string) with the custom textures from the back.
   */
  static mergeCharacterLayersAndCustomTextures(
    characterLayers: string[],
    memberTextures: CharacterTexture[]
  ): CharacterLayer[] {
    const characterLayerObjs: CharacterLayer[] = [];
    for (const characterLayer of characterLayers) {
      if (characterLayer.startsWith("customCharacterTexture")) {
        const customCharacterLayerId: number = +characterLayer.substr(22);
        for (const memberTexture of memberTextures) {
          if (memberTexture.id == customCharacterLayerId) {
            characterLayerObjs.push({
              name: characterLayer,
              url: memberTexture.url,
            });
            break;
          }
        }
      } else {
        characterLayerObjs.push({
          name: characterLayer,
          url: undefined,
        });
      }
    }
    return characterLayerObjs;
  }

  public onUserEnters(user: UserDescriptor, listener: ExSocketInterface): void {
    const subMessage = new SubMessage();
    subMessage.userJoinedMessage = user.toUserJoinedMessage();

    emitInBatch(listener, subMessage);
  }

  public onUserMoves(user: UserDescriptor, listener: ExSocketInterface): void {
    const subMessage = new SubMessage();
    subMessage.userMovedMessage = user.toUserMovedMessage();

    emitInBatch(listener, subMessage);
  }

  public onUserLeaves(userId: number, listener: ExSocketInterface): void {
    const userLeftMessage = new UserLeftMessage();
    userLeftMessage.userId = userId;

    const subMessage = new SubMessage();
    subMessage.userLeftMessage = userLeftMessage;

    emitInBatch(listener, subMessage);
  }

  public onGroupEnters(
    group: GroupDescriptor,
    listener: ExSocketInterface
  ): void {
    const subMessage = new SubMessage();
    subMessage.groupUpdateMessage = group.toGroupUpdateMessage();

    emitInBatch(listener, subMessage);
  }

  public onGroupMoves(
    group: GroupDescriptor,
    listener: ExSocketInterface
  ): void {
    this.onGroupEnters(group, listener);
  }

  public onGroupLeaves(groupId: number, listener: ExSocketInterface): void {
    const groupDeleteMessage = new GroupDeleteMessage();
    groupDeleteMessage.groupId = groupId;

    const subMessage = new SubMessage();
    subMessage.groupDeleteMessage = groupDeleteMessage;

    emitInBatch(listener, subMessage);
  }
}

export const socketManager = new SocketManager();
