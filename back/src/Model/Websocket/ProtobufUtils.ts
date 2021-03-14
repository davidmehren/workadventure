import { PointInterface } from "./PointInterface";
import {
  CharacterLayerMessage,
  ICharacterLayerMessage,
  IPositionMessage,
  ItemEventMessage,
  PointMessage,
  PositionMessage,
} from "../../Messages/generated/messages_pb";
import { CharacterLayer } from "_Model/Websocket/CharacterLayer";
import Direction = PositionMessage.Direction;
import { ItemEventMessageInterface } from "_Model/Websocket/ItemEventMessage";
import { PositionInterface } from "_Model/PositionInterface";

export class ProtobufUtils {
  public static toPositionMessage(point: PointInterface): PositionMessage {
    let direction: Direction;
    switch (point.direction) {
      case "up":
        direction = Direction.UP;
        break;
      case "down":
        direction = Direction.DOWN;
        break;
      case "left":
        direction = Direction.LEFT;
        break;
      case "right":
        direction = Direction.RIGHT;
        break;
      default:
        throw new Error("unexpected direction");
    }

    const position = new PositionMessage();
    position.x = point.x;
    position.y = point.y;
    position.moving = point.moving;
    position.direction = direction;

    return position;
  }

  public static toPointInterface(position: IPositionMessage): PointInterface {
    let direction: string;
    switch (position.direction) {
      case Direction.UP:
        direction = "up";
        break;
      case Direction.DOWN:
        direction = "down";
        break;
      case Direction.LEFT:
        direction = "left";
        break;
      case Direction.RIGHT:
        direction = "right";
        break;
      default:
        throw new Error("Unexpected direction");
    }
    if (
      typeof position.x !== "number" ||
      typeof position.y !== "number" ||
      typeof position.moving !== "boolean"
    ) {
      throw new TypeError();
    }
    // sending to all clients in room except sender
    return {
      x: position.x,
      y: position.y,
      direction,
      moving: position.moving,
    };
  }

  public static toPointMessage(point: PositionInterface): PointMessage {
    const position = new PointMessage();
    position.x = Math.floor(point.x);
    position.y = Math.floor(point.y);

    return position;
  }

  public static toItemEvent(
    itemEventMessage: ItemEventMessage
  ): ItemEventMessageInterface {
    return {
      itemId: itemEventMessage.itemId,
      event: itemEventMessage.event,
      parameters: JSON.parse(itemEventMessage.parametersJson),
      state: JSON.parse(itemEventMessage.stateJson),
    };
  }

  public static toItemEventProtobuf(
    itemEvent: ItemEventMessageInterface
  ): ItemEventMessage {
    const itemEventMessage = new ItemEventMessage();
    itemEventMessage.itemId = itemEvent.itemId;
    itemEventMessage.event = itemEvent.event;
    itemEventMessage.parametersJson = JSON.stringify(itemEvent.parameters);
    itemEventMessage.stateJson = JSON.stringify(itemEvent.state);

    return itemEventMessage;
  }

  public static toCharacterLayerMessages(
    characterLayers: CharacterLayer[]
  ): CharacterLayerMessage[] {
    return characterLayers.map(function (
      characterLayer
    ): CharacterLayerMessage {
      const message = new CharacterLayerMessage();
      message.name = characterLayer.name;
      if (characterLayer.url) {
        message.url = characterLayer.url;
      }
      return message;
    });
  }

  public static toCharacterLayerObjects(
    characterLayers: ICharacterLayerMessage[]
  ): CharacterLayer[] {
    return characterLayers.map(function (characterLayer): CharacterLayer {
      const url = characterLayer.url;
      if (typeof characterLayer.name !== "string") {
        throw new TypeError();
      }
      return {
        name: characterLayer.name,
        url: url ? url : undefined,
      };
    });
  }
}
