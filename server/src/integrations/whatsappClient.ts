import { env } from '../env.js';

export type WhatsAppSendResult = {
  ok: boolean;
  messageId?: string;
  dryRun?: boolean;
  redirectedTo?: string;
  error?: string;
};

type TemplateParams = {
  toE164: string;
  templateName: string;
  languageCode: string;
  bodyParams: string[];
  urlButtonPath?: string;
};

function resolveDestination(toE164: string): { to: string; redirected: boolean } {
  const redirect = env.whatsappRedirectAllTo.trim();
  if (redirect && redirect !== toE164) {
    return { to: redirect, redirected: true };
  }
  return { to: toE164, redirected: false };
}

export async function sendWhatsAppTemplate(params: TemplateParams): Promise<WhatsAppSendResult> {
  if (!env.whatsappEnabled) {
    return { ok: false, error: 'whatsapp_disabled' };
  }

  const { to, redirected } = resolveDestination(params.toE164);
  const useDryRun = env.whatsappDryRun || !env.whatsappAccessToken || !env.whatsappPhoneNumberId;

  const logPayload = {
    to,
    intended: params.toE164,
    redirected,
    template: params.templateName,
    lang: params.languageCode,
    body: params.bodyParams,
    urlPath: params.urlButtonPath,
  };

  if (useDryRun) {
    console.info('[whatsapp:dry-run]', JSON.stringify(logPayload));
    return {
      ok: true,
      dryRun: true,
      messageId: `dry-run-${Date.now()}`,
      redirectedTo: redirected ? to : undefined,
    };
  }

  const url = `https://graph.facebook.com/${env.whatsappApiVersion}/${env.whatsappPhoneNumberId}/messages`;
  const components: Record<string, unknown>[] = [
    {
      type: 'body',
      parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
    },
  ];
  if (params.urlButtonPath) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: params.urlButtonPath }],
    });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: params.languageCode },
          components,
        },
      }),
    });

    const data = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };

    if (!res.ok) {
      console.error('[whatsapp] send failed', data);
      return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
    }

    const messageId = data.messages?.[0]?.id;
    console.info('[whatsapp] sent', { ...logPayload, messageId });
    return {
      ok: true,
      messageId,
      redirectedTo: redirected ? to : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[whatsapp] error', msg);
    return { ok: false, error: msg };
  }
}
