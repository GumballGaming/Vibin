export class VibinError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = "VibinError";
  }
}
