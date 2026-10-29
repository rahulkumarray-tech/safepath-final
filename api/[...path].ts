import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleHazardRequest } from '../services/hazard-ingestion/server.ts';

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await handleHazardRequest(request, response);
}
