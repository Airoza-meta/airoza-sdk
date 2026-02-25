# 📡 Airoza Webhooks

Airoza supports real-time notifications via outbound webhooks. This allows your external applications to react instantly to events happening on any Instagram Node.

## 🔗 Setup
To receive webhooks, you must provide a `webhook` URL when adding or updating an Instagram account:

```bash
curl -X POST http://localhost:3000/accounts \
  -d '{ "username": "...", "webhook": "https://your-api.com/callback" }'
```

---

## 📅 Event Types

### 1. `OUTGOING_ACTION`
Sent immediately after a bot performs an action (Like, Follow, Comment, Post).

**Payload Structure:**
```json
{
  "airoza_bot": "bot_username",
  "timestamp": 1700000000,
  "event": "OUTGOING_ACTION",
  "type": "FOLLOW",
  "target": "target_username",
  "status": "SUCCESS"
}
```

### 2. `POLL_ACTIVITY` (Notification Stream)
Airoza pulse-checks accounts (every 60s by default) for new incoming notifications (likes, followers, mentions) and pushes them to your webhook.

**Payload Structure:**
```json
{
  "airoza_bot": "bot_username",
  "event": "POLL_ACTIVITY",
  "activity_type": "INCOMING_NOTIFICATIONS",
  "account_summary": {
    "followers": 1200,
    "following": 350,
    "posts": 42
  },
  "new_interactions": [
    {
      "event_type": "like",
      "description": "username liked your photo",
      "user": "source_user",
      "event_time": "2024-03-20T10:00:00Z",
      "post_info": {
        "url": "https://instagram.com/p/...",
        "current_total_likes": 150
      }
    }
  ],
  "unread_inbox_counts": {
    "direct_messages": 2
  }
}
```

---

## 🛡 Security & Best Practices
*   **User-Agent**: Webhook requests from Airoza include the header `'User-Agent': 'Airoza-Webhook/1.0'`.
*   **Timeout**: Airoza expects your endpoint to respond within 10 seconds. If it fails, Airoza will log a warning but will not retry the notification.
*   **Deduplication**: Airoza includes a memory cache to ensure that the same notification story is not pushed multiple times during polling cycles.
