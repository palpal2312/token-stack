/**
 * Token-Stack Deep Adversarial Test Program: Scripted Fake Anthropic Server
 * Simulates Anthropic /v1/messages and Headroom /readyz endpoints with fault injection and redaction checks.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { isLoopbackAddress, sanitizeHeaders } = require('./network-harness.cjs');

/**
 * Creates a scripted fake Anthropic / Headroom server.
 * @param {Object} options
 * @param {string} [options.scenario] 'ready-pass'|'upstream-429'|'upstream-400'|'upstream-500'|'truncated-sse'|'reset'|'slow'
 */
async function createFakeAnthropicServer(options = {}) {
  const scenario = options.scenario || 'ready-pass';
  const recordedRequests = [];

  const server = http.createServer((req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      req.socket.destroy();
      return;
    }

    const recorded = {
      method: req.method,
      url: req.url,
      headers: sanitizeHeaders(req.headers),
      hasRawAuth: Boolean(req.headers['x-api-key'] || req.headers.authorization)
    };
    recordedRequests.push(recorded);

    // Endpoint 1: /readyz
    if (req.url === '/readyz') {
      if (scenario === 'proxy-down') {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('service unavailable');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    // Endpoint 2: /v1/messages
    if (req.url === '/v1/messages') {
      if (scenario === 'upstream-429') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'Throttling.AllocationQuota exceeded' } }));
        return;
      }

      if (scenario === 'upstream-400') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'model rejected by upstream' } }));
        return;
      }

      if (scenario === 'upstream-500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'api_error', message: 'Internal Server Error' } }));
        return;
      }

      if (scenario === 'reset') {
        req.socket.destroy();
        return;
      }

      if (scenario === 'truncated-sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: ping\ndata: {}\n\n');
        // Ends prematurely without message_start
        res.end();
        return;
      }

      // Default: ready-pass (Complete valid SSE stream)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[]}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Pong"}}\n\n');
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      res.end();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    recordedRequests,
    async close() {
      return new Promise(resolve => server.close(resolve));
    }
  };
}

module.exports = {
  createFakeAnthropicServer
};
