/**
 * Token-Stack Deep Adversarial Test Program: Network Harness & Fault Injection
 * Strictly loopback-only, secret-redacting, scripted fault engine with clean rebind verification.
 */

const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');

const activeServers = new Set();
const activeSockets = new Set();

function isLoopbackAddress(address) {
  if (!address) return false;
  const clean = address.replace(/^::ffff:/, '').toLowerCase();
  return clean === '127.0.0.1' || clean === 'localhost' || clean === '::1';
}

function sanitizeHeaders(headers = {}) {
  const sanitized = {};
  for (const [key, val] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'authorization' || lowerKey === 'x-api-key' || lowerKey.includes('token') || lowerKey.includes('secret')) {
      const hash = crypto.createHash('sha256').update(String(val)).digest('hex').slice(0, 8);
      sanitized[key] = `[REDACTED_HASH:${hash}]`;
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

/**
 * Creates an ephemeral loopback HTTP server with scripted fault support.
 * @param {Object} options
 * @param {Function} [options.handler] Custom request handler: (req, res, recordedInfo)
 * @param {Array<Object>} [options.faults] Scripted sequence of faults or responses
 */
async function createLoopbackServer(options = {}) {
  const recordedRequests = [];
  let requestCounter = 0;

  const server = http.createServer(async (req, res) => {
    requestCounter += 1;
    const clientIp = req.socket.remoteAddress;
    if (!isLoopbackAddress(clientIp)) {
      req.socket.destroy();
      throw new Error(`SECURITY VIOLATION: Non-loopback connection attempt from ${clientIp}`);
    }

    // Accumulate body if any
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    await new Promise(resolve => req.on('end', resolve));
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const recorded = {
      index: requestCounter,
      method: req.method,
      url: req.url,
      clientIp,
      headers: sanitizeHeaders(req.headers),
      hasAuth: Boolean(req.headers.authorization || req.headers['x-api-key']),
      bodyByteLength: Buffer.byteLength(rawBody, 'utf8')
    };
    recordedRequests.push(recorded);

    // If options.faults is provided, check for scripted behavior
    if (options.faults && options.faults.length > 0) {
      const fault = options.faults.shift();
      if (fault.delayMs) {
        await new Promise(r => setTimeout(r, fault.delayMs));
      }

      if (fault.action === 'reset') {
        req.socket.destroy();
        return;
      }

      if (fault.action === 'empty') {
        res.writeHead(200, { 'Content-Length': '0' });
        res.end();
        return;
      }

      if (fault.action === 'malformed') {
        req.socket.write('HTTP/1.1 200 OK\r\nContent-Length: 9999\r\n\r\nIncomplete');
        req.socket.destroy();
        return;
      }

      if (fault.action === 'status') {
        res.writeHead(fault.status || 500, fault.headers || { 'Content-Type': 'text/plain' });
        res.end(fault.body || 'Internal Error');
        return;
      }

      if (fault.action === 'chunked-sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        const events = fault.events || ['event: message_start\ndata: {}\n\n'];
        for (const evt of events) {
          res.write(evt);
          if (fault.eventDelayMs) {
            await new Promise(r => setTimeout(r, fault.eventDelayMs));
          }
        }
        res.end();
        return;
      }
    }

    if (typeof options.handler === 'function') {
      return options.handler(req, res, recorded);
    }

    // Default response: 200 OK
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });

  server.on('connection', socket => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const address = server.address();
  const port = address.port;

  activeServers.add(server);

  return {
    server,
    port,
    host: '127.0.0.1',
    baseUrl: `http://127.0.0.1:${port}`,
    recordedRequests,
    async close() {
      activeServers.delete(server);
      return new Promise(resolve => server.close(resolve));
    }
  };
}

/**
 * Verifies that a given port can be immediately rebound on 127.0.0.1.
 */
async function verifyPortRebindable(port, host = '127.0.0.1', timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve());
      });
      await new Promise(resolve => server.close(resolve));
      return true;
    } catch (e) {
      if (e.code === 'EADDRINUSE') {
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      throw e;
    }
  }
  throw new Error(`PORT NOT REBINDABLE: Port ${port} on ${host} could not be rebound within ${timeoutMs}ms.`);
}

/**
 * Emergency cleanup for all active servers and open sockets.
 */
async function cleanupAllServers() {
  for (const socket of activeSockets) {
    try { socket.destroy(); } catch {}
  }
  activeSockets.clear();

  const closePromises = [];
  for (const server of activeServers) {
    closePromises.push(new Promise(resolve => {
      try { server.close(resolve); } catch { resolve(); }
    }));
  }
  activeServers.clear();
  await Promise.all(closePromises);
}

module.exports = {
  isLoopbackAddress,
  sanitizeHeaders,
  createLoopbackServer,
  verifyPortRebindable,
  cleanupAllServers
};
