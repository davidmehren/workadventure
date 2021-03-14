/**
 * A class to get connections to the correct "api" server given a room name.
 */
import protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import crypto from "crypto";
import { API_URL } from "../Enum/EnvironmentVariable";

import Debug from "debug";
import { ProtoGrpcType } from "src/Messages/generated/messages";
import { RoomManagerClient } from "src/Messages/generated/RoomManager";

const packageDefinition = protoLoader.loadSync(
  "../../Messages/protos/messages.proto",
  {}
);
const packageObject = (grpc.loadPackageDefinition(
  packageDefinition
) as unknown) as ProtoGrpcType;

const debug = Debug("apiClientRespository");

class ApiClientRepository {
  private roomManagerClients: RoomManagerClient[] = [];

  public constructor(private apiUrls: string[]) {
    if (grpc.credentials === undefined) {
      throw new Error("grpc credentials is undefined.");
    }
  }

  public async getClient(roomId: string): Promise<RoomManagerClient> {
    const array = new Uint32Array(
      crypto.createHash("md5").update(roomId).digest()
    );
    const index = array[0] % this.apiUrls.length;

    let client = this.roomManagerClients[index];
    if (client === undefined) {
      this.roomManagerClients[index] = client = new RoomManagerClient(
        this.apiUrls[index],
        grpc.credentials.createInsecure()
      );
      debug("Mapping room %s to API server %s", roomId, this.apiUrls[index]);
    }

    return Promise.resolve(client);
  }

  public async getAllClients(): Promise<RoomManagerClient[]> {
    return [await this.getClient("")];
  }
}

const apiClientRepository = new ApiClientRepository(API_URL.split(","));

export { apiClientRepository };
