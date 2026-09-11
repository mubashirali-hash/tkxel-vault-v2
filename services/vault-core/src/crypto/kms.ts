import crypto from 'node:crypto';

/**
 * KMS Provider Interface
 * Supports AWS KMS, Azure Key Vault, or local test provider
 */
export interface KmsProvider {
  wrapKey(plaintextKey: Buffer): Promise<string>;
  unwrapKey(wrappedKeyString: string): Promise<Buffer>;
}

/**
 * Local / Development KMS Mock Provider
 * Uses master key derivation (AES-256-KeyWrap / HMAC) for local testing without cloud credentials.
 */
export class MockKmsProvider implements KmsProvider {
  private masterKey: Buffer;

  constructor(masterSecret = 'tkxel-vault-default-local-master-key-32b!') {
    this.masterKey = crypto.createHash('sha256').update(masterSecret).digest();
  }

  async wrapKey(plaintextKey: Buffer): Promise<string> {
    if (plaintextKey.length !== 32) {
      throw new Error('DEK must be exactly 32 bytes (256 bits).');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Packed as base64: iv (12) + tag (16) + encrypted (32) = 60 bytes
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  async unwrapKey(wrappedKeyString: string): Promise<Buffer> {
    const raw = Buffer.from(wrappedKeyString, 'base64');
    if (raw.length < 28) {
      throw new Error('Invalid wrapped key payload length.');
    }
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

/**
 * AES-256-GCM Envelope Encryption Engine
 * Enforces authenticated encryption at rest for pages, skills, and chunks.
 */
export class EnvelopeEncryption {
  static generateDek(): Buffer {
    return crypto.randomBytes(32);
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Output buffer format: [12 bytes IV] + [16 bytes AuthTag] + [Ciphertext]
   */
  static encrypt(plaintext: string | Buffer, dek: Buffer): Buffer {
    if (dek.length !== 32) {
      throw new Error('Data Encryption Key must be 32 bytes.');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const inputBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf-8');
    const encrypted = Buffer.concat([cipher.update(inputBuf), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]);
  }

  /**
   * Decrypts AES-256-GCM buffer.
   * Expects format: [12 bytes IV] + [16 bytes AuthTag] + [Ciphertext]
   */
  static decrypt(encryptedPayload: Buffer, dek: Buffer): Buffer {
    if (dek.length !== 32) {
      throw new Error('Data Encryption Key must be 32 bytes.');
    }
    if (encryptedPayload.length < 28) {
      throw new Error('Encrypted payload too short to contain IV and Auth Tag.');
    }
    const iv = encryptedPayload.subarray(0, 12);
    const tag = encryptedPayload.subarray(12, 28);
    const ciphertext = encryptedPayload.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Decrypts payload directly to a UTF-8 string.
   */
  static decryptToString(encryptedPayload: Buffer, dek: Buffer): string {
    return this.decrypt(encryptedPayload, dek).toString('utf-8');
  }
}
