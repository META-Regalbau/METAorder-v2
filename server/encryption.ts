import crypto from 'crypto';

// Encryption algorithm
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;

// Get encryption key from environment or generate a secure default
// In production, ENCRYPTION_KEY should be set in environment variables
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    console.warn('[Encryption] WARNING: ENCRYPTION_KEY not set in environment. Using default key. SET THIS IN PRODUCTION!');
    // Default key for development only - should be replaced in production
    return crypto.scryptSync('default-dev-key-change-in-production', 'salt', 32);
  }
  
  // Derive a 256-bit key from the environment variable
  return crypto.scryptSync(key, 'salt', 32);
}

/**
 * Encrypt a string value
 * @param text - Plain text to encrypt
 * @returns Encrypted string in format: iv:authTag:encryptedData
 */
export function encrypt(text: string): string {
  if (!text) return text;
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string
 * @param encryptedText - Encrypted string in format: iv:authTag:encryptedData
 * @returns Decrypted plain text
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return encryptedText;
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      // Not encrypted or wrong format, return as is
      return encryptedText;
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('[Encryption] Decryption failed:', error);
    // Return original text if decryption fails (might be unencrypted legacy data)
    return encryptedText;
  }
}
