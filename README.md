# saran-ops — Saran Chess Academy Multi-Agent Orchestrator

Railway service that runs the **5 specialized agents** as deterministic webhooks.

| Agent | Endpoint |
|-------|----------|
| Lead Qual | `POST /webhook/lead` |
| Voice Sales | `POST /webhook/voice` |
| Demo / Coach | `POST /webhook/coach` |
| Payment / Cohort | `POST /webhook/payment` |
| Renewal | `POST /webhook/renewal` |
| Ad Ops | `POST /webhook/ads` |
| Generic | `POST /orchestrate` + `event_type` |

Website connect later: point form `action` / fetch to  
`https://<this-service>.up.railway.app/webhook/lead`

## Deploy on Railway

1. New Project → Deploy from GitHub → repo `saran-ops`
2. (Optional) Add **PostgreSQL** plugin → `DATABASE_URL` auto-set
3. Variables (minimum):
   - `WEBHOOK_SECRET` = random string
4. After deploy with Postgres: one-off `npm run migrate` (Railway shell) or hit once via release command
5. Test:
```bash
curl -X POST https://YOUR_URL/webhook/lead \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_SECRET" \
  -d '{"parent_name":"Alex","student_name":"Sam","phone":"+12025550123","child_age":9}'
```

Without API keys, WhatsApp/Vapi **stub-log** only — orchestration JSON still works.

## Calling rules (built-in)
- Window: **10:00–19:30** prospect local time
- Outside → queue for **10:30** local next window
- DID: +1 / +44 / +61 by geo
- Group cohort hard cap: **5**

## Website (later)
When ready, on `saranchessacademy.com` form submit:
```js
fetch('https://OPS_URL/webhook/lead', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': 'YOUR_SECRET'
  },
  body: JSON.stringify({ ...formFields })
})
```

## Pricing bands (orchestrator)
- Group: $60–80/mo · max 5
- 1-on-1: $120–150/mo
- FIDE: $160–200/mo
- Magnet: Free 30-min demo
