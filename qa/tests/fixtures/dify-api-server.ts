import * as http from 'http';
import { EventEmitter } from 'events';
import { URL } from 'url';

export interface RequestRecord {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export class DifyApiServer extends EventEmitter {
  private server: http.Server;
  private port: number;
  public requests: RequestRecord[] = [];

  constructor(port: number = 0) {
    super();
    this.port = port;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        const address = this.server.address();
        const actualPort = typeof address === 'object' && address ? address.port : this.port;
        this.port = actualPort;
        resolve(actualPort);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public clearRequests(): void {
    this.requests = [];
  }

  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body: Buffer[] = [];
      req.on('data', chunk => {
        body.push(chunk);
      });
      req.on('end', () => {
        const fullBody = Buffer.concat(body).toString();
        if (req.headers['content-type']?.includes('application/json')) {
          try {
            resolve(fullBody ? JSON.parse(fullBody) : {});
          } catch (e) {
            resolve(fullBody);
          }
        } else {
          resolve(fullBody);
        }
      });
      req.on('error', reject);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';

    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        body = await this.parseBody(req);
      } catch (e) {
        body = null;
      }
    }

    this.requests.push({
      method,
      url: req.url || '/',
      headers: req.headers,
      body
    });

    try {
      if (url.pathname === '/v1/info' && method === 'GET') {
        this.handleInfo(req, res);
      } else if (url.pathname === '/v1/parameters' && method === 'GET') {
        this.handleParameters(req, res);
      } else if (url.pathname === '/v1/workflows/run' && method === 'POST') {
        this.handleWorkflowsRun(req, res, body);
      } else if (url.pathname === '/v1/files/upload' && method === 'POST') {
        this.handleFilesUpload(req, res, body);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'not_found', message: 'Not found' }));
      }
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'internal_error', message: 'Internal server error' }));
    }
  }

  private handleInfo(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: "Dify API Mock",
      description: "Mock server for Dify API",
      tags: ["mock", "test"]
    }));
  }

  private handleParameters(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user_input_form: [],
      system_parameters: {
        image_file_size_limit: 10
      }
    }));
  }

  public emitWorkflowEvents(res: http.ServerResponse, events: any[]) {
    events.forEach(event => {
      res.write(`event: ${event.event}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  }

  private handleWorkflowsRun(req: http.IncomingMessage, res: http.ServerResponse, body: any) {
    const responseMode = body?.response_mode || 'blocking';

    if (responseMode === 'streaming') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      this.emitWorkflowEvents(res, [
        {
          task_id: 'task-123',
          workflow_run_id: 'run-123',
          event: 'workflow_started',
          data: { id: 'run-123' }
        },
        {
          task_id: 'task-123',
          workflow_run_id: 'run-123',
          event: 'node_started',
          data: { node_type: 'start', title: 'Start' }
        },
        {
          task_id: 'task-123',
          workflow_run_id: 'run-123',
          event: 'node_finished',
          data: { node_type: 'start', title: 'Start' }
        },
        {
          task_id: 'task-123',
          workflow_run_id: 'run-123',
          event: 'workflow_finished',
          data: { id: 'run-123', outputs: { result: 'success' } }
        }
      ]);

      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        task_id: 'task-123',
        workflow_run_id: 'run-123',
        data: {
          id: 'run-123',
          outputs: { result: 'success' },
          status: 'succeeded'
        }
      }));
    }
  }

  private handleFilesUpload(req: http.IncomingMessage, res: http.ServerResponse, body: any) {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'file-123',
      name: 'test.txt',
      size: 1024,
      extension: 'txt',
      mime_type: 'text/plain',
      created_by: 'user',
      created_at: Math.floor(Date.now() / 1000)
    }));
  }
}
