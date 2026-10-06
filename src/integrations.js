/**
 * External integrations — no-op when API keys missing (safe for first deploy)
 */

async function sendWhatsApp(to, body) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId || !to) {
    console.log("[WhatsApp STUB]", to, body?.slice(0, 120));
    return { ok: false, stub: true };
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { body },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
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

module.exports = { sendWhatsApp, triggerVapiCall };
