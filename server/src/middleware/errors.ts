import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { PeriodLockedError } from '../accounting/periodLock.js';
import { IncomeCloseRequiredError } from '../accounting/fiscalPeriodClosingService.js';
import { FactoryResetError } from '../lib/factoryReset.js';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

function friendlySqliteMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = String((error as { code: string }).code);
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return 'المشروع أو الصنف غير مسجّل في قاعدة البيانات المحلية. تأكد من مزامنة المشروعين في الإعدادات ثم أعد المحاولة.';
  }
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return 'قيمة مكررة (مثل كود المشروع). راجع بيانات المشروع في الإعدادات.';
  }
  return null;
}

/** Maps known Prisma errors to an HTTP status + Arabic-friendly message. */
function prismaError(error: unknown): { status: number; message: string } | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return { status: 409, message: 'قيمة مكررة (مثل كود المشروع أو الحساب). راجع البيانات وأعد المحاولة.' };
      case 'P2003':
        return {
          status: 400,
          message:
            'سجلّ مرتبط غير موجود (مشروع/عقد/صنف). تأكد من إنشاء السجلّ المرتبط أولاً ثم أعد المحاولة.',
        };
      case 'P2025':
        return { status: 404, message: 'السجلّ غير موجود.' };
      case 'P1001':
        return {
          status: 503,
          message:
            'تعذّر الاتصال بقاعدة البيانات. تأكد أن PostgreSQL يعمل على localhost:5432 ثم أعد تشغيل npm run dev:local.',
        };
      case 'P2028':
        return {
          status: 503,
          message: 'العملية استغرقت وقتاً طويلاً. أعد المحاولة أو قسّم ملف الاستيراد.',
        };
      default:
        return { status: 400, message: error.message };
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, message: 'بيانات الطلب غير صالحة.' };
  }
  return null;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(error);

  if (error instanceof PeriodLockedError) {
    res.status(error.statusCode).json({ error: error.message, label: error.label });
    return;
  }

  if (error instanceof IncomeCloseRequiredError) {
    res.status(error.statusCode).json({
      error: error.message,
      periodEnd: error.periodEnd,
      openAccountCount: error.openAccountCount,
      sampleCodes: error.sampleCodes,
    });
    return;
  }

  if (error instanceof FactoryResetError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  const prisma = prismaError(error);
  if (prisma) {
    res.status(prisma.status).json({ error: prisma.message });
    return;
  }

  const message =
    friendlySqliteMessage(error) ??
    (error instanceof Error ? error.message : String(error));
  res.status(500).json({ error: message });
}
