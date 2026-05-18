import type { Message, Role } from "./types.ts";

// §V69 — conservative OpenAI vision-floor token estimate per image
// attachment (low-detail tile). Real cost depends on image dimensions
// and detail mode; 85 tokens is the documented minimum so this estimate
// stays a floor, never an over-count.
export const IMAGE_TOKEN_FLOOR = 85;

export class Conversation {
  private messages: Message[];
  private readonly system: Message;
  private userTurnCount = 0;
  private imageTokenBudget = 0;

  constructor(
    systemPrompt: string,
    public readonly maxHistory: number,
  ) {
    if (maxHistory < 3) {
      throw new Error("maxHistory must be >= 3 (system + user + assistant turn).");
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
    const excess = this.messages.length - this.maxHistory;
    if (excess <= 0) return;

    const history = this.messages.slice(1);
    let keepFrom = Math.min(history.length, excess);
    if (history[keepFrom]?.role === "assistant") keepFrom += 1;
    this.messages = [this.system, ...history.slice(keepFrom)];
  }

  clear(): void {
    this.messages = [this.system];
    this.userTurnCount = 0;
    this.imageTokenBudget = 0;
  }

  // §V69 — accrue floor-token cost for each image attachment sent.
  // Pure additive: decay/respawn semantics live on the pet, not here.
  addImageAttachments(count: number): void {
    if (count <= 0) return;
    this.imageTokenBudget += count * IMAGE_TOKEN_FLOOR;
  }

  popLastAssistant(): boolean {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "assistant") {
      this.messages.pop();
      return true;
    }
    return false;
  }

  popLastUser(): boolean {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === "user") {
      this.messages.pop();
      this.userTurnCount = Math.max(0, this.userTurnCount - 1);
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

  get systemPrompt(): string {
    return this.system.content;
  }

  approximateTokens(): number {
    let chars = 0;
    for (const m of this.messages) chars += m.content.length;
    return Math.ceil(chars / 4) + this.imageTokenBudget;
  }
}
