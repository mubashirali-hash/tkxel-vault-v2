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
 * AWS KMS Key Provider
 * Performs envelope key wrapping via AWS KMS API when deployed to AWS.
 */
export class AwsKmsProvider implements KmsProvider {
  private keyId: string;
  private region: string;

  constructor(keyId: string, region = 'us-east-1') {
    this.keyId = keyId;
    this.region = region;
  }

  async wrapKey(plaintextKey: Buffer): Promise<string> {
    if (plaintextKey.length !== 32) {
      throw new Error('DEK must be exactly 32 bytes (256 bits).');
    }
    try {
      // Dynamic import to allow optional peer dependency in dev environments
      const kmsModule = await (Function('return import("@aws-sdk/client-kms")')() as Promise<any>);
      const client = new kmsModule.KMSClient({ region: this.region });
      const cmd = new kmsModule.EncryptCommand({
        KeyId: this.keyId,
        Plaintext: plaintextKey,
      });
      const res = await client.send(cmd);
      if (!res.CiphertextBlob) throw new Error('KMS returned empty ciphertext blob.');
      return Buffer.from(res.CiphertextBlob).toString('base64');
    } catch (e: any) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
        throw new Error('AWS KMS SDK not installed. Run: pnpm add @aws-sdk/client-kms in @tkxel-vault/vault-core');
      }
      throw e;
    }
  }

  async unwrapKey(wrappedKeyString: string): Promise<Buffer> {
    const raw = Buffer.from(wrappedKeyString, 'base64');
    try {
      const kmsModule = await (Function('return import("@aws-sdk/client-kms")')() as Promise<any>);
      const client = new kmsModule.KMSClient({ region: this.region });
      const cmd = new kmsModule.DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: raw,
      });
      const res = await client.send(cmd);
      if (!res.Plaintext) throw new Error('KMS returned empty plaintext blob.');
      return Buffer.from(res.Plaintext);
    } catch (e: any) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
        throw new Error('AWS KMS SDK not installed. Run: pnpm add @aws-sdk/client-kms in @tkxel-vault/vault-core');
      }
      throw e;
    }
  }
}

/**
 * Pluggable KMS Provider Factory
 */
export function createKmsProvider(): KmsProvider {
  const provider = (process.env.KMS_PROVIDER || 'mock').toLowerCase();
  if (provider === 'aws') {
    const keyId = process.env.AWS_KMS_KEY_ID;
    if (!keyId) {
      console.warn('[KMS] AWS_KMS_KEY_ID unset; defaulting to MockKmsProvider.');
      return new MockKmsProvider();
    }
    return new AwsKmsProvider(keyId, process.env.AWS_REGION || 'us-east-1');
  }
  const secret = process.env.VAULT_MASTER_SECRET || 'tkxel-vault-default-local-master-key-32b!';
  return new MockKmsProvider(secret);
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
