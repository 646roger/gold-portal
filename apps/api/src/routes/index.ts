import { Router } from 'express';
import type { Env } from '../config/env';
import type { LlmProvider } from '../ai/types';
import { makeChatController } from '../controllers/chatController';
import { makeLoanController } from '../controllers/loanController';
import type { Db } from '../lib/prisma';
import { adminAuth, asyncHandler, limiter } from '../middleware/http';

export interface RouteDeps {
  db: Db;
  env: Env;
  now?: () => Date;
  llm: LlmProvider;
}

export function buildApiRouter(deps: RouteDeps): Router {
  const r = Router();
  const on = deps.env.RATE_LIMIT_ENABLED;
  const c = makeLoanController(deps.db, deps.now);
  const chat = makeChatController({ db: deps.db, llm: deps.llm, now: deps.now, maxIterations: deps.env.LLM_MAX_TOOL_ITERATIONS });

  r.get('/health', (_req, res) => res.json({ status: 'ok' }));
  r.get('/loan-schemes', asyncHandler(c.schemes));
  r.post('/quotes', limiter(on, 120), asyncHandler(c.quote));
  r.post('/leads', limiter(on, 10), asyncHandler(c.createLead));
  r.get('/leads', limiter(on, 60), adminAuth(deps.env.ADMIN_API_KEY), asyncHandler(c.listLeads));
  r.get('/chat/status', chat.status);
  r.post('/chat', limiter(on, 20), asyncHandler(chat.message));
  r.post('/chat/confirm', limiter(on, 20), asyncHandler(chat.confirm));
  return r;
}
