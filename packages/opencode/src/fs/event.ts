import { BusEvent } from "../bus/bus-event"
import z from "zod"

export const ConnectionStatus = z.enum(["connected", "disconnected", "connecting", "reconnecting", "error"])

export const RemoteEvent = {
  StateChanged: BusEvent.define(
    "remote.stateChanged",
    z.object({
      status: ConnectionStatus,
      host: z.string(),
      port: z.number(),
      lastConnected: z.date().optional(),
      lastError: z.string().optional(),
      reconnectAttempt: z.number(),
      nextRetryAt: z.date().optional(),
    }),
  ),
}
