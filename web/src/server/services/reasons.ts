export const REASON_CODES = ["found", "left_behind", "other"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABEL_KO: Record<ReasonCode, string> = {
  found: "주웠어요",
  left_behind: "여기 두고 가셨어요",
  other: "기타",
};

export const REPLY_CODES = ["thanks_keep", "thanks_desk", "coming", "seen"] as const;
export type ReplyCode = (typeof REPLY_CODES)[number];

export const REPLY_LABEL_KO: Record<ReplyCode, string> = {
  thanks_keep: "감사합니다! 그 자리에 두시면 찾으러 갈게요",
  thanks_desk: "감사합니다! 가까운 안내데스크에 맡겨 주세요",
  coming: "지금 찾으러 갈게요",
  seen: "메시지 확인했어요",
};
