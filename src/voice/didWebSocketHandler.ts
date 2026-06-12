/**
 * D-ID WebSocket Handler
 * Manages real-time communication with D-ID expressive avatar
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface DidMessage {
  type: string;
  [key: string]: any;
}

export interface DidSessionMessage extends DidMessage {
  type: 'session_info';
  session_id: string;
  expires_at: string;
}

export interface DidSpeakMessage extends DidMessage {
  type: 'speak';
  text: string;
  top_p?: number;
  temperature?: number;
  emotion?: {
    type: string;
    intensity: number;
  };
}

export interface DidResponseMessage extends DidMessage {
  type: string;
  status?: string;
  [key: string]: any;
}

/**
 * D-ID WebSocket Manager
 * Handles connection lifecycle and message handling for D-ID avatar sessions
 */
export class DidWebSocketHandler extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly sessionId: string;
  private isConnecting = false;
  private messageQueue: DidMessage[] = [];
  private connectionTimeout: NodeJS.Timeout | null = null;

  constructor(wsUrl: string, sessionId: string) {
    super();
    this.wsUrl = wsUrl;
    this.sessionId = sessionId;
  }

  /**
   * Connect to D-ID WebSocket with timeout protection
   */
  async connect(timeoutMs = 10000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isConnecting) {
        resolve(false);
        return;
      }

      this.isConnecting = true;

      const timeout = setTimeout(() => {
        console.error('D-ID WebSocket connection timeout');
        this.disconnect();
        this.isConnecting = false;
        resolve(false);
      }, timeoutMs);

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          console.log('D-ID WebSocket connected');
          this.emit('connected');
          this.flushMessageQueue();
          resolve(true);
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          clearTimeout(timeout);
          console.error('D-ID WebSocket error:', error);
          this.isConnecting = false;
          this.emit('error', error);
          resolve(false);
        });

        this.ws.on('close', (code) => {
          console.log(`D-ID WebSocket closed with code ${code}`);
          this.emit('closed', code);
        });
      } catch (error) {
        clearTimeout(timeout);
        console.error('Failed to create D-ID WebSocket:', error);
        this.isConnecting = false;
        resolve(false);
      }
    });
  }

  /**
   * Send a speak message to the avatar
   */
  async speak(text: string, options?: Partial<DidSpeakMessage>): Promise<void> {
    const message: DidSpeakMessage = {
      type: 'speak',
      text,
      ...options,
    };

    this.sendMessage(message);
  }

  /**
   * Send a generic message
   */
  sendMessage(message: DidMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending D-ID message:', error);
        this.messageQueue.push(message);
      }
    } else {
      this.messageQueue.push(message);
    }
  }

  /**
   * Handle incoming messages from D-ID
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as DidResponseMessage;
      this.emit('message', message);

      // Emit specific message type events
      if (message.type) {
        this.emit(message.type, message);
      }
    } catch (error) {
      console.error('Error parsing D-ID message:', error);
    }
  }

  /**
   * Flush queued messages when connection is ready
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendMessage(message);
      }
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from D-ID WebSocket
   */
  disconnect(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error('Error closing D-ID WebSocket:', error);
      }
      this.ws = null;
    }

    this.messageQueue = [];
  }

  /**
   * Get WebSocket connection state
   */
  getConnectionState(): {
    connected: boolean;
    sessionId: string;
    queuedMessages: number;
  } {
    return {
      connected: this.isConnected(),
      sessionId: this.sessionId,
      queuedMessages: this.messageQueue.length,
    };
  }
}
