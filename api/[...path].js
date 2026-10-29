import { waitUntil } from '@vercel/functions';
import { handleRequest } from '../src/server.js';

export default async function handler(request, response) {
  try {
    await handleRequest(request, response, { waitUntil });
  } catch (error) {
    console.error('Unhandled Bizpoa Vercel function error:', error);
    if (!response.headersSent) {
      response.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({ error: 'Internal server error.' }));
    } else {
      response.end();
    }
  }
}
