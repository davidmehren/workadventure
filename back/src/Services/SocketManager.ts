import { GameRoom } from "../Model/GameRoom";
import { CharacterLayer } from "_Model/Websocket/CharacterLayer";
import {
  ItemEventMessage,
  ItemStateMessage,
  PlayGlobalMessage,
  PointMessage,
  RoomJoinedMessage,
  ServerToClientMessage,
  SilentMessage,
  SubMessage,
  UserMovedMessage,
  UserMovesMessage,
  WebRtcDisconnectMessage,
  WebRtcSignalToClientMessage,
  WebRtcSignalToServerMessage,
  WebRtcStartMessage,
  QueryJitsiJwtMessage,
  SendJitsiJwtMessage,
  SendUserMessage,
  JoinRoomMessage,
  Zone as ProtoZone,
  BatchToPusherMessage,
  SubToPusherMessage,
  UserJoinedZoneMessage,
  GroupUpdateZoneMessage,
  GroupLeftZoneMessage,
  UserLeftZoneMessage,
  BanUserMessage,
  ISendUserMessage,
  IBanUserMessage,
} from "../Messages/generated/messages_pb";
import { User, UserSocket } from "../Model/User";
import { ProtobufUtils } from "../Model/Websocket/ProtobufUtils";
import { Group } from "../Model/Group";
import { cpuTracker } from "./CpuTracker";
import {
  GROUP_RADIUS,
  JITSI_ISS,
  MINIMUM_DISTANCE,
  SECRET_JITSI_KEY,
  TURN_STATIC_AUTH_SECRET,
} from "../Enum/EnvironmentVariable";
import { Movable } from "../Model/Movable";
import { PositionInterface } from "../Model/PositionInterface";
import { adminApi, CharacterTexture } from "./AdminApi";
import Jwt from "jsonwebtoken";
import { JITSI_URL } from "../Enum/EnvironmentVariable";
import { clientEventsEmitter } from "./ClientEventsEmitter";
import { gaugeManager } from "./GaugeManager";
import { ZoneSocket } from "../RoomManager";
import { Zone } from "_Model/Zone";
import Debug from "debug";
import { Admin } from "_Model/Admin";
import crypto from "crypto";

const debug = Debug("sockermanager");

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

function emitZoneMessage(
  subMessage: SubToPusherMessage,
  socket: ZoneSocket
): void {
  // TODO: should we batch those every 100ms?
  const batchMessage = new BatchToPusherMessage();
  batchMessage.payload.push(subMessage);

  socket.write(batchMessage);
}

export class SocketManager {
  private rooms: Map<string, GameRoom> = new Map<string, GameRoom>();

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

  /*getAdminSocketDataFor(roomId:string): AdminSocketData {
        const data:AdminSocketData = {
            rooms: {},
            users: {},
        }
        const room = this.rooms.get(roomId);
        if (room === undefined) {
            return data;
        }
        const users = room.getUsers();
        data.rooms[roomId] = users.size;
        users.forEach(user => {
            data.users[user.uuid] = true
        })
        return data;
    }*/

  public async handleJoinRoom(
    socket: UserSocket,
    joinRoomMessage: JoinRoomMessage
  ): Promise<{ room: GameRoom; user: User }> {
    /*const positionMessage = joinRoomMessage.getPositionmessage();
        if (positionMessage === undefined) {
            // TODO: send error message?
            throw new Error('Empty pointMessage found in JoinRoomMessage');
        }*/

    //const position = ProtobufUtils.toPointInterface(positionMessage);
    //const viewport = client.viewport;

    //this.sockets.set(client.userId, client); //todo: should this be at the end of the function?

    //join new previous room
    const { room, user } = await this.joinRoom(socket, joinRoomMessage);

    //const things = room.setViewport(client, viewport);

    const roomJoinedMessage = new RoomJoinedMessage();
    roomJoinedMessage.tag = joinRoomMessage.tag;
    /*for (const thing of things) {
            if (thing instanceof User) {
                const player: ExSocketInterface|undefined = this.sockets.get(thing.id);
                if (player === undefined) {
                    console.warn('Something went wrong. The World contains a user "'+thing.id+"' but this user does not exist in the sockets list!");
                    continue;
                }

                const userJoinedMessage = new UserJoinedMessage();
                userJoinedMessage.setUserid(thing.id);
                userJoinedMessage.setName(player.name);
                userJoinedMessage.setCharacterlayersList(ProtobufUtils.toCharacterLayerMessages(player.characterLayers));
                userJoinedMessage.setPosition(ProtobufUtils.toPositionMessage(player.position));

                roomJoinedMessage.addUser(userJoinedMessage);
                roomJoinedMessage.setTagList(joinRoomMessage.getTagList());
            } else if (thing instanceof Group) {
                const groupUpdateMessage = new GroupUpdateMessage();
                groupUpdateMessage.setGroupid(thing.getId());
                groupUpdateMessage.setPosition(ProtobufUtils.toPointMessage(thing.getPosition()));

                roomJoinedMessage.addGroup(groupUpdateMessage);
            } else {
                console.error("Unexpected type for Movable returned by setViewport");
            }
        }*/

    for (const [itemId, item] of room.getItemsState().entries()) {
      const itemStateMessage = new ItemStateMessage();
      itemStateMessage.itemId = itemId;
      itemStateMessage.stateJson = JSON.stringify(item);

      roomJoinedMessage.item.push(itemStateMessage);
    }

    roomJoinedMessage.currentUserId = user.id;

    const serverToClientMessage = new ServerToClientMessage();
    serverToClientMessage.roomJoinedMessage = roomJoinedMessage;

    //user.socket.write(serverToClientMessage);
    console.log("SENDING MESSAGE roomJoinedMessage");
    socket.write(serverToClientMessage);

    return {
      room,
      user,
    };

    /*const serverToClientMessage = new ServerToClientMessage();
        serverToClientMessage.setRoomjoinedmessage(roomJoinedMessage);

        if (!client.disconnecting) {
            client.send(serverToClientMessage.serializeBinary().buffer, true);
        }*/
  }

  handleUserMovesMessage(
    room: GameRoom,
    user: User,
    userMovesMessage: UserMovesMessage
  ) {
    try {
      const userMoves = userMovesMessage;
      const position = userMovesMessage.position;

      // If CPU is high, let's drop messages of users moving (we will only dispatch the final position)
      if (cpuTracker.isOverHeating() && userMoves.position?.moving === true) {
        return;
      }

      if (position === undefined || position === null) {
        throw new Error("Position not found in message");
      }
      const viewport = userMoves.viewport;
      if (viewport === undefined) {
        throw new Error("Viewport not found in message");
      }

      // sending to all clients in room except sender
      /*client.position = {
                x: position.x,
                y: position.y,
                direction,
                moving: position.moving,
            };
            client.viewport = viewport;*/

      // update position in the world
      room.updatePosition(user, ProtobufUtils.toPointInterface(position));
      //room.setViewport(client, client.viewport);
    } catch (e) {
      console.error('An error occurred on "user_position" event');
      console.error(e);
    }
  }

  // Useless now, will be useful again if we allow editing details in game
  /*handleSetPlayerDetails(client: UserSocket, playerDetailsMessage: SetPlayerDetailsMessage) {
        const playerDetails = {
            name: playerDetailsMessage.getName(),
            characterLayers: playerDetailsMessage.getCharacterlayersList()
        };
        //console.log(SocketIoEvent.SET_PLAYER_DETAILS, playerDetails);
        if (!isSetPlayerDetailsMessage(playerDetails)) {
            emitError(client, 'Invalid SET_PLAYER_DETAILS message received: ');
            return;
        }
        client.name = playerDetails.name;
        client.characterLayers = SocketManager.mergeCharacterLayersAndCustomTextures(playerDetails.characterLayers, client.textures);
    }*/

  handleSilentMessage(
    room: GameRoom,
    user: User,
    silentMessage: SilentMessage
  ) {
    try {
      room.setSilent(user, silentMessage.silent);
    } catch (e) {
      console.error('An error occurred on "handleSilentMessage"');
      console.error(e);
    }
  }

  handleItemEvent(
    room: GameRoom,
    user: User,
    itemEventMessage: ItemEventMessage
  ) {
    const itemEvent = ProtobufUtils.toItemEvent(itemEventMessage);

    try {
      const subMessage = new SubMessage();
      subMessage.itemEventMessage = itemEventMessage;

      // Let's send the event without using the SocketIO room.
      // TODO: move this in the GameRoom class.
      for (const user of room.getUsers().values()) {
        user.emitInBatch(subMessage);
      }

      room.setItemState(itemEvent.itemId, itemEvent.state);
    } catch (e) {
      console.error('An error occurred on "item_event"');
      console.error(e);
    }
  }

  // TODO: handle this message in pusher
  /*async handleReportMessage(client: ExSocketInterface, reportPlayerMessage: ReportPlayerMessage) {
        try {
            const reportedSocket = this.sockets.get(reportPlayerMessage.getReporteduserid());
            if (!reportedSocket) {
                throw 'reported socket user not found';
            }
            //TODO report user on admin application
            await adminApi.reportPlayer(reportedSocket.userUuid, reportPlayerMessage.getReportcomment(),  client.userUuid)
        } catch (e) {
            console.error('An error occurred on "handleReportMessage"');
            console.error(e);
        }
    }*/

  emitVideo(
    room: GameRoom,
    user: User,
    data: WebRtcSignalToServerMessage
  ): void {
    //send only at user
    const remoteUser = room.getUsers().get(data.receiverId);
    if (remoteUser === undefined) {
      console.warn(
        "While exchanging a WebRTC signal: client with id ",
        data.receiverId,
        " does not exist. This might be a race condition."
      );
      return;
    }

    const webrtcSignalToClient = new WebRtcSignalToClientMessage();
    webrtcSignalToClient.userId = user.id;
    webrtcSignalToClient.signal = data.signal;
    // TODO: only compute credentials if data.signal.type === "offer"
    if (TURN_STATIC_AUTH_SECRET !== "") {
      const { username, password } = this.getTURNCredentials(
        "" + user.id,
        TURN_STATIC_AUTH_SECRET
      );
      webrtcSignalToClient.webrtcUserName = username;
      webrtcSignalToClient.webrtcPassword = password;
    }

    const serverToClientMessage = new ServerToClientMessage();
    serverToClientMessage.webRtcSignalToClientMessage = webrtcSignalToClient;

    //if (!client.disconnecting) {
    remoteUser.socket.write(serverToClientMessage);
    //}
  }

  emitScreenSharing(
    room: GameRoom,
    user: User,
    data: WebRtcSignalToServerMessage
  ): void {
    //send only at user
    const remoteUser = room.getUsers().get(data.receiverId);
    if (remoteUser === undefined) {
      console.warn(
        "While exchanging a WEBRTC_SCREEN_SHARING signal: client with id ",
        data.receiverId,
        " does not exist. This might be a race condition."
      );
      return;
    }

    const webrtcSignalToClient = new WebRtcSignalToClientMessage();
    webrtcSignalToClient.userId = user.id;
    webrtcSignalToClient.signal = data.signal;
    // TODO: only compute credentials if data.signal.type === "offer"
    if (TURN_STATIC_AUTH_SECRET !== "") {
      const { username, password } = this.getTURNCredentials(
        "" + user.id,
        TURN_STATIC_AUTH_SECRET
      );
      webrtcSignalToClient.webrtcUserName = username;
      webrtcSignalToClient.webrtcPassword = password;
    }

    const serverToClientMessage = new ServerToClientMessage();
    serverToClientMessage.webRtcScreenSharingSignalToClientMessage = webrtcSignalToClient;

    //if (!client.disconnecting) {
    remoteUser.socket.write(serverToClientMessage);
    //}
  }

  leaveRoom(room: GameRoom, user: User) {
    // leave previous room and world
    try {
      //user leave previous world
      room.leave(user);
      if (room.isEmpty()) {
        this.rooms.delete(room.roomId);
        gaugeManager.decNbRoomGauge();
        debug('Room is empty. Deleting room "%s"', room.roomId);
      }
    } finally {
      //delete Client.roomId;
      //this.sockets.delete(Client.userId);
      clientEventsEmitter.emitClientLeave(user.uuid, room.roomId);
      console.log("A user left");
    }
  }

  async getOrCreateRoom(roomId: string): Promise<GameRoom> {
    //check and create new world for a room
    let world = this.rooms.get(roomId);
    if (world === undefined) {
      world = new GameRoom(
        roomId,
        (user: User, group: Group) => this.joinWebRtcRoom(user, group),
        (user: User, group: Group) => this.disConnectedUser(user, group),
        MINIMUM_DISTANCE,
        GROUP_RADIUS,
        (thing: Movable, fromZone: Zone | null, listener: ZoneSocket) =>
          this.onZoneEnter(thing, fromZone, listener),
        (thing: Movable, position: PositionInterface, listener: ZoneSocket) =>
          this.onClientMove(thing, position, listener),
        (thing: Movable, newZone: Zone | null, listener: ZoneSocket) =>
          this.onClientLeave(thing, newZone, listener)
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
      gaugeManager.incNbRoomGauge();
      this.rooms.set(roomId, world);
    }
    return Promise.resolve(world);
  }

  private async joinRoom(
    socket: UserSocket,
    joinRoomMessage: JoinRoomMessage
  ): Promise<{ room: GameRoom; user: User }> {
    const roomId = joinRoomMessage.roomId;

    const world = await socketManager.getOrCreateRoom(roomId);

    // Dispatch groups position to newly connected user
    /*world.getGroups().forEach((group: Group) => {
            this.emitCreateUpdateGroupEvent(socket, group);
        });*/

    //join world
    const user = world.join(socket, joinRoomMessage);

    clientEventsEmitter.emitClientJoin(user.uuid, roomId);
    //console.log(new Date().toISOString() + ' A user joined (', this.sockets.size, ' connected users)');
    console.log(new Date().toISOString() + " A user joined");
    return { room: world, user };
  }

  private onZoneEnter(
    thing: Movable,
    fromZone: Zone | null,
    listener: ZoneSocket
  ) {
    if (thing instanceof User) {
      const userJoinedZoneMessage = new UserJoinedZoneMessage();
      if (!Number.isInteger(thing.id)) {
        throw new Error("clientUser.userId is not an integer " + thing.id);
      }
      userJoinedZoneMessage.userId = thing.id;
      userJoinedZoneMessage.name = thing.name;
      userJoinedZoneMessage.characterLayers = ProtobufUtils.toCharacterLayerMessages(
        thing.characterLayers
      );
      userJoinedZoneMessage.position = ProtobufUtils.toPositionMessage(
        thing.getPosition()
      );
      userJoinedZoneMessage.fromZone = this.toProtoZone(fromZone);

      const subMessage = new SubToPusherMessage();
      subMessage.userJoinedZoneMessage = userJoinedZoneMessage;

      emitZoneMessage(subMessage, listener);
      //listener.emitInBatch(subMessage);
    } else if (thing instanceof Group) {
      this.emitCreateUpdateGroupEvent(listener, fromZone, thing);
    } else {
      console.error("Unexpected type for Movable.");
    }
  }

  private onClientMove(
    thing: Movable,
    position: PositionInterface,
    listener: ZoneSocket
  ): void {
    if (thing instanceof User) {
      const userMovedMessage = new UserMovedMessage();
      userMovedMessage.userId = thing.id;
      userMovedMessage.position = ProtobufUtils.toPositionMessage(
        thing.getPosition()
      );

      const subMessage = new SubToPusherMessage();
      subMessage.userMovedMessage = userMovedMessage;

      emitZoneMessage(subMessage, listener);
      //listener.emitInBatch(subMessage);
      //console.log("Sending USER_MOVED event");
    } else if (thing instanceof Group) {
      this.emitCreateUpdateGroupEvent(listener, null, thing);
    } else {
      console.error("Unexpected type for Movable.");
    }
  }

  private onClientLeave(
    thing: Movable,
    newZone: Zone | null,
    listener: ZoneSocket
  ) {
    if (thing instanceof User) {
      this.emitUserLeftEvent(listener, thing.id, newZone);
    } else if (thing instanceof Group) {
      this.emitDeleteGroupEvent(listener, thing.getId(), newZone);
    } else {
      console.error("Unexpected type for Movable.");
    }
  }

  private emitCreateUpdateGroupEvent(
    client: ZoneSocket,
    fromZone: Zone | null,
    group: Group
  ): void {
    const position = group.getPosition();
    const pointMessage = new PointMessage();
    pointMessage.x = Math.floor(position.x);
    pointMessage.y = Math.floor(position.y);
    const groupUpdateMessage = new GroupUpdateZoneMessage();
    groupUpdateMessage.groupId = group.getId();
    groupUpdateMessage.position = pointMessage;
    groupUpdateMessage.groupSize = group.getSize;
    groupUpdateMessage.fromZone = this.toProtoZone(fromZone);

    const subMessage = new SubToPusherMessage();
    subMessage.groupUpdateZoneMessage = groupUpdateMessage;

    emitZoneMessage(subMessage, client);
    //client.emitInBatch(subMessage);
  }

  private emitDeleteGroupEvent(
    client: ZoneSocket,
    groupId: number,
    newZone: Zone | null
  ): void {
    const groupDeleteMessage = new GroupLeftZoneMessage();
    groupDeleteMessage.groupId = groupId;
    groupDeleteMessage.toZone = this.toProtoZone(newZone);

    const subMessage = new SubToPusherMessage();
    subMessage.groupLeftZoneMessage = groupDeleteMessage;

    emitZoneMessage(subMessage, client);
    //user.emitInBatch(subMessage);
  }

  private emitUserLeftEvent(
    client: ZoneSocket,
    userId: number,
    newZone: Zone | null
  ): void {
    const userLeftMessage = new UserLeftZoneMessage();
    userLeftMessage.userId = userId;
    userLeftMessage.toZone = this.toProtoZone(newZone);

    const subMessage = new SubToPusherMessage();
    subMessage.userLeftZoneMessage = userLeftMessage;

    emitZoneMessage(subMessage, client);
  }

  private toProtoZone(zone: Zone | null): ProtoZone | undefined {
    if (zone !== null) {
      const zoneMessage = new ProtoZone();
      zoneMessage.x = zone.x;
      zoneMessage.y = zone.y;
      return zoneMessage;
    }
    return undefined;
  }

  private joinWebRtcRoom(user: User, group: Group) {
    /*const roomId: string = "webrtcroom"+group.getId();
        if (user.socket.webRtcRoomId === roomId) {
            return;
        }*/

    for (const otherUser of group.getUsers()) {
      if (user === otherUser) {
        continue;
      }

      // Let's send 2 messages: one to the user joining the group and one to the other user
      const webrtcStartMessage1 = new WebRtcStartMessage();
      webrtcStartMessage1.userId = otherUser.id;
      webrtcStartMessage1.name = otherUser.name;
      webrtcStartMessage1.initiator = true;
      if (TURN_STATIC_AUTH_SECRET !== "") {
        const { username, password } = this.getTURNCredentials(
          "" + otherUser.id,
          TURN_STATIC_AUTH_SECRET
        );
        webrtcStartMessage1.webrtcUserName = username;
        webrtcStartMessage1.webrtcPassword = password;
      }

      const serverToClientMessage1 = new ServerToClientMessage();
      serverToClientMessage1.webRtcStartMessage = webrtcStartMessage1;

      //if (!user.socket.disconnecting) {
      user.socket.write(serverToClientMessage1);
      //console.log('Sending webrtcstart initiator to '+user.socket.userId)
      //}

      const webrtcStartMessage2 = new WebRtcStartMessage();
      webrtcStartMessage2.userId = user.id;
      webrtcStartMessage2.name = user.name;
      webrtcStartMessage2.initiator = false;
      if (TURN_STATIC_AUTH_SECRET !== "") {
        const { username, password } = this.getTURNCredentials(
          "" + user.id,
          TURN_STATIC_AUTH_SECRET
        );
        webrtcStartMessage2.webrtcUserName = username;
        webrtcStartMessage2.webrtcPassword = password;
      }

      const serverToClientMessage2 = new ServerToClientMessage();
      serverToClientMessage2.webRtcStartMessage = webrtcStartMessage2;

      //if (!otherUser.socket.disconnecting) {
      otherUser.socket.write(serverToClientMessage2);
      //console.log('Sending webrtcstart to '+otherUser.socket.userId)
      //}
    }
  }

  /**
   * Computes a unique user/password for the TURN server, using a shared secret between the WorkAdventure API server
   * and the Coturn server.
   * The Coturn server should be initialized with parameters: `--use-auth-secret --static-auth-secret=MySecretKey`
   */
  private getTURNCredentials(
    name: string,
    secret: string
  ): { username: string; password: string } {
    const unixTimeStamp = Math.floor(Date.now() / 1000) + 4 * 3600; // this credential would be valid for the next 4 hours
    const username = [unixTimeStamp, name].join(":");
    const hmac = crypto.createHmac("sha1", secret);
    hmac.setEncoding("base64");
    hmac.write(username);
    hmac.end();
    const password = hmac.read();
    return {
      username: username,
      password: password,
    };
  }

  //disconnect user
  private disConnectedUser(user: User, group: Group) {
    // Most of the time, sending a disconnect event to one of the players is enough (the player will close the connection
    // which will be shut for the other player).
    // However! In the rare case where the WebRTC connection is not yet established, if we close the connection on one of the player,
    // the other player will try connecting until a timeout happens (during this time, the connection icon will be displayed for nothing).
    // So we also send the disconnect event to the other player.
    for (const otherUser of group.getUsers()) {
      if (user === otherUser) {
        continue;
      }

      const webrtcDisconnectMessage1 = new WebRtcDisconnectMessage();
      webrtcDisconnectMessage1.userId = user.id;

      const serverToClientMessage1 = new ServerToClientMessage();
      serverToClientMessage1.webRtcDisconnectMessage = webrtcDisconnectMessage1;

      //if (!otherUser.socket.disconnecting) {
      otherUser.socket.write(serverToClientMessage1);
      //}

      const webrtcDisconnectMessage2 = new WebRtcDisconnectMessage();
      webrtcDisconnectMessage2.userId = otherUser.id;

      const serverToClientMessage2 = new ServerToClientMessage();
      serverToClientMessage2.webRtcDisconnectMessage = webrtcDisconnectMessage2;

      //if (!user.socket.disconnecting) {
      user.socket.write(serverToClientMessage2);
      //}
    }
  }

  emitPlayGlobalMessage(room: GameRoom, playGlobalMessage: PlayGlobalMessage) {
    try {
      const serverToClientMessage = new ServerToClientMessage();
      serverToClientMessage.playGlobalMessage = playGlobalMessage;

      for (const [id, user] of room.getUsers().entries()) {
        user.socket.write(serverToClientMessage);
      }
    } catch (e) {
      console.error('An error occurred on "emitPlayGlobalMessage" event');
      console.error(e);
    }
  }

  public getWorlds(): Map<string, GameRoom> {
    return this.rooms;
  }

  /**
   *
   * @param token
   */
  /*searchClientByUuid(uuid: string): ExSocketInterface | null {
        for(const socket of this.sockets.values()){
            if(socket.userUuid === uuid){
                return socket;
            }
        }
        return null;
    }*/

  public handleQueryJitsiJwtMessage(
    user: User,
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
    const isAdmin = user.tags.includes(tag);

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

    user.socket.write(serverToClientMessage);
  }

  public handlerSendUserMessage(
    user: User,
    sendUserMessageToSend: ISendUserMessage
  ) {
    if (
      typeof sendUserMessageToSend.message !== "string" ||
      typeof sendUserMessageToSend.type !== "string"
    ) {
      throw new TypeError();
    }
    const sendUserMessage = new SendUserMessage();
    sendUserMessage.message = sendUserMessageToSend.message;
    sendUserMessage.type = sendUserMessageToSend.type;

    const serverToClientMessage = new ServerToClientMessage();
    serverToClientMessage.sendUserMessage = sendUserMessage;
    user.socket.write(serverToClientMessage);
  }

  public handlerBanUserMessage(
    room: GameRoom,
    user: User,
    banUserMessageToSend: IBanUserMessage
  ) {
    if (
      typeof banUserMessageToSend.message !== "string" ||
      typeof banUserMessageToSend.type !== "string"
    ) {
      throw new TypeError();
    }
    const banUserMessage = new BanUserMessage();
    banUserMessage.message = banUserMessageToSend.message;
    banUserMessage.type = banUserMessageToSend.type;

    const serverToClientMessage = new ServerToClientMessage();
    serverToClientMessage.sendUserMessage = banUserMessage;
    user.socket.write(serverToClientMessage);

    setTimeout(() => {
      // Let's leave the room now.
      room.leave(user);
      // Let's close the connection when the user is banned.
      user.socket.end();
    }, 10000);
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

  public addZoneListener(
    call: ZoneSocket,
    roomId: string,
    x: number,
    y: number
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.error(
        "In addZoneListener, could not find room with id '" + roomId + "'"
      );
      return;
    }

    const things = room.addZoneListener(call, x, y);

    const batchMessage = new BatchToPusherMessage();

    for (const thing of things) {
      if (thing instanceof User) {
        const userJoinedMessage = new UserJoinedZoneMessage();
        userJoinedMessage.userId = thing.id;
        userJoinedMessage.name = thing.name;
        userJoinedMessage.characterLayers = ProtobufUtils.toCharacterLayerMessages(
          thing.characterLayers
        );
        userJoinedMessage.position = ProtobufUtils.toPositionMessage(
          thing.getPosition()
        );

        const subMessage = new SubToPusherMessage();
        subMessage.userJoinedZoneMessage = userJoinedMessage;

        batchMessage.payload.push(subMessage);
      } else if (thing instanceof Group) {
        const groupUpdateMessage = new GroupUpdateZoneMessage();
        groupUpdateMessage.groupId = thing.getId();
        groupUpdateMessage.position = ProtobufUtils.toPointMessage(
          thing.getPosition()
        );

        const subMessage = new SubToPusherMessage();
        subMessage.groupUpdateZoneMessage = groupUpdateMessage;

        batchMessage.payload.push(subMessage);
      } else {
        console.error("Unexpected type for Movable returned by setViewport");
      }
    }

    call.write(batchMessage);
  }

  removeZoneListener(call: ZoneSocket, roomId: string, x: number, y: number) {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.error(
        "In removeZoneListener, could not find room with id '" + roomId + "'"
      );
      return;
    }

    room.removeZoneListener(call, x, y);
  }

  public async handleJoinAdminRoom(
    admin: Admin,
    roomId: string
  ): Promise<GameRoom> {
    const room = await socketManager.getOrCreateRoom(roomId);

    // Dispatch groups position to newly connected user
    /*world.getGroups().forEach((group: Group) => {
            this.emitCreateUpdateGroupEvent(socket, group);
        });*/

    room.adminJoin(admin);

    return room;
  }

  public leaveAdminRoom(room: GameRoom, admin: Admin) {
    room.adminLeave(admin);
    if (room.isEmpty()) {
      this.rooms.delete(room.roomId);
      gaugeManager.decNbRoomGauge();
      debug('Room is empty. Deleting room "%s"', room.roomId);
    }
  }

  public sendAdminMessage(
    roomId: string,
    recipientUuid: string,
    message: string
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.error(
        "In sendAdminMessage, could not find room with id '" +
          roomId +
          "'. Maybe the room was closed a few milliseconds ago and there was a race condition?"
      );
      return;
    }

    const recipient = room.getUserByUuid(recipientUuid);
    if (recipient === undefined) {
      console.error(
        "In sendAdminMessage, could not find user with id '" +
          recipientUuid +
          "'. Maybe the user left the room a few milliseconds ago and there was a race condition?"
      );
      return;
    }

    const sendUserMessage = new SendUserMessage();
    sendUserMessage.message = message;
    sendUserMessage.type = "ban";

    const subToPusherMessage = new SubToPusherMessage();
    subToPusherMessage.sendUserMessage = sendUserMessage;

    recipient.socket.write(subToPusherMessage);
  }

  public banUser(roomId: string, recipientUuid: string, message: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.error(
        "In banUser, could not find room with id '" +
          roomId +
          "'. Maybe the room was closed a few milliseconds ago and there was a race condition?"
      );
      return;
    }

    const recipient = room.getUserByUuid(recipientUuid);
    if (recipient === undefined) {
      console.error(
        "In banUser, could not find user with id '" +
          recipientUuid +
          "'. Maybe the user left the room a few milliseconds ago and there was a race condition?"
      );
      return;
    }

    // Let's leave the room now.
    room.leave(recipient);

    const sendUserMessage = new SendUserMessage();
    sendUserMessage.message = message;
    sendUserMessage.type = "banned";

    const subToPusherMessage = new SubToPusherMessage();
    subToPusherMessage.sendUserMessage = sendUserMessage;

    recipient.socket.write(subToPusherMessage);

    // Let's close the connection when the user is banned.
    recipient.socket.end();
  }
}

export const socketManager = new SocketManager();
