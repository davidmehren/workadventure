import {
  IPositionMessage,
  PositionMessage,
} from "../Messages/generated/messages_pb";
import Direction = PositionMessage.Direction;
import { PointInterface } from "../Connexion/ConnexionModels";

export class ProtobufClientUtils {
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

    // sending to all clients in room except sender
    return {
      x: position.x as number,
      y: position.y as number,
      direction,
      moving: position.moving as boolean,
    };
  }
}
