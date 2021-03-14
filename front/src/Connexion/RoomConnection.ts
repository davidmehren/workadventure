import { API_URL, UPLOADER_URL } from "../Enum/EnvironmentVariable";
import Axios from "axios";
import {
  BatchMessage,
  ClientToServerMessage,
  GroupDeleteMessage,
  GroupUpdateMessage,
  ItemEventMessage,
  PlayGlobalMessage,
  PositionMessage,
  RoomJoinedMessage,
  ServerToClientMessage,
  SetPlayerDetailsMessage,
  SilentMessage,
  StopGlobalMessage,
  UserJoinedMessage,
  UserLeftMessage,
  UserMovedMessage,
  UserMovesMessage,
  ViewportMessage,
  WebRtcDisconnectMessage,
  WebRtcSignalToClientMessage,
  WebRtcSignalToServerMessage,
  WebRtcStartMessage,
  ReportPlayerMessage,
  TeleportMessageMessage,
  QueryJitsiJwtMessage,
  SendJitsiJwtMessage,
  ICharacterLayerMessage,
  PingMessage,
  SendUserMessage,
} from "../Messages/generated/messages_pb";

import { UserSimplePeerInterface } from "../WebRtc/SimplePeer";
import Direction = PositionMessage.Direction;
import { ProtobufClientUtils } from "../Network/ProtobufClientUtils";
import {
  EventMessage,
  GroupCreatedUpdatedMessageInterface,
  ItemEventMessageInterface,
  MessageUserJoined,
  OnConnectInterface,
  PlayGlobalMessageInterface,
  PointInterface,
  PositionInterface,
  RoomJoinedMessageInterface,
  ViewportInterface,
  WebRtcDisconnectMessageInterface,
  WebRtcSignalReceivedMessageInterface,
} from "./ConnexionModels";
import { BodyResourceDescriptionInterface } from "../Phaser/Entity/PlayerTextures";

const manualPingDelay = 20000;

export class RoomConnection implements RoomConnection {
  private readonly socket: WebSocket;
  private userId: number | null = null;
  private listeners: Map<string, Function[]> = new Map<string, Function[]>();
  private static websocketFactory: null | ((url: string) => any) = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private closed: boolean = false;
  private tags: string[] = [];

  public static setWebsocketFactory(
    websocketFactory: (url: string) => any
  ): void {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    RoomConnection.websocketFactory = websocketFactory;
  }

  /**
   *
   * @param token A JWT token containing the UUID of the user
   * @param roomId The ID of the room in the form "_/[instance]/[map_url]" or "@/[org]/[event]/[map]"
   */
  public constructor(
    token: string | null,
    roomId: string,
    name: string,
    characterLayers: string[],
    position: PositionInterface,
    viewport: ViewportInterface
  ) {
    let url = API_URL.replace("http://", "ws://").replace("https://", "wss://");
    url += "/room";
    url += "?roomId=" + (roomId ? encodeURIComponent(roomId) : "");
    url += "&token=" + (token ? encodeURIComponent(token) : "");
    url += "&name=" + encodeURIComponent(name);
    for (const layer of characterLayers) {
      url += "&characterLayers=" + encodeURIComponent(layer);
    }
    url += "&x=" + Math.floor(position.x);
    url += "&y=" + Math.floor(position.y);
    url += "&top=" + Math.floor(viewport.top);
    url += "&bottom=" + Math.floor(viewport.bottom);
    url += "&left=" + Math.floor(viewport.left);
    url += "&right=" + Math.floor(viewport.right);

    if (RoomConnection.websocketFactory) {
      this.socket = RoomConnection.websocketFactory(url);
    } else {
      this.socket = new WebSocket(url);
    }

    this.socket.binaryType = "arraybuffer";

    let interval: ReturnType<typeof setInterval> | undefined = undefined;

    this.socket.onopen = (ev) => {
      //we manually ping every 20s to not be logged out by the server, even when the game is in background.
      const pingMessage = new PingMessage();
      interval = setInterval(
        () => this.socket.send(PingMessage.encode(pingMessage).finish()),
        manualPingDelay
      );
    };

    this.socket.addEventListener("close", (event) => {
      if (interval) {
        clearInterval(interval);
      }

      // If we are not connected yet (if a JoinRoomMessage was not sent), we need to retry.
      if (this.userId === null) {
        this.dispatch(EventMessage.CONNECTING_ERROR, event);
      }
    });

    this.socket.onmessage = (messageEvent) => {
      const arrayBuffer: ArrayBuffer = messageEvent.data;
      const message = ServerToClientMessage.decode(new Uint8Array(arrayBuffer));

      if (
        message.batchMessage !== undefined &&
        Array.isArray(message.batchMessage?.payload)
      ) {
        for (const subMessage of (message.batchMessage as BatchMessage)
          .payload) {
          let event: string;
          let payload;
          if (subMessage.userLeftMessage !== undefined) {
            event = EventMessage.USER_MOVED;
            payload = subMessage.userMovedMessage;
          } else if (subMessage.groupUpdateMessage !== undefined) {
            event = EventMessage.GROUP_CREATE_UPDATE;
            payload = subMessage.groupUpdateMessage;
          } else if (subMessage.groupDeleteMessage !== undefined) {
            event = EventMessage.GROUP_DELETE;
            payload = subMessage.groupDeleteMessage;
          } else if (subMessage.userJoinedMessage !== undefined) {
            event = EventMessage.JOIN_ROOM;
            payload = subMessage.userJoinedMessage;
          } else if (subMessage.userLeftMessage !== undefined) {
            event = EventMessage.USER_LEFT;
            payload = subMessage.userLeftMessage;
          } else if (subMessage.itemEventMessage !== undefined) {
            event = EventMessage.ITEM_EVENT;
            payload = subMessage.itemEventMessage;
          } else {
            throw new Error("Unexpected batch message type");
          }

          this.dispatch(event, payload);
        }
      } else if (message.roomJoinedMessage !== undefined) {
        const roomJoinedMessage = message.roomJoinedMessage as RoomJoinedMessage;

        //const users: Array<MessageUserJoined> = roomJoinedMessage.getUserList().map(this.toMessageUserJoined.bind(this));
        //const groups: Array<GroupCreatedUpdatedMessageInterface> = roomJoinedMessage.getGroupList().map(this.toGroupCreatedUpdatedMessage.bind(this));
        const items: { [itemId: number]: unknown } = {};
        for (const item of roomJoinedMessage.item) {
          if (
            typeof item.itemId === "number" &&
            typeof item.stateJson === "string"
          ) {
            items[item.itemId] = JSON.parse(item.stateJson);
          } else {
            throw new TypeError();
          }
        }

        this.userId = roomJoinedMessage.currentUserId;
        this.tags = roomJoinedMessage.tag;

        //console.log('Dispatching CONNECT')
        this.dispatch(EventMessage.CONNECT, {
          connection: this,
          room: {
            //users,
            //groups,
            items,
          } as RoomJoinedMessageInterface,
        });

        /*console.log('Dispatching START_ROOM')
                        this.dispatch(EventMessage.START_ROOM, {
                            //users,
                            //groups,
                            items
                        });*/
      } else if (message.errorMessage !== undefined) {
        console.error(
          EventMessage.MESSAGE_ERROR,
          message.errorMessage?.message
        );
      } else if (message.webRtcSignalToClientMessage !== undefined) {
        this.dispatch(
          EventMessage.WEBRTC_SIGNAL,
          message.webRtcSignalToClientMessage
        );
      } else if (
        message.webRtcScreenSharingSignalToClientMessage !== undefined
      ) {
        this.dispatch(
          EventMessage.WEBRTC_SCREEN_SHARING_SIGNAL,
          message.webRtcScreenSharingSignalToClientMessage
        );
      } else if (message.webRtcStartMessage !== undefined) {
        this.dispatch(EventMessage.WEBRTC_START, message.webRtcStartMessage);
      } else if (message.webRtcDisconnectMessage !== undefined) {
        this.dispatch(
          EventMessage.WEBRTC_DISCONNECT,
          message.webRtcDisconnectMessage
        );
      } else if (message.playGlobalMessage !== undefined) {
        this.dispatch(
          EventMessage.PLAY_GLOBAL_MESSAGE,
          message.playGlobalMessage
        );
      } else if (message.stopGlobalMessage !== undefined) {
        this.dispatch(
          EventMessage.STOP_GLOBAL_MESSAGE,
          message.stopGlobalMessage
        );
      } else if (message.teleportMessageMessage !== undefined) {
        this.dispatch(EventMessage.TELEPORT, message.teleportMessageMessage);
      } else if (message.sendJitsiJwtMessage !== undefined) {
        this.dispatch(
          EventMessage.START_JITSI_ROOM,
          message.sendJitsiJwtMessage
        );
      } else if (message.sendUserMessage !== undefined) {
        this.dispatch(EventMessage.USER_MESSAGE, message.sendUserMessage);
      } else {
        throw new Error("Unknown message received");
      }
    };
  }

  private dispatch(event: string, payload: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners === undefined) {
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  }

  public emitPlayerDetailsMessage(
    userName: string,
    characterLayersSelected: BodyResourceDescriptionInterface[]
  ) {
    const message = new SetPlayerDetailsMessage();
    message.name = userName;
    message.characterLayers = characterLayersSelected.map(
      (characterLayer) => characterLayer.name
    );

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.setPlayerDetailsMessage = message;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public closeConnection(): void {
    this.socket?.close();
    this.closed = true;
  }

  private toPositionMessage(
    x: number,
    y: number,
    direction: string,
    moving: boolean
  ): PositionMessage {
    const positionMessage = new PositionMessage();
    positionMessage.x = Math.floor(x);
    positionMessage.y = Math.floor(y);
    let directionEnum: Direction;
    switch (direction) {
      case "up":
        directionEnum = Direction.UP;
        break;
      case "down":
        directionEnum = Direction.DOWN;
        break;
      case "left":
        directionEnum = Direction.LEFT;
        break;
      case "right":
        directionEnum = Direction.RIGHT;
        break;
      default:
        throw new Error("Unexpected direction");
    }
    positionMessage.direction = directionEnum;
    positionMessage.moving = moving;

    return positionMessage;
  }

  private toViewportMessage(viewport: ViewportInterface): ViewportMessage {
    const viewportMessage = new ViewportMessage();
    viewportMessage.left = Math.floor(viewport.left);
    viewportMessage.right = Math.floor(viewport.right);
    viewportMessage.top = Math.floor(viewport.top);
    viewportMessage.bottom = Math.floor(viewport.bottom);

    return viewportMessage;
  }

  public sharePosition(
    x: number,
    y: number,
    direction: string,
    moving: boolean,
    viewport: ViewportInterface
  ): void {
    if (!this.socket) {
      return;
    }

    const positionMessage = this.toPositionMessage(x, y, direction, moving);

    const viewportMessage = this.toViewportMessage(viewport);

    const userMovesMessage = new UserMovesMessage();
    userMovesMessage.position = positionMessage;
    userMovesMessage.viewport = viewportMessage;

    //console.log('Sending position ', positionMessage.getX(), positionMessage.getY());
    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.userMovesMessage = userMovesMessage;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public setSilent(silent: boolean): void {
    const silentMessage = new SilentMessage();
    silentMessage.silent = silent;

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.silentMessage = silentMessage;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public setViewport(viewport: ViewportInterface): void {
    const viewportMessage = new ViewportMessage();
    viewportMessage.top = Math.round(viewport.top);
    viewportMessage.bottom = Math.round(viewport.bottom);
    viewportMessage.left = Math.round(viewport.left);
    viewportMessage.right = Math.round(viewport.right);

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.viewportMessage = viewportMessage;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public onUserJoins(callback: (message: MessageUserJoined) => void): void {
    this.onMessage(EventMessage.JOIN_ROOM, (message: UserJoinedMessage) => {
      callback(this.toMessageUserJoined(message));
    });
  }

  // TODO: move this to protobuf utils
  private toMessageUserJoined(message: UserJoinedMessage): MessageUserJoined {
    const position = message.position;
    if (position === undefined) {
      throw new Error("Invalid JOIN_ROOM message");
    }

    const characterLayers = message.characterLayers.map(
      (
        characterLayer: ICharacterLayerMessage
      ): BodyResourceDescriptionInterface => {
        if (
          typeof characterLayer.name !== "string" ||
          typeof characterLayer.url !== "string"
        ) {
          throw new TypeError();
        }
        return {
          name: characterLayer.name,
          img: characterLayer.url,
        };
      }
    );
    if (position === null) {
      throw new TypeError();
    }
    return {
      userId: message.userId,
      name: message.name,
      characterLayers,
      position: ProtobufClientUtils.toPointInterface(position),
    };
  }

  public onUserMoved(callback: (message: UserMovedMessage) => void): void {
    this.onMessage(EventMessage.USER_MOVED, callback);
    //this.socket.on(EventMessage.USER_MOVED, callback);
  }

  /**
   * Registers a listener on a message that is part of a batch
   */
  private onMessage(eventName: string, callback: Function): void {
    let callbacks = this.listeners.get(eventName);
    if (callbacks === undefined) {
      callbacks = new Array<Function>();
      this.listeners.set(eventName, callbacks);
    }
    callbacks.push(callback);
  }

  public onUserLeft(callback: (userId: number) => void): void {
    this.onMessage(EventMessage.USER_LEFT, (message: UserLeftMessage) => {
      callback(message.userId);
    });
  }

  public onGroupUpdatedOrCreated(
    callback: (
      groupCreateUpdateMessage: GroupCreatedUpdatedMessageInterface
    ) => void
  ): void {
    this.onMessage(
      EventMessage.GROUP_CREATE_UPDATE,
      (message: GroupUpdateMessage) => {
        callback(this.toGroupCreatedUpdatedMessage(message));
      }
    );
  }

  private toGroupCreatedUpdatedMessage(
    message: GroupUpdateMessage
  ): GroupCreatedUpdatedMessageInterface {
    const position = message.position;
    if (position === undefined) {
      throw new Error("Missing position in GROUP_CREATE_UPDATE");
    }

    return {
      groupId: message.groupId,
      position: position as PositionInterface, // message.position is Point, return type needs Position. both are {x: number, y: number}
      groupSize: message.groupSize,
    };
  }

  public onGroupDeleted(callback: (groupId: number) => void): void {
    this.onMessage(EventMessage.GROUP_DELETE, (message: GroupDeleteMessage) => {
      callback(message.groupId);
    });
  }

  public onConnectingError(callback: (event: CloseEvent) => void): void {
    this.onMessage(EventMessage.CONNECTING_ERROR, (event: CloseEvent) => {
      callback(event);
    });
  }

  public onConnectError(callback: (error: Event) => void): void {
    this.socket.addEventListener("error", callback);
  }

  /*public onConnect(callback: (e: Event) => void): void {
          this.socket.addEventListener('open', callback)
      }*/
  public onConnect(
    callback: (roomConnection: OnConnectInterface) => void
  ): void {
    //this.socket.addEventListener('open', callback)
    this.onMessage(EventMessage.CONNECT, callback);
  }

  /**
   * Triggered when we receive all the details of a room (users, groups, ...)
   */
  /*public onStartRoom(callback: (event: RoomJoinedMessageInterface) => void): void {
          this.onMessage(EventMessage.START_ROOM, callback);
      }*/

  public sendWebrtcSignal(signal: unknown, receiverId: number) {
    const webRtcSignal = new WebRtcSignalToServerMessage();
    webRtcSignal.receiverId = receiverId;
    webRtcSignal.signal = JSON.stringify(signal);

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.webRtcSignalToServerMessage = webRtcSignal;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public sendWebrtcScreenSharingSignal(signal: unknown, receiverId: number) {
    const webRtcSignal = new WebRtcSignalToServerMessage();
    webRtcSignal.receiverId = receiverId;
    webRtcSignal.signal = JSON.stringify(signal);

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.webRtcScreenSharingSignalToServerMessage = webRtcSignal;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public receiveWebrtcStart(
    callback: (message: UserSimplePeerInterface) => void
  ) {
    this.onMessage(EventMessage.WEBRTC_START, (message: WebRtcStartMessage) => {
      callback({
        userId: message.userId,
        name: message.name,
        initiator: message.initiator,
        webRtcUser: message.webrtcUserName ?? undefined,
        webRtcPassword: message.webrtcPassword ?? undefined,
      });
    });
  }

  public receiveWebrtcSignal(
    callback: (message: WebRtcSignalReceivedMessageInterface) => void
  ) {
    this.onMessage(
      EventMessage.WEBRTC_SIGNAL,
      (message: WebRtcSignalToClientMessage) => {
        callback({
          userId: message.userId,
          signal: JSON.parse(message.signal),
          webRtcUser: message.webrtcUserName ?? undefined,
          webRtcPassword: message.webrtcPassword ?? undefined,
        });
      }
    );
  }

  public receiveWebrtcScreenSharingSignal(
    callback: (message: WebRtcSignalReceivedMessageInterface) => void
  ) {
    this.onMessage(
      EventMessage.WEBRTC_SCREEN_SHARING_SIGNAL,
      (message: WebRtcSignalToClientMessage) => {
        callback({
          userId: message.userId,
          signal: JSON.parse(message.signal),
          webRtcUser: message.webrtcUserName ?? undefined,
          webRtcPassword: message.webrtcPassword ?? undefined,
        });
      }
    );
  }

  public onServerDisconnected(callback: (event: CloseEvent) => void): void {
    this.socket.addEventListener("close", (event) => {
      if (this.closed === true) {
        return;
      }
      console.log(
        "Socket closed with code " + event.code + ". Reason: " + event.reason
      );
      if (event.code === 1000) {
        // Normal closure case
        return;
      }
      callback(event);
    });
  }

  public getUserId(): number {
    if (this.userId === null) throw "UserId cannot be null!";
    return this.userId;
  }

  disconnectMessage(
    callback: (message: WebRtcDisconnectMessageInterface) => void
  ): void {
    this.onMessage(
      EventMessage.WEBRTC_DISCONNECT,
      (message: WebRtcDisconnectMessage) => {
        callback({
          userId: message.userId,
        });
      }
    );
  }

  emitActionableEvent(
    itemId: number,
    event: string,
    state: unknown,
    parameters: unknown
  ): void {
    const itemEventMessage = new ItemEventMessage();
    itemEventMessage.itemId = itemId;
    itemEventMessage.event = event;
    itemEventMessage.stateJson = JSON.stringify(state);
    itemEventMessage.parametersJson = JSON.stringify(parameters);

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.itemEventMessage = itemEventMessage;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  onActionableEvent(
    callback: (message: ItemEventMessageInterface) => void
  ): void {
    this.onMessage(EventMessage.ITEM_EVENT, (message: ItemEventMessage) => {
      callback({
        itemId: message.itemId,
        event: message.event,
        parameters: JSON.parse(message.parametersJson),
        state: JSON.parse(message.stateJson),
      });
    });
  }

  public uploadAudio(file: FormData) {
    return Axios.post(`${UPLOADER_URL}/upload-audio-message`, file)
      .then((res: { data: {} }) => {
        return res.data;
      })
      .catch((err) => {
        console.error(err);
        throw err;
      });
  }

  public receivePlayGlobalMessage(
    callback: (message: PlayGlobalMessageInterface) => void
  ) {
    return this.onMessage(
      EventMessage.PLAY_GLOBAL_MESSAGE,
      (message: PlayGlobalMessage) => {
        callback({
          id: message.id,
          type: message.type,
          message: message.message,
        });
      }
    );
  }

  public receiveStopGlobalMessage(callback: (messageId: string) => void) {
    return this.onMessage(
      EventMessage.STOP_GLOBAL_MESSAGE,
      (message: StopGlobalMessage) => {
        callback(message.id);
      }
    );
  }

  public receiveTeleportMessage(callback: (messageId: string) => void) {
    return this.onMessage(
      EventMessage.TELEPORT,
      (message: TeleportMessageMessage) => {
        callback(message.map);
      }
    );
  }

  public receiveUserMessage(callback: (type: string, message: string) => void) {
    return this.onMessage(
      EventMessage.USER_MESSAGE,
      (message: SendUserMessage) => {
        callback(message.type, message.message);
      }
    );
  }

  public emitGlobalMessage(message: PlayGlobalMessageInterface) {
    const playGlobalMessage = new PlayGlobalMessage();
    playGlobalMessage.id = message.id;
    playGlobalMessage.type = message.type;
    playGlobalMessage.message = message.message;

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.playGlobalMessage = playGlobalMessage;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public emitReportPlayerMessage(
    reportedUserId: number,
    reportComment: string
  ): void {
    const reportPlayerMessage = new ReportPlayerMessage();
    reportPlayerMessage.reportedUserId = reportedUserId;
    reportPlayerMessage.reportComment = reportComment;

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.reportPlayerMessage = reportPlayerMessage;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public emitQueryJitsiJwtMessage(
    jitsiRoom: string,
    tag: string | undefined
  ): void {
    const queryJitsiJwtMessage = new QueryJitsiJwtMessage();
    queryJitsiJwtMessage.jitsiRoom = jitsiRoom;
    if (tag !== undefined) {
      queryJitsiJwtMessage.tag = tag;
    }

    const clientToServerMessage = new ClientToServerMessage();
    clientToServerMessage.queryJitsiJwtMessage = queryJitsiJwtMessage;

    this.socket.send(
      ClientToServerMessage.encode(clientToServerMessage).finish()
    );
  }

  public onStartJitsiRoom(callback: (jwt: string, room: string) => void): void {
    this.onMessage(
      EventMessage.START_JITSI_ROOM,
      (message: SendJitsiJwtMessage) => {
        callback(message.jwt, message.jitsiRoom);
      }
    );
  }

  public hasTag(tag: string): boolean {
    return this.tags.includes(tag);
  }

  public isAdmin(): boolean {
    return this.hasTag("admin");
  }
}
