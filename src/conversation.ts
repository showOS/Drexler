import type { Message, Role } from "./types.ts";

export class Conversation {
  private messages: Message[];
  private readonly system: Message;
  private userTurnCount = 0;

  constructor(
    systemPrompt: string,
    public readonly maxHistory: number,
  ) {
    if (maxHistory < 3) {
      throw new Error(
        "maxHistory must be >= 3 (system + user + assistant turn).",
      );
    }
    this.system = { role: "system", content: systemPrompt };
    this.messages = [this.system];
  }

  push(role: Exclude<Role, "system">, content: string): void {
    this.messages.push({ role, content });
    if (role === "user") this.userTurnCount++;
    this.trim();
  }

  private trim(): void {
    while (this.messages.length > this.maxHistory) {
      this.messages.splice(1, 1);
      if (this.messages[1]?.role === "assistant") {
        this.messages.splice(1, 1);
      }
    }
  }

  clear(): void {
    this.messages = [this.system];
    this.userTurnCount = 0;
  }

  popLastAssistant(): boolean {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "assistant") {
      this.messages.pop();
      return true;
    }
    return false;
  }

  lastUserMessage(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m && m.role === "user") return m.content;
    }
    return null;
  }

  snapshot(): Message[] {
    return this.messages.slice();
  }

  get length(): number {
    return this.messages.length - 1;
  }

  get userTurns(): number {
    return this.userTurnCount;
  }

  approximateTokens(): number {
    let chars = 0;
    for (const m of this.messages) chars += m.content.length;
    return Math.ceil(chars / 4);
  }
}
