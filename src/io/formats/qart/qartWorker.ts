/**
 * The .qart worker (plan M1.6): writes documents as .qart files and reads
 * them off the main thread, so cutting, compressing and unpacking large
 * documents doesn't hold up painting.
 */
import { serveQartCodec, type QartPort } from './qartProtocol.ts'

serveQartCodec(globalThis as unknown as QartPort)
