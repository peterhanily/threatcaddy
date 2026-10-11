import { Hono } from 'hono';
import { AdminAuthorizationError, getAdminAiPrincipal, requireAdminAuth } from '../../middleware/admin-auth.js';
import { AdminAiApprovalError, adminAiApprovals } from '../../services/admin-ai-approvals.js';
import { assertCurrentAdminAiSession, executeApprovedAdminAiTool } from '../../services/admin-ai-service.js';
import { readBoundedBytes } from '../../lib/bounded-http.js';

const app = new Hono();

app.post('/api/ai/approvals/:id', requireAdminAuth, async c => {
  c.header('Cache-Control', 'no-store');
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Approval deadline exceeded', 'AbortError')), 30_000);
  const signal = AbortSignal.any([c.req.raw.signal, deadline.signal]);
  try {
    if (signal.aborted) return c.json({ error: 'Action cancelled.', code: 'ACTION_CANCELLED' }, 408);
    let text: string;
    try { text = new TextDecoder().decode(await readBoundedBytes(c.req.raw.body, 256, signal)); }
    catch (error) {
      if (signal.aborted) throw error;
      return c.json({ error: 'Invalid or oversized approval decision.', code: 'INVALID_DECISION' }, 400);
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch { return c.json({ error: 'Invalid approval decision.', code: 'INVALID_DECISION' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('decision' in body)
      || (body.decision !== 'approve' && body.decision !== 'reject')) {
      return c.json({ error: 'Send only an approve or reject decision; action arguments cannot be replaced.', code: 'INVALID_DECISION' }, 400);
    }
    const context = { principal: getAdminAiPrincipal(c), signal };
    await assertCurrentAdminAiSession(context);
    const receipt = await adminAiApprovals.decide(c.req.param('id'), body.decision, context.principal,
      (name, input) => executeApprovedAdminAiTool(name, input, context));
    return c.json(receipt, receipt.status === 'executing' ? 202 : 200);
  } catch (error) {
    if (error instanceof AdminAiApprovalError || error instanceof AdminAuthorizationError) return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof Error && error.name === 'AbortError') return c.json({ error: 'Action cancelled.', code: 'ACTION_CANCELLED' }, 408);
    return c.json({ error: 'Approval could not be processed. Retry this same approval to check its result.', code: 'APPROVAL_UNAVAILABLE' }, 503);
  } finally {
    clearTimeout(timer);
  }
});

export default app;
