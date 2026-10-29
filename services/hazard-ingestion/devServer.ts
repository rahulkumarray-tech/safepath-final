import { createServer } from 'node:http';
import { handleHazardRequest } from './server.ts';

const host = process.env.HAZARD_API_HOST ?? '127.0.0.1';
const configuredPort = Number(process.env.HAZARD_API_PORT ?? '3100');
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535 ? configuredPort : 3100;

createServer((request, response) => {
  void handleHazardRequest(request, response);
}).listen(port, host, () => {
  console.log(`Hazard ingestion API listening on http://${host}:${port}`);
});
