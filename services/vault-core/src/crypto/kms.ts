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
 * Azure Key Vault Key Provider.
 *
 * Uses the Azure Key Vault REST API's wrapkey/unwrapkey operations. The bearer
 * token is supplied by the deployment's workload identity integration and is
 * never persisted or logged by this provider.
 */
export class AzureKeyVaultProvider implements KmsProvider {
  private vaultUrl: string;
  private keyName: string;
  private bearerToken: string;

  constructor(vaultUrl: string, keyName: string, bearerToken: string) {
    if (!vaultUrl || !keyName || !bearerToken) {
      throw new Error('Azure Key Vault requires vault URL, key name, and workload identity bearer token.');
    }
    this.vaultUrl = vaultUrl.replace(/\/+$/, '');
    this.keyName = keyName;
    this.bearerToken = bearerToken;
  }

  async wrapKey(plaintextKey: Buffer): Promise<string> {
    if (plaintextKey.length !== 32) {
      throw new Error('DEK must be exactly 32 bytes (256 bits).');
    }
    const value = await this.callKeyOperation('wrapkey', {
      alg: 'RSA-OAEP-256',
      value: plaintextKey.toString('base64url'),
    });
    return value;
  }

  async unwrapKey(wrappedKeyString: string): Promise<Buffer> {
    const value = await this.callKeyOperation('unwrapkey', {
      alg: 'RSA-OAEP-256',
      value: wrappedKeyString,
    });
    return Buffer.from(value, 'base64url');
  }

  private async callKeyOperation(operation: 'wrapkey' | 'unwrapkey', body: Record<string, string>): Promise<string> {
    const response = await fetch(
      `${this.vaultUrl}/keys/${encodeURIComponent(this.keyName)}/${operation}?api-version=7.4`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      throw new Error(`Azure Key Vault ${operation} request failed with status ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || typeof (payload as { value?: unknown }).value !== 'string') {
      throw new Error(`Azure Key Vault ${operation} response missing value.`);
    }
    return (payload as { value: string }).value;
  }
}

/**
 * Standalone HTTP KMS Provider
 * Connects over HTTP to an external KMS / HSM endpoint with bearer authentication.
 */
export class HttpKmsProvider implements KmsProvider {
  private endpoint: string;
  private apiKey: string;

  constructor(endpoint: string, apiKey = '') {
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async wrapKey(plaintextKey: Buffer): Promise<string> {
    if (plaintextKey.length !== 32) {
      throw new Error('DEK must be exactly 32 bytes (256 bits).');
    }
    const res = await fetch(`${this.endpoint}/kms/wrap-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ plaintextKey: plaintextKey.toString('base64') }),
    });
    if (!res.ok) {
      throw new Error(`KMS wrap-key request failed with status ${res.status}`);
    }
    const data: any = await res.json();
    if (!data.wrappedKey) {
      throw new Error('KMS wrap-key response missing wrappedKey.');
    }
    return data.wrappedKey;
  }

  async unwrapKey(wrappedKeyString: string): Promise<Buffer> {
    const res = await fetch(`${this.endpoint}/kms/unwrap-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ wrappedKey: wrappedKeyString }),
    });
    if (!res.ok) {
      throw new Error(`KMS unwrap-key request failed with status ${res.status}`);
    }
    const data: any = await res.json();
    if (!data.plaintextKey) {
      throw new Error('KMS unwrap-key response missing plaintextKey.');
    }
    return Buffer.from(data.plaintextKey, 'base64');
  }
}

/**
 * Pluggable KMS Provider Factory
 */
export function createKmsProvider(): KmsProvider {
  const provider = (process.env.KMS_PROVIDER || 'mock').toLowerCase();
  if (provider === 'http') {
    if (process.env.NODE_ENV === 'production' && process.env.ACCEPTANCE_TESTING !== 'true') {
      throw new Error('FATAL: HTTP KMS provider is acceptance-only and not permitted in production. Configure AWS KMS (KMS_PROVIDER=aws) or Azure Key Vault.');
    }
    const endpoint = process.env.KMS_ENDPOINT || 'http://127.0.0.1:8443';
    if (process.env.ACCEPTANCE_TESTING === 'true') {
      const host = new URL(endpoint).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        throw new Error('FATAL: acceptance HTTP KMS must use a loopback contract-test-double endpoint.');
      }
    }
    return new HttpKmsProvider(endpoint, process.env.KMS_API_KEY || '');
  }
  if (provider === 'aws') {
    const keyId = process.env.AWS_KMS_KEY_ID;
    if (!keyId) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: AWS_KMS_KEY_ID must be configured in production when KMS_PROVIDER=aws.');
      }
      console.warn('[KMS] AWS_KMS_KEY_ID unset; defaulting to MockKmsProvider.');
      return new MockKmsProvider();
    }
    return new AwsKmsProvider(keyId, process.env.AWS_REGION || 'us-east-1');
  }
  if (provider === 'azure') {
    const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
    const keyName = process.env.AZURE_KEY_VAULT_KEY_NAME;
    const bearerToken = process.env.AZURE_KEY_VAULT_BEARER_TOKEN;
    if (!vaultUrl || !keyName || !bearerToken) {
      throw new Error(
        'FATAL: Azure Key Vault requires AZURE_KEY_VAULT_URL, AZURE_KEY_VAULT_KEY_NAME, and AZURE_KEY_VAULT_BEARER_TOKEN.'
      );
    }
    return new AzureKeyVaultProvider(vaultUrl, keyName, bearerToken);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Mock KMS provider is not permitted in production. Configure AWS KMS (KMS_PROVIDER=aws) or Azure Key Vault.');
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
