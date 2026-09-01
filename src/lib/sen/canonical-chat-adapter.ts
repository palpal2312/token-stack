/**
 * Canonical /api/v1/sen/chat receipt -> chat-client shape adapter (S15 P1).
 *
 * The sen-plane daemon returns {command_id, turn_seq, session_id, created_at};
 * the frontend chat client expects {commandId, turnSeq, chatAttemptId, status,
 * ...}. This module is the ONLY seam between the two — consumers never reach
 * the raw daemon shape.
 */

export interface CanonicalChatReceipt {
  command_id: string;
  turn_seq: number;
  session_id: string;
  created_at: string;
}

export interface ChatSendTurnShape {
  commandId: string;
  turnSeq: number;
  chatAttemptId: string;
  sessionId: string;
  status: "sent";
  createdAt: string;
}

export function mapCanonicalChatReceipt(r: CanonicalChatReceipt): ChatSendTurnShape {
  return {
    commandId: r.command_id,
    turnSeq: r.turn_seq,
    chatAttemptId: r.command_id, // one replay key per durable turn
    sessionId: r.session_id,
    status: "sent",
    createdAt: r.created_at,
  };
}