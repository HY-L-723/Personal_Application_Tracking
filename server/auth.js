import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString('hex');
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
    throw new Error('密码长度应为 10–256 个字符。');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [algorithm, salt, hash] = encoded.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const actual = await derive(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
