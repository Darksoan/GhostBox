# GhostBox Feedback Worker

Encaminha feedbacks do app para um canal privado do Discord usando webhook, sem salvar em banco.

## Configuracao

1. Crie um webhook no canal privado do Discord.
2. Configure o secret:

```bash
wrangler secret put DISCORD_WEBHOOK_URL
```

3. Publique o Worker:

```bash
wrangler deploy
```

4. Configure o app com a URL final do endpoint:

```env
VITE_GHOSTBOX_FEEDBACK_API_URL=https://ghostbox-feedback.hella.workers.dev/feedback
```

O app nunca deve chamar a URL do webhook diretamente.
