# 🤖 Airoza Automation Engine

The Airoza Automation Engine is a background service that allows you to schedule recurring actions for your Instagram Accounts (Nodes). It is designed to mimic human behavior to minimize the risk of bans.

## ⚙️ How it Works

The engine runs on two core principles:
1.  **Intervals**: Actions are performed at a set frequency (e.g., every 10 minutes).
2.  **Targets**: You provide a list of target usernames. The engine randomly selects one target from your list for each cycle.

## 🛠 Supported Task Types

### 1. Auto-Like Targets (`AUTO_LIKE_TARGETS`)
*   **Action**: The bot visits the target's profile, identifies the most recent post that it hasn't liked yet, and likes it.
*   **Stealth**: If the target has no new posts or is private, the cycle is skipped without triggering a suspicious error.

### 2. Auto-Follow Targets (`AUTO_FOLLOW_TARGETS`)
*   **Action**: The bot searches for the target's user ID and sends a follow request.
*   **Stealth**: If the target is already followed, it skips the action.

---

## 🚦 Task Lifecycle

### Starting a Task
Send a request to `/auto/start`. The engine will:
1.  Initialize the task in memory.
2.  Perform an immediate first cycle.
3.  Schedule subsequent cycles using the specified interval.
4.  Persist the task state to the database so it survives server restarts.

### Running a Cycle
Each cycle involves:
1.  **Session Check**: Ensuring the bot's Instagram session is still valid.
2.  **Auto-Recovery**: If the session has expired, the engine attempts an automatic silent login using saved credentials.
3.  **Action Execution**: Performing the Like or Follow.
4.  **Logging**: Recording the success or failure in the `actions_log` collection.

### Stopping a Task
Send a request to `/auto/stop`. This clears the timer and removes the persistence record.

---

## 🛡 Stealth Features

*   **Randomized Target Selection**: Prevents predictable patterns.
*   **Global Pulse**: Monitoring loops ensure bots don't perform too many actions across multiple tasks simultaneously.
*   **Rate Limit Handling**: If a `feedback_required` or `429` error is received, the task automatically enters a "Cooling Down" state to protect the account.
