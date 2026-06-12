/**
 * D-ID Avatar Routes
 * Express routes for D-ID humanoid avatar endpoints
 * Integrates with existing avatar infrastructure without modifying current code
 */

import { Router, Request, Response } from 'express';
import {
  getDidConfigStatus,
  buildDidClientConfig,
  loadDidConfig,
  validateDidConfig,
} from './didConfig';
import { getDidAvatarService } from './didAvatarService';

const didAvatarRouter = Router();

/**
 * GET /api/avatar/did/config
 * Get D-ID avatar configuration status and client config
 */
didAvatarRouter.get('/config', (req: Request, res: Response) => {
  try {
    const status = getDidConfigStatus();

    if (!status.isConfigured || !status.config) {
      return res.status(503).json({
        configured: false,
        missingKeys: status.missingKeys,
        message: 'D-ID avatar not configured',
      });
    }

    const clientConfig = buildDidClientConfig(status.config);

    res.json({
      configured: true,
      config: clientConfig,
      // clientKey is a public-facing key designed for browser use by D-ID SDK
      clientKey: status.config.clientKey,
      agentId: status.config.agentId,
      backgroundUrl: status.config.backgroundUrl,
      presenter: {
        name: status.config.presenterName,
        id: status.config.presenterId,
      },
      voice: {
        type: status.config.voiceType,
        id: status.config.voiceId,
      },
    });
  } catch (error) {
    console.error('Error getting D-ID config:', error);
    res.status(500).json({
      error: 'Failed to get D-ID configuration',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/avatar/did/session
 * Create a new D-ID avatar session
 */
didAvatarRouter.post('/session', async (req: Request, res: Response) => {
  try {
    const status = getDidConfigStatus();

    if (!status.isConfigured || !status.config) {
      return res.status(503).json({
        error: 'D-ID not configured',
        missingKeys: status.missingKeys,
      });
    }

    const service = getDidAvatarService();
    if (!service) {
      return res.status(503).json({
        error: 'D-ID service unavailable',
      });
    }

    // Enforce agent voice configuration before creating session
    const voiceEnforced = await service.ensureExpressiveAgentVoice();
    if (!voiceEnforced) {
      console.warn('Warning: Could not enforce agent voice configuration');
    }

    // Create new session
    const session = await service.createSession();
    if (!session) {
      return res.status(503).json({
        error: 'Failed to create D-ID session',
      });
    }

    res.json({
      session_id: session.id,
      websocket_url: session.websocket_url,
      expires_at: session.expires_at,
      auth: session.auth,
    });
  } catch (error) {
    console.error('Error creating D-ID session:', error);
    res.status(500).json({
      error: 'Failed to create session',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * DELETE /api/avatar/did/session/:sessionId
 * Close a D-ID session
 */
didAvatarRouter.delete('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Session ID required',
      });
    }

    const service = getDidAvatarService();
    if (!service) {
      return res.status(503).json({
        error: 'D-ID service unavailable',
      });
    }

    const closed = await service.closeSession(sessionId);
    if (!closed) {
      return res.status(503).json({
        error: 'Failed to close session',
      });
    }

    res.json({ success: true, sessionId });
  } catch (error) {
    console.error('Error closing D-ID session:', error);
    res.status(500).json({
      error: 'Failed to close session',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/avatar/did/verify
 * Verify D-ID agent configuration (preflight check)
 */
didAvatarRouter.get('/verify', async (req: Request, res: Response) => {
  try {
    const status = getDidConfigStatus();

    if (!status.isConfigured || !status.config) {
      return res.status(503).json({
        verified: false,
        configured: false,
        missingKeys: status.missingKeys,
      });
    }

    const service = getDidAvatarService();
    if (!service) {
      return res.status(503).json({
        verified: false,
        error: 'D-ID service unavailable',
      });
    }

    const verification = await service.verifyAgentConfiguration();

    res.json({
      verified: verification.isValid,
      configured: true,
      presenter: verification.presenter,
      issues: verification.issues,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error verifying D-ID configuration:', error);
    res.status(500).json({
      verified: false,
      error: 'Verification failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/avatar/did/status
 * Get D-ID configuration and readiness status
 */
didAvatarRouter.get('/status', (req: Request, res: Response) => {
  try {
    const status = getDidConfigStatus();
    const config = status.config;

    res.json({
      available: status.isConfigured,
      configured: status.isConfigured,
      missingKeys: status.missingKeys,
      details: config
        ? {
            provider: 'did',
            presenter: {
              name: config.presenterName,
              id: config.presenterId,
            },
            voice: {
              type: config.voiceType,
              id: config.voiceId,
              modelId: config.elevenLabsModelId,
            },
            elevenLabsConfigured: !!config.elevenLabsApiKey,
          }
        : null,
    });
  } catch (error) {
    console.error('Error getting D-ID status:', error);
    res.status(500).json({
      available: false,
      error: 'Status check failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export { didAvatarRouter };
