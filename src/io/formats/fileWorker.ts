/**
 * The files worker (plans M1.6 and M1.7): writes documents as .qart and
 * PSD files and reads them off the main thread, so cutting, compressing and
 * unpacking large documents doesn't hold up painting.
 */
import { serveFileCodec, type FilePort } from './fileProtocol.ts'

serveFileCodec(globalThis as unknown as FilePort)
