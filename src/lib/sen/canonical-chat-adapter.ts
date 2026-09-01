/**
 * Canonical /api/v1/sen/chat receipt -> chat-client shape adapter (S15 P1).
 *
 * The sen-plane daemon returns {command_id, turn_seq, turn_id, chat_attempt_id,
 * session_id, status, created_at}; the frontend chat client expects
 * {commandId, turnSeq, turnId, chatAttemptId, status, ...}. This module is the
 * ONLY seam between the two — consumers never reach the raw daemon shape.
 * `chatAttemptId`/`turnId` come from the durable product receipt (real
 * PKs), never synthesized.
 */

export interface CanonicalChatReceipt {
  command_id: string;
  turn_seq: number;
  turn_id: string;
  chat_attempt_id: string;
  session_id: string;
  status: string;
  created_at: string;
}

export interface ChatSendTurnShape {
  commandId: string;
  turnSeq: number;
  turnId: string;
  chatAttemptId: string;
  sessionId: string;
  status: string;
  createdAt: string;
}

export function mapCanonicalChatReceipt(r: CanonicalChatReceipt): ChatSendTurnShape {
  return {
    commandId: r.command_id,
    turnSeq: r.turn_seq,
    turnId: r.turn_id,
    chatAttemptId: r.chat_attempt_id,
    sessionId: r.session_id,
    status: r.status,
    createdAt: r.created_at,
  };
}