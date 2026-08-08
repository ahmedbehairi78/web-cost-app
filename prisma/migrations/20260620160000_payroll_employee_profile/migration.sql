-- Employee profile: birth date, prior insurance period, contact + WhatsApp opt-in
ALTER TABLE "payroll_employees" ADD COLUMN "birth_date" TEXT;
ALTER TABLE "payroll_employees" ADD COLUMN "prior_insurance_months" INTEGER;
ALTER TABLE "payroll_employees" ADD COLUMN "phone_e164" TEXT;
ALTER TABLE "payroll_employees" ADD COLUMN "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false;
