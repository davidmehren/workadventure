import { IRoomManagerServer } from "./Messages/generated/messages_grpc_pb";
import {
  AdminGlobalMessage,
  AdminMessage,
  AdminPusherToBackMessage,
  BanMessage,
  EmptyMessage,
  ItemEventMessage,
  JoinRoomMessage,
  PlayGlobalMessage,
  PusherToBackMessage,
  QueryJitsiJwtMessage,
  ServerToAdminClientMessage,
  ServerToClientMessage,
  SilentMessage,
  UserMovesMessage,
  WebRtcSignalToServerMessage,
  ZoneMessage,
} from "./Messages/generated/messages_pb";
import {
  sendUnaryData,
  ServerDuplexStream,
  ServerUnaryCall,
  ServerWritableStream,
} from "grpc";
import { socketManager } from "./Services/SocketManager";
import { emitError } from "./Services/MessageHelpers";
import { User, UserSocket } from "./Model/User";
import { GameRoom } from "./Model/GameRoom";
import Debug from "debug";
import { Admin } from "./Model/Admin";

const debug = Debug("roommanager");

export type AdminSocket = ServerDuplexStream<
  AdminPusherToBackMessage,
  ServerToAdminClientMessage
>;
export type ZoneSocket = ServerWritableStream<
  ZoneMessage,
  ServerToClientMessage
>;

const roomManager: IRoomManagerServer = {
  joinRoom: (call: UserSocket): void => {
    console.log("joinRoom called");

    let room: GameRoom | null = null;
    let user: User | null = null;

    call.on("data", (message: PusherToBackMessage) => {
      try {
        if (room === null || user === null) {
          if (
            message.joinRoomMessage !== undefined &&
            message.joinRoomMessage !== null
          ) {
            socketManager
              .handleJoinRoom(call, message.joinRoomMessage as JoinRoomMessage)
              .then(({ room: gameRoom, user: myUser }) => {
                room = gameRoom;
                user = myUser;
              });
          } else {
            throw new Error(
              "The first message sent MUST be of type JoinRoomMessage"
            );
          }
        } else {
          if (
            message.joinRoomMessage !== undefined &&
            message.joinRoomMessage !== null
          ) {
            throw new Error("Cannot call JoinRoomMessage twice!");
            /*} else if (message.hasViewportmessage()) {
                        socketManager.handleViewport(client, message.getViewportmessage() as ViewportMessage);*/
          } else if (
            message.userMovesMessage !== undefined &&
            message.userMovesMessage !== null
          ) {
            socketManager.handleUserMovesMessage(
              room,
              user,
              message.userMovesMessage as UserMovesMessage
            );
            /*} else if (message.hasSetplayerdetailsmessage()) {
                            socketManager.handleSetPlayerDetails(client, message.getSetplayerdetailsmessage() as SetPlayerDetailsMessage);*/
          } else if (
            message.silentMessage !== undefined &&
            message.silentMessage !== null
          ) {
            socketManager.handleSilentMessage(
              room,
              user,
              message.silentMessage as SilentMessage
            );
          } else if (
            message.itemEventMessage !== undefined &&
            message.itemEventMessage !== null
          ) {
            socketManager.handleItemEvent(
              room,
              user,
              message.itemEventMessage as ItemEventMessage
            );
          } else if (
            message.webRtcSignalToServerMessage !== undefined &&
            message.webRtcSignalToServerMessage !== null
          ) {
            socketManager.emitVideo(
              room,
              user,
              message.webRtcSignalToServerMessage as WebRtcSignalToServerMessage
            );
          } else if (
            message.webRtcScreenSharingSignalToServerMessage !== undefined &&
            message.webRtcScreenSharingSignalToServerMessage !== null
          ) {
            socketManager.emitScreenSharing(
              room,
              user,
              message.webRtcScreenSharingSignalToServerMessage as WebRtcSignalToServerMessage
            );
          } else if (
            message.playGlobalMessage !== undefined &&
            message.playGlobalMessage !== null
          ) {
            socketManager.emitPlayGlobalMessage(
              room,
              message.playGlobalMessage as PlayGlobalMessage
            );
            /*} else if (message.hasReportplayermessage()){
                        socketManager.handleReportMessage(client, message.getReportplayermessage() as ReportPlayerMessage);*/
          } else if (
            message.queryJitsiJwtMessage !== undefined &&
            message.queryJitsiJwtMessage !== null
          ) {
            socketManager.handleQueryJitsiJwtMessage(
              user,
              message.queryJitsiJwtMessage as QueryJitsiJwtMessage
            );
          } else if (
            message.sendUserMessage !== undefined &&
            message.sendUserMessage !== null
          ) {
            const sendUserMessage = message.sendUserMessage;
            if (sendUserMessage !== undefined) {
              socketManager.handlerSendUserMessage(user, sendUserMessage);
            }
          } else if (
            message.banUserMessage !== undefined &&
            message.banUserMessage !== null
          ) {
            const banUserMessage = message.banUserMessage;
            if (banUserMessage !== undefined) {
              socketManager.handlerBanUserMessage(room, user, banUserMessage);
            }
          } else {
            throw new Error("Unhandled message type");
          }
        }
      } catch (e) {
        emitError(call, e);
        call.end();
      }
    });

    call.on("end", () => {
      debug("joinRoom ended");
      if (user !== null && room !== null) {
        socketManager.leaveRoom(room, user);
      }
      call.end();
      room = null;
      user = null;
    });

    call.on("error", (err: Error) => {
      console.error("An error occurred in joinRoom stream:", err);
    });
  },

  listenZone(call: ZoneSocket): void {
    debug("listenZone called");
    const zoneMessage = call.request;

    socketManager.addZoneListener(
      call,
      zoneMessage.roomId,
      zoneMessage.x,
      zoneMessage.y
    );

    call.on("cancelled", () => {
      debug("listenZone cancelled");
      socketManager.removeZoneListener(
        call,
        zoneMessage.roomId,
        zoneMessage.x,
        zoneMessage.y
      );
      call.end();
    });

    /*call.on('finish', () => {
            debug('listenZone finish');
        })*/
    call
      .on("close", () => {
        debug("listenZone connection closed");
        socketManager.removeZoneListener(
          call,
          zoneMessage.roomId,
          zoneMessage.x,
          zoneMessage.y
        );
      })
      .on("error", (e) => {
        console.error("An error occurred in listenZone stream:", e);
        socketManager.removeZoneListener(
          call,
          zoneMessage.roomId,
          zoneMessage.x,
          zoneMessage.y
        );
        call.end();
      });
  },

  adminRoom(call: AdminSocket): void {
    console.log("adminRoom called");

    const admin = new Admin(call);
    let room: GameRoom | null = null;

    call.on("data", (message: AdminPusherToBackMessage) => {
      try {
        if (room === null) {
          if (
            message.subscribeToRoom !== undefined &&
            message.subscribeToRoom !== null
          ) {
            const roomId = message.subscribeToRoom;
            socketManager
              .handleJoinAdminRoom(admin, roomId)
              .then((gameRoom: GameRoom) => {
                room = gameRoom;
              });
          } else {
            throw new Error(
              "The first message sent MUST be of type JoinRoomMessage"
            );
          }
        } else {
          /*if (message.hasJoinroommessage()) {
                        throw new Error('Cannot call JoinRoomMessage twice!');
                    } else if (message.hasUsermovesmessage()) {
                        socketManager.handleUserMovesMessage(room, user, message.getUsermovesmessage() as UserMovesMessage);
                    } else if (message.hasSilentmessage()) {
                        socketManager.handleSilentMessage(room, user, message.getSilentmessage() as SilentMessage);
                    } else if (message.hasItemeventmessage()) {
                        socketManager.handleItemEvent(room, user, message.getItemeventmessage() as ItemEventMessage);
                    } else if (message.hasWebrtcsignaltoservermessage()) {
                        socketManager.emitVideo(room, user, message.getWebrtcsignaltoservermessage() as WebRtcSignalToServerMessage);
                    } else if (message.hasWebrtcscreensharingsignaltoservermessage()) {
                        socketManager.emitScreenSharing(room, user, message.getWebrtcscreensharingsignaltoservermessage() as WebRtcSignalToServerMessage);
                    } else if (message.hasPlayglobalmessage()) {
                        socketManager.emitPlayGlobalMessage(room, message.getPlayglobalmessage() as PlayGlobalMessage);
                    } else if (message.hasQueryjitsijwtmessage()){
                        socketManager.handleQueryJitsiJwtMessage(user, message.getQueryjitsijwtmessage() as QueryJitsiJwtMessage);
                    } else {
                        throw new Error('Unhandled message type');
                    }*/
        }
      } catch (e) {
        emitError(call, e);
        call.end();
      }
    });

    call.on("end", () => {
      debug("joinRoom ended");
      if (room !== null) {
        socketManager.leaveAdminRoom(room, admin);
      }
      call.end();
      room = null;
    });

    call.on("error", (err: Error) => {
      console.error("An error occurred in joinAdminRoom stream:", err);
    });
  },
  sendAdminMessage(
    call: ServerUnaryCall<AdminMessage>,
    callback: sendUnaryData<EmptyMessage>
  ): void {
    socketManager.sendAdminMessage(
      call.request.roomId,
      call.request.recipientUuid,
      call.request.message
    );

    callback(null, new EmptyMessage());
  },
  sendGlobalAdminMessage(
    call: ServerUnaryCall<AdminGlobalMessage>,
    callback: sendUnaryData<EmptyMessage>
  ): void {
    throw new Error("Not implemented yet");
    // TODO
    callback(null, new EmptyMessage());
  },
  ban(
    call: ServerUnaryCall<BanMessage>,
    callback: sendUnaryData<EmptyMessage>
  ): void {
    // FIXME Work in progress
    socketManager.banUser(
      call.request.roomId,
      call.request.recipientUuid,
      "foo bar TODO change this"
    );

    callback(null, new EmptyMessage());
  },
};

export { roomManager };
