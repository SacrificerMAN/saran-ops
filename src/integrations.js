/**
 * Messaging integrations
 * Priority: Telegram (if TELEGRAM_BOT_TOKEN) → WhatsApp (if keys) → stub log
 */

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !text) {
    return { ok: false, stub: true, channel: "telegram" };
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4000),
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, data, channel: "telegram" };
}

async function sendWhatsApp(to, body) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId || !to) {
    return { ok: false, stub: true, channel: "whatsapp" };
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to).replace(/\D/g, ""),
      type: "text",
      text: { body },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data, channel: "whatsapp" };
}

async function sendMessage({ phone, telegramChatId, text, alsoAdmin = true }) {
  const results = [];
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const hasTg = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const hasWa = Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

  if (hasTg && telegramChatId) {
    results.push(await sendTelegram(telegramChatId, text));
  }
  if (hasTg && alsoAdmin && adminId) {
    const adminText =
      telegramChatId && String(telegramChatId) === String(adminId)
        ? text
        : `Ops alert\n\n${text}`;
    results.push(await sendTelegram(adminId, adminText));
  }
  if (hasWa && phone) {
    results.push(await sendWhatsApp(phone, text));
  }

  if (!results.length) {
    console.log("[MSG STUB]", phone || telegramChatId || "no-recipient", String(text).slice(0, 120));
    return { ok: false, stub: true, results };
  }
  return { ok: results.some((r) => r.ok), results };
}

function messagingStatus() {
  if (process.env.TELEGRAM_BOT_TOKEN) return "telegram";
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) return "whatsapp";
  return "none";
}

function telegramConfig() {
  return {
    bot_token_set: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    admin_chat_id_set: Boolean(process.env.TELEGRAM_ADMIN_CHAT_ID),
    admin_chat_id_preview: process.env.TELEGRAM_ADMIN_CHAT_ID
      ? String(process.env.TELEGRAM_ADMIN_CHAT_ID).slice(0, 3) + "…"
      : null,
  };
}

async function triggerVapiCall({ phone, did, leadId, studentName, parentName }) {
  const key = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  if (!key || !assistantId) {
    console.log("[Vapi STUB] call", phone, "did", did, "lead", leadId);
    return { ok: false, stub: true };
  }
  const res = await fetch("https://api.vapi.ai/call/phone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId,
      customer: { number: phone, name: parentName || studentName },
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || undefined,
      metadata: { lead_id: leadId, student_name: studentName },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

module.exports = {
  sendTelegram,
  sendWhatsApp,
  sendMessage,
  messagingStatus,
  telegramConfig,
  triggerVapiCall,
};
