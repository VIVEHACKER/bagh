export const LANGS = ["ko", "en", "ja", "zh"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };

export interface FinderText {
  title: string;
  subtitle: string;
  noApp: string;
  reasonLegend: string;
  reasons: Record<"found" | "left_behind" | "other", string>;
  placeLabel: string;
  placeHint: string;
  bodyLabel: string;
  bodyHint: string;
  contactWarning: string;
  send: string;
  sending: string;
  sentTitle: string;
  sentHint: string;
  deferredHint: string;
  savedTitle: string;
  savedHint: string;
  ownerReply: string;
  yourMessage: string;
  followUp: string;
  remaining: (n: number) => string;
  replies: Record<"thanks_keep" | "thanks_desk" | "coming" | "seen", string>;
  unregisteredTitle: string;
  unregisteredBody: string;
  unavailableTitle: string;
  unavailableBody: string;
  notFoundTitle: string;
  notFoundBody: string;
  errors: Record<"rate_limited" | "sticker_not_active" | "thread_full" | "thread_blocked" | "thread_expired" | "default", string>;
}

export const FINDER_TEXT: Record<Lang, FinderText> = {
  ko: {
    title: "이 물건의 주인에게 알려 주세요",
    subtitle: "주인의 전화번호는 공개되지 않아요. 남긴 내용은 주인에게 알림으로 전달돼요.",
    noApp: "앱 설치나 회원가입은 필요 없어요.",
    reasonLegend: "무슨 일인가요?",
    reasons: { found: "주웠어요", left_behind: "여기 두고 가셨어요", other: "기타" },
    placeLabel: "지금 있는 곳 (선택)",
    placeHint: "예: 클럽하우스 안내데스크",
    bodyLabel: "메시지 (선택)",
    bodyHint: "주인에게 전할 말을 적어 주세요",
    contactWarning: "연락처를 적으면 주인에게 그대로 전달돼요.",
    send: "주인에게 알리기",
    sending: "보내는 중…",
    sentTitle: "주인에게 알렸어요",
    sentHint: "주인이 답장하면 이 화면에 나타나요. 창을 닫아도 다시 스캔하면 볼 수 있어요.",
    deferredHint: "주인에게 곧 전달돼요.",
    savedTitle: "메시지를 남겼어요",
    savedHint: "알림 한도에 걸려 이번 메시지는 알림 없이 저장했어요. 주인이 사이트에서 확인하면 이 화면에 답장이 나타나요.",
    ownerReply: "주인의 답장",
    yourMessage: "보낸 내용",
    followUp: "추가로 알리기",
    remaining: (n) => `보낼 수 있는 메시지 ${n}개`,
    replies: {
      thanks_keep: "감사합니다! 그 자리에 두시면 찾으러 갈게요",
      thanks_desk: "감사합니다! 가까운 안내데스크에 맡겨 주세요",
      coming: "지금 찾으러 갈게요",
      seen: "메시지 확인했어요",
    },
    unregisteredTitle: "아직 등록되지 않은 태그예요",
    unregisteredBody: "이 태그의 주인이라면 사이트에서 등록 코드를 입력해 주세요.",
    unavailableTitle: "지금은 연락을 받지 않는 태그예요",
    unavailableBody: "주인이 알림을 잠시 꺼 두었어요.",
    notFoundTitle: "태그를 찾을 수 없어요",
    notFoundBody: "태그에 적힌 코드를 다시 확인해 주세요.",
    errors: {
      rate_limited: "잠시 뒤에 다시 시도해 주세요.",
      sticker_not_active: "지금은 연락을 받지 않는 태그예요.",
      thread_full: "이 대화에서 보낼 수 있는 메시지를 모두 썼어요.",
      thread_blocked: "주인이 더는 메시지를 받지 않기로 했어요.",
      thread_expired: "대화 기간이 끝났어요.",
      default: "보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.",
    },
  },
  en: {
    title: "Let the owner of this item know",
    subtitle: "The owner's phone number stays private. Your note is sent to them as a notification.",
    noApp: "No app or sign-up needed.",
    reasonLegend: "What happened?",
    reasons: { found: "I found it", left_behind: "It was left here", other: "Other" },
    placeLabel: "Where is it now? (optional)",
    placeHint: "e.g. clubhouse front desk",
    bodyLabel: "Message (optional)",
    bodyHint: "Write a note to the owner",
    contactWarning: "If you add your contact details, they will be shared with the owner.",
    send: "Notify the owner",
    sending: "Sending…",
    sentTitle: "The owner has been notified",
    sentHint: "Replies will appear here. You can close this page and scan again later.",
    deferredHint: "It will reach the owner shortly.",
    savedTitle: "Your message was saved",
    savedHint: "The alert limit was reached, so this message was saved without an alert. Replies will appear here once the owner checks the site.",
    ownerReply: "Owner's reply",
    yourMessage: "You sent",
    followUp: "Send another note",
    remaining: (n) => `${n} messages left`,
    replies: {
      thanks_keep: "Thank you! Please leave it there and I'll come get it",
      thanks_desk: "Thank you! Please leave it at the nearest front desk",
      coming: "I'm on my way",
      seen: "Got your message",
    },
    unregisteredTitle: "This tag isn't registered yet",
    unregisteredBody: "If this is your tag, enter the registration code on our website.",
    unavailableTitle: "This tag isn't receiving messages right now",
    unavailableBody: "The owner has paused notifications.",
    notFoundTitle: "Tag not found",
    notFoundBody: "Please check the code printed on the tag.",
    errors: {
      rate_limited: "Please try again in a moment.",
      sticker_not_active: "This tag isn't receiving messages right now.",
      thread_full: "You've used all messages for this conversation.",
      thread_blocked: "The owner is no longer receiving messages here.",
      thread_expired: "This conversation has ended.",
      default: "Couldn't send. Please try again shortly.",
    },
  },
  ja: {
    title: "この持ち物の持ち主に知らせてください",
    subtitle: "持ち主の電話番号は公開されません。内容は通知で持ち主に届きます。",
    noApp: "アプリのインストールや会員登録は不要です。",
    reasonLegend: "どうしましたか？",
    reasons: { found: "拾いました", left_behind: "ここに置き忘れています", other: "その他" },
    placeLabel: "今ある場所（任意）",
    placeHint: "例：クラブハウスの受付",
    bodyLabel: "メッセージ（任意）",
    bodyHint: "持ち主への伝言を書いてください",
    contactWarning: "連絡先を書くと、そのまま持ち主に伝わります。",
    send: "持ち主に知らせる",
    sending: "送信中…",
    sentTitle: "持ち主に知らせました",
    sentHint: "返信はこの画面に表示されます。閉じても、もう一度スキャンすれば確認できます。",
    deferredHint: "まもなく持ち主に届きます。",
    savedTitle: "メッセージを保存しました",
    savedHint: "通知の上限に達したため、今回のメッセージは通知せずに保存しました。持ち主がサイトで確認すると、この画面に返信が表示されます。",
    ownerReply: "持ち主からの返信",
    yourMessage: "送った内容",
    followUp: "追加で知らせる",
    remaining: (n) => `あと ${n} 件送れます`,
    replies: {
      thanks_keep: "ありがとうございます！そのまま置いておいてください。取りに行きます",
      thanks_desk: "ありがとうございます！近くの受付に預けてください",
      coming: "今から取りに行きます",
      seen: "メッセージを確認しました",
    },
    unregisteredTitle: "まだ登録されていないタグです",
    unregisteredBody: "このタグの持ち主の方は、サイトで登録コードを入力してください。",
    unavailableTitle: "現在メッセージを受け付けていないタグです",
    unavailableBody: "持ち主が通知を一時停止しています。",
    notFoundTitle: "タグが見つかりません",
    notFoundBody: "タグに書かれたコードをもう一度ご確認ください。",
    errors: {
      rate_limited: "しばらくしてからもう一度お試しください。",
      sticker_not_active: "現在メッセージを受け付けていないタグです。",
      thread_full: "この会話で送れるメッセージをすべて使いました。",
      thread_blocked: "持ち主はこの会話のメッセージを受け付けていません。",
      thread_expired: "会話の期間が終了しました。",
      default: "送信できませんでした。しばらくしてからお試しください。",
    },
  },
  zh: {
    title: "通知此物品的主人",
    subtitle: "主人的电话号码不会公开。您的留言将以通知形式发送给主人。",
    noApp: "无需安装应用或注册。",
    reasonLegend: "发生了什么？",
    reasons: { found: "我捡到了", left_behind: "它被遗留在这里", other: "其他" },
    placeLabel: "现在放在哪里？（可选）",
    placeHint: "例如：会所前台",
    bodyLabel: "留言（可选）",
    bodyHint: "写下想对主人说的话",
    contactWarning: "如填写联系方式，将直接发送给主人。",
    send: "通知主人",
    sending: "发送中…",
    sentTitle: "已通知主人",
    sentHint: "主人回复后会显示在这里。关闭页面后再次扫描即可查看。",
    deferredHint: "稍后将送达主人。",
    savedTitle: "留言已保存",
    savedHint: "已达到通知上限，这条留言已保存但未发送通知。主人在网站上查看后，回复会显示在此页面。",
    ownerReply: "主人的回复",
    yourMessage: "您发送的内容",
    followUp: "再发一条",
    remaining: (n) => `还可发送 ${n} 条`,
    replies: {
      thanks_keep: "谢谢！请放在原处，我会去取",
      thanks_desk: "谢谢！请交给附近的服务台",
      coming: "我马上过去取",
      seen: "已收到您的留言",
    },
    unregisteredTitle: "此标签尚未注册",
    unregisteredBody: "如果您是此标签的主人，请在网站输入注册码。",
    unavailableTitle: "此标签目前不接收消息",
    unavailableBody: "主人已暂停通知。",
    notFoundTitle: "未找到标签",
    notFoundBody: "请再次确认标签上的代码。",
    errors: {
      rate_limited: "请稍后再试。",
      sticker_not_active: "此标签目前不接收消息。",
      thread_full: "此对话的消息数量已用完。",
      thread_blocked: "主人已不再接收此对话的消息。",
      thread_expired: "对话期限已结束。",
      default: "发送失败，请稍后再试。",
    },
  },
};

/** Accept-Language에서 지원 언어를 고른다. 없으면 한국어. */
export function pickLang(acceptLanguage: string | null | undefined): Lang {
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { base: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .filter((p) => p.base && !Number.isNaN(p.q))
    .sort((a, b) => b.q - a.q);
  const hit = prefs.find((p) => (LANGS as readonly string[]).includes(p.base));
  return (hit?.base as Lang | undefined) ?? "ko";
}
