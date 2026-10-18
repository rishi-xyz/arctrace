import type { FastifyInstance } from 'fastify';
import type { OrgUser } from '@arctrace/shared';
import { requireUser } from '../lib/auth.js';
import { orgMembers } from './helpers.js';
import type { Ctx } from '../types.js';

export async function orgRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const { db } = ctx;

  /** Org directory — the Share page's recipient picker (spec §6 org model). */
  app.get('/org/members', { onRequest: app.authenticate }, async (req): Promise<OrgUser[]> => {
    const user = requireUser(req);
    return orgMembers(db, user.orgId);
  });
}
