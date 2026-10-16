import { chatConfirmRequestSchema, chatMessageRequestSchema } from '@goldloan/shared';
import type { Request, Response } from 'express';
import type { AgentDeps } from '../ai/agent';
import { parse } from '../lib/errors';
import { handleChatMessage, handleConfirm } from '../services/chatService';

export const makeChatController = (deps: AgentDeps) => ({
  async message(req: Request, res: Response) {
    res.json(await handleChatMessage(deps, parse(chatMessageRequestSchema, req.body)));
  },
  async confirm(req: Request, res: Response) {
    res.json(await handleConfirm(deps, parse(chatConfirmRequestSchema, req.body)));
  },
  status(_req: Request, res: Response) {
    res.json({ mode: deps.llm.mode });
  },
});
