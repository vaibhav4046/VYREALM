import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { youtubeError } from './youtube-errors.mjs';

const MAX_PLAINTEXT = 1024 * 1024;
const storeError = () => youtubeError('YOUTUBE_PROTECTED_STORE_REQUIRED', 'A qualified operating-system protected credential store is required. No plaintext fallback is available.');

/** Secrets travel only over child stdin/stdout, never command arguments, environment or logs. */
export function windowsDataProtection({ platform = process.platform } = {}) {
  const qualified = platform === 'win32' && process.platform === 'win32';
  const information = { protected: qualified, qualified, mechanism: 'windows-dpapi-current-user', platform, diagnostic: qualified ? 'Windows CurrentUser DPAPI; test with a temporary credential before account connection.' : 'Windows DPAPI is unavailable on this platform.' };
  async function transform(value, decrypt = false) {
    if (!qualified) throw storeError();
    if (!Buffer.isBuffer(value) || value.length > MAX_PLAINTEXT * 2) throw youtubeError('YOUTUBE_VAULT_INVALID', 'Credential payload exceeds the storage limit.');
    const operation = decrypt ? 'Unprotect' : 'Protect';
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=[Text.Encoding]::UTF8.GetBytes('VYREALM.YouTube.v1'); $result=[Security.Cryptography.ProtectedData]::${operation}($inputBytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let failed = false;
      const fail = () => { if (failed) return; failed = true; child.kill(); reject(youtubeError('YOUTUBE_VAULT_PROTECTION_FAILED', 'Operating-system credential protection failed. Reconnect only after repairing the protected store.')); };
      const timer = setTimeout(fail, 15000); timer.unref?.();
      child.on('error', fail); child.stdin.on('error', fail);
      child.stdout.on('data', data => { output += data.toString('utf8'); if (output.length > MAX_PLAINTEXT * 3) fail(); });
      // Never include PowerShell stderr in diagnostics: it may quote the credential payload.
      child.stderr.resume();
      child.on('close', code => { clearTimeout(timer); if (failed) return; if (code !== 0 || !/^[A-Za-z0-9+/=]+$/.test(output)) return fail(); resolve(Buffer.from(output, 'base64')); });
      child.stdin.end(value.toString('base64'));
    });
  }
  return { information, encrypt: value => transform(value), decrypt: value => transform(value, true) };
}

/** Stores only an authenticated OS-protected blob. Use one owning service instance per vault. */
export function createYouTubeVault({ filePath, platform = process.platform, protection = platform === 'win32' ? windowsDataProtection({ platform }) : null } = {}) {
  if (!filePath || !path.isAbsolute(filePath)) throw youtubeError('YOUTUBE_VAULT_INVALID', 'An absolute credential-store path is required.');
  const information = protection?.information || { protected: false, qualified: false, platform, mechanism: 'unavailable', diagnostic: platform === 'darwin' ? 'macOS Keychain integration has not been qualified; account connection is blocked.' : 'No qualified OS credential provider is available.' };
  let cachedKey = null; let cachedWrappedKey = null;
  const associatedData = Buffer.from(`VYREALM.YouTube.vault.v2:${information.mechanism}`);
  function requireProtection() { if (!information.protected || !information.qualified || !protection?.encrypt || !protection?.decrypt) throw storeError(); }
  function forgetKey() { cachedKey?.fill(0); cachedKey = null; cachedWrappedKey = null; }
  async function encryptionKey(wrappedKey) {
    if (cachedKey && (!wrappedKey || wrappedKey === cachedWrappedKey)) return cachedKey;
    forgetKey();
    if (wrappedKey) {
      const unwrapped = await protection.decrypt(Buffer.from(wrappedKey, 'base64'));
      if (unwrapped.length !== 32) { unwrapped.fill(0); throw new Error('Invalid protected key'); }
      cachedKey = unwrapped; cachedWrappedKey = wrappedKey;
    } else {
      const key = crypto.randomBytes(32);
      try { cachedWrappedKey = (await protection.encrypt(key)).toString('base64'); cachedKey = key; } catch (error) { key.fill(0); throw error; }
    }
    return cachedKey;
  }
  return {
    protection: () => ({ ...information }),
    async read() {
      requireProtection(); let raw;
      try { const stat = await fs.lstat(filePath); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PLAINTEXT * 3) throw new Error(); raw = await fs.readFile(filePath, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return {}; throw youtubeError('YOUTUBE_VAULT_INVALID', 'Protected credential file could not be read.'); }
      try {
        const envelope = JSON.parse(raw);
        if (envelope.version !== 2 || envelope.protection !== information.mechanism || ['ciphertext', 'wrappedKey', 'nonce', 'tag'].some(field => typeof envelope[field] !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(envelope[field]))) throw new Error();
        const key = await encryptionKey(envelope.wrappedKey); const nonce = Buffer.from(envelope.nonce, 'base64'); const tag = Buffer.from(envelope.tag, 'base64');
        if (nonce.length !== 12 || tag.length !== 16) throw new Error();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(associatedData); decipher.setAuthTag(tag);
        const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
        try { if (bytes.length > MAX_PLAINTEXT) throw new Error(); const result = JSON.parse(bytes.toString('utf8')); if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error(); return result; }
        finally { bytes.fill(0); }
      } catch { forgetKey(); throw youtubeError('YOUTUBE_VAULT_INVALID', 'Credentials could not be decrypted for this operating-system user.'); }
    },
    async write(value) {
      requireProtection(); const plain = Buffer.from(JSON.stringify(value), 'utf8');
      if (plain.length > MAX_PLAINTEXT) { plain.fill(0); throw youtubeError('YOUTUBE_VAULT_INVALID', 'Credential payload exceeds the storage limit.'); }
      let envelope;
      try {
        const key = await encryptionKey(); const nonce = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(associatedData);
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
        envelope = { version: 2, protection: information.mechanism, wrappedKey: cachedWrappedKey, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') };
      } finally { plain.fill(0); }
      const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try { await fs.writeFile(temporary, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, filePath); }
      finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
    async clear() { requireProtection(); forgetKey(); await fs.unlink(filePath).catch(error => { if (error.code !== 'ENOENT') throw error; }); },
    close() { forgetKey(); }
  };
}
