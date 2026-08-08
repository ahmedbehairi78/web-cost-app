import { createHash, randomBytes } from 'node:crypto';
import { env } from '../env.js';

export function hashApprovalToken(plain: string): string {
  return createHash('sha256').update(`${plain}:${env.notificationLinkSecret}`).digest('hex');
}

export function generateApprovalTokenPlain(): string {
  return randomBytes(24).toString('base64url');
}

export function approvalLinkUrl(plainToken: string): string {
  return `${env.appPublicBaseUrl}/m/approve?t=${encodeURIComponent(plainToken)}`;
}

export function approvalLinkExpiresAt(): Date {
  const ms = env.notificationLinkTtlHours * 3_600_000;
  return new Date(Date.now() + ms);
}
