import { log } from "@/lib/log";

export interface AlimtalkMessage {
  to: string;
  template: "finder_message" | "test";
  vars: Record<string, string>;
}

export interface SmsMessage {
  to: string;
  text: string;
}

/** 발송 실패는 예외로 알린다. 재시도·대체 발송은 호출하는 쪽(notifications)이 맡는다. */
export interface Notifier {
  sendAlimtalk(message: AlimtalkMessage): Promise<void>;
  sendSms(message: SmsMessage): Promise<void>;
}

export interface OutboxItem {
  channel: "alimtalk" | "sms";
  to: string;
  payload: AlimtalkMessage | SmsMessage;
  at: Date;
}

/**
 * 개발·테스트용. 실제로 보내지 않고 기록만 한다.
 * @AX:TODO: 알림톡 딜러사(API 키·발신프로필·템플릿 승인)가 정해지면 운영용 Notifier를 구현한다.
 */
export class ConsoleNotifier implements Notifier {
  readonly outbox: OutboxItem[] = [];
  failAlimtalk = false;
  failSms = false;

  async sendAlimtalk(message: AlimtalkMessage): Promise<void> {
    if (this.failAlimtalk) throw new Error("alimtalk provider unavailable (simulated)");
    this.outbox.push({ channel: "alimtalk", to: message.to, payload: message, at: new Date() });
    // 개발 전용: 답장 화면을 바로 열어 볼 수 있게 링크를 남긴다(운영 로그의 link 키는 가려진다).
    log.info({ event: "notify.alimtalk", template: message.template, devLink: message.vars.link }, "alimtalk (console)");
  }

  async sendSms(message: SmsMessage): Promise<void> {
    if (this.failSms) throw new Error("sms provider unavailable (simulated)");
    this.outbox.push({ channel: "sms", to: message.to, payload: message, at: new Date() });
    log.info({ event: "notify.sms" }, "sms (console)");
  }
}
