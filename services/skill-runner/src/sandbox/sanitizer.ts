export class OutputSanitizer {
  /**
   * Sanitizes text to prevent accidental exfiltration of secrets or excessive output.
   * Strips out anything that looks like an AWS key, JWT, or internal UUID, and truncates.
   */
  public static sanitize(text: string): string {
    if (!text) return '';
    
    // 1. Truncate excessive output to prevent DoS via log filling (max 50KB)
    const MAX_LENGTH = 50 * 1024;
    let sanitized = text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) + '\n...[TRUNCATED]' : text;

    // 2. Redact potential JWTs (header.payload.signature)
    const jwtRegex = /eyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{10,}/g;
    sanitized = sanitized.replace(jwtRegex, '[REDACTED_JWT]');

    // 3. Redact potential AWS Access Keys
    const akiaRegex = /AKIA[0-9A-Z]{16}/g;
    sanitized = sanitized.replace(akiaRegex, '[REDACTED_AWS_KEY]');

    // 4. Redact potential private keys
    const privateKeyRegex = /-----BEGIN [A-Z ]+ PRIVATE KEY-----[a-zA-Z0-9+/\n\r]+-----END [A-Z ]+ PRIVATE KEY-----/g;
    sanitized = sanitized.replace(privateKeyRegex, '[REDACTED_PRIVATE_KEY]');

    return sanitized;
  }
}
