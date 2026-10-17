/**
 * approvals domain contract. The approval requested frame is a
 * server-request (stable rpcId); the answer is a client-response echoing that rpcId (not a
 * unary method, not in RpcMethodMap, mints no new id), carried on POST /api/respond with an
 * RpcReceipt carrier receipt as the HTTP response body; the final outcome arrives in the resolved frame.
 * Answering is scoped like the session domain: only a caller whose web identity may see the
 * asking session is served; anyone else (and any unknown id) reads not-pending. A duplicate
 * answer after the first one settled reads already-resolved while the id stays within the
 * bounded resolved-answer memory.
 */

import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Approval answer payload (the result.value slot of a client-response). outcome accepts only
 * the two values a client can give (cancelled/unavailable are host-side outcomes). approvalId
 * is the core audit correlation (used by the impl to reconcile `approval/asked`/`decided`;
 * passes through core's existing brand); wire correlation is governed by the echoed rpcId.
 */
export interface ApprovalResponsePayload {
  sessionId: SessionId
  approvalId: ApprovalRequestId
  outcome: 'allowed-once' | 'rejected'
}
