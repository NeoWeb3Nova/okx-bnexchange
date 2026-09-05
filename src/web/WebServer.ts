import http from 'http';
import fs from 'fs';
import path from 'path';

export interface WebDashboardData {
  totalScanned: number;
  cexMatched: number;
  opportunities: any[];
  profitAnalyses: any[];
  paperTrades: any[];
  paperSummary: any;
  lastScanTime: number;
}

export class WebServer {
  private server: http.Server;
  private sseClients: http.ServerResponse[] = [];
  private latestData: WebDashboardData = {
    totalScanned: 0,
    cexMatched: 0,
    opportunities: [],
    profitAnalyses: [],
    paperTrades: [],
    paperSummary: null,
    lastScanTime: Date.now(),
  };

  constructor(
    private port: number = 3000,
    private onTriggerScan?: () => Promise<WebDashboardData>
  ) {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url || '/';

    // 1. SSE Stream
    if (url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify(this.latestData)}\n\n`);
      this.sseClients.push(res);

      req.on('close', () => {
        this.sseClients = this.sseClients.filter(c => c !== res);
      });
      return;
    }

    // 2. REST API: Get Status
    if (url === '/api/status' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(this.latestData));
      return;
    }

    // 3. REST API: Trigger Manual Scan
    if (url === '/api/scan' && (req.method === 'POST' || req.method === 'GET')) {
      if (this.onTriggerScan) {
        this.onTriggerScan()
          .then(data => {
            this.broadcast(data);
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify(data));
          })
          .catch(err => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.latestData));
      }
      return;
    }

    // 4. Static HTML
    const htmlPath = path.resolve(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(htmlPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Web console index.html not found');
    }
  }

  /**
   * Broadcast real-time update to all open browser windows
   */
  public broadcast(data: WebDashboardData): void {
    this.latestData = data;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        // Ignore dead socket
      }
    }
  }

  /**
   * Start HTTP server
   */
  public start(): Promise<void> {
    return new Promise(resolve => {
      this.server.listen(this.port, () => {
        console.log(`\n========================================================================================================================`);
        console.log(`🌐 WEB VISUALIZATION CONSOLE STARTED`);
        console.log(`URL: http://localhost:${this.port} (Open in your browser)`);
        console.log(`Mode: Real-time Live Dashboard | Protocol: Server-Sent Events (SSE)`);
        console.log(`========================================================================================================================\n`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise(resolve => {
      this.server.close(() => resolve());
    });
  }
}
