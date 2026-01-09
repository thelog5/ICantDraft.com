import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;

/**
 * Get encryption key from environment
 * Must be 32 bytes (256 bits) for AES-256
 */
function getEncryptionKey(): Buffer {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY environment variable is required');
  }

  // Try to parse as base64 or hex
  let keyBuffer: Buffer;
  try {
    keyBuffer = Buffer.from(key, 'base64');
    if (keyBuffer.length !== 32) {
      keyBuffer = Buffer.from(key, 'hex');
    }
  } catch {
    keyBuffer = Buffer.from(key, 'hex');
  }

  if (keyBuffer.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (256 bits). Provide as base64 or hex.');
  }

  return keyBuffer;
}

/**
 * Encrypt sensitive data (ESPN credentials)
 * Returns base64-encoded string: iv:authTag:encryptedData
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Combine iv:authTag:encrypted as base64
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt sensitive data
 * Expects format: iv:authTag:encryptedData (all base64)
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Encode ESPN credentials for storage
 */
export function encodeCredentials(espn_s2: string, swid: string): string {
  return `${espn_s2}:${swid}`;
}

/**
 * Decode ESPN credentials from storage
 */
export function decodeCredentials(encoded: string): { espn_s2: string; swid: string } {
  const [espn_s2, swid] = encoded.split(':');
  if (!espn_s2 || !swid) {
    throw new Error('Invalid credentials format');
  }
  return { espn_s2, swid };
}

