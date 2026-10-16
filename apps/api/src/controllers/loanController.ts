import { leadListQuerySchema, leadRequestSchema, quoteRequestSchema } from '@goldloan/shared';
import type { Request, Response } from 'express';
import { parse } from '../lib/errors';
import type { Db } from '../lib/prisma';
import { createLead, listLeads } from '../services/leadService';
import { listLoanSchemes } from '../services/planService';
import { getQuote } from '../services/quoteService';

/** Thin controllers: parse → call service → serialise. All logic lives in services/domain. */
export const makeLoanController = (db: Db, now?: () => Date) => ({
  async schemes(_req: Request, res: Response) {
    res.json({ schemes: await listLoanSchemes(db) });
  },
  async quote(req: Request, res: Response) {
    const input = parse(quoteRequestSchema, req.body);
    res.json(await getQuote(db, input));
  },
  async createLead(req: Request, res: Response) {
    const input = parse(leadRequestSchema, req.body);
    res.status(201).json(await createLead({ db, now }, input));
  },
  async listLeads(req: Request, res: Response) {
    const query = parse(leadListQuerySchema, req.query);
    res.json(await listLeads(db, query));
  },
});
