import { sessionManager } from './session';
import { InstagramClient } from './Library/Instagram';
import axios from 'axios';
import { logAction, saveAutomationTask, deleteAutomationTask, updateAccountState, getAccount } from './database';

type TaskType = 'AUTO_LIKE_TARGETS' | 'AUTO_FOLLOW_TARGETS' | 'POLL_WEBHOOK';

interface AutomationTask {
    botUsername: string;
    type: TaskType;
    targets: string[]; // Required (empty array if unused)
    webhookUrl?: string | undefined; // New field
    intervalMs: number;
    timer?: NodeJS.Timeout;
    isRunning: boolean;
    lastCheckedAt?: number; // timestamp
}

export class AutomationService {
    private tasks: Map<string, AutomationTask> = new Map();

    constructor() { }

    /**
     * Start an automation task for a bot
     */
    startTask(botUsername: string, type: TaskType, targets?: string[], intervalMinutes: number = 5, webhookUrl?: string) {
        if (this.tasks.has(botUsername)) {
            this.stopTask(botUsername);
        }

        const task: AutomationTask = {
            botUsername,
            type,
            targets: targets || [],
            webhookUrl: webhookUrl,
            intervalMs: intervalMinutes * 60 * 1000,
            isRunning: true,
            lastCheckedAt: Date.now()
        };

        console.log(`[AUTO] Starting ${type} for ${botUsername}. Interval: ${intervalMinutes}m`);

        // Run immediately once
        this.runCycle(task);

        // Schedule
        task.timer = setInterval(() => {
            this.runCycle(task);
        }, task.intervalMs);

        this.tasks.set(botUsername, task);

        // Persist to DB
        saveAutomationTask({
            botUsername,
            type,
            targets: task.targets,
            intervalMs: task.intervalMs,
            isRunning: true,
            webhookUrl: task.webhookUrl
        });

        return true;
    }

    stopTask(botUsername: string) {
        const task = this.tasks.get(botUsername);
        if (task) {
            if (task.timer) clearInterval(task.timer);
            task.isRunning = false;
            this.tasks.delete(botUsername);
            deleteAutomationTask(botUsername);
            console.log(`[AUTO] Stopped and deleted task for ${botUsername}`);
            return true;
        }
        return false;
    }

    getTaskStatus(botUsername: string) {
        return this.tasks.get(botUsername);
    }

    getAllTasks() {
        return Array.from(this.tasks.values()).map(t => ({
            botUsername: t.botUsername,
            type: t.type,
            targets: t.targets,
            isRunning: t.isRunning,
            lastCheckedAt: t.lastCheckedAt
        }));
    }

    private async runCycle(task: AutomationTask) {
        const bot = sessionManager.getSession(task.botUsername);
        if (!bot) {
            console.error(`[AUTO] Bot ${task.botUsername} session lost. Stopping task.`);
            this.stopTask(task.botUsername);
            return;
        }

        // --- POLL WEBHOOK LOGIC ---
        if (task.type === 'POLL_WEBHOOK' && task.webhookUrl) {
            console.log(`[AUTO-POLL] Checking activity/inbox for ${task.botUsername}...`);
            try {
                // 1. Fetch Activity (Notif)
                const activity: any = await bot.getActivityFeed();

                // Construct Payload
                const payload = {
                    bot_username: task.botUsername,
                    timestamp: Date.now(),
                    activity_feed: activity
                };

                console.log(`[AUTO-POLL] Sending data to webhook: ${task.webhookUrl}`);
                await axios.post(task.webhookUrl, payload);
                console.log(`[AUTO-POLL] Webhook sent successfully.`);

            } catch (e: any) {
                console.error(`[AUTO-POLL] Error: ${e.message}`);
                // Don't stop task, try again next cycle
            }
            return;
        }

        // --- INTERACTION LOGIC (LIKE/FOLLOW) ---
        if (!task.targets || task.targets.length === 0) return;
        const target = task.targets[Math.floor(Math.random() * task.targets.length)];
        if (!target) return;

        const perform = async (isRetry = false): Promise<any> => {
            try {
                const currentTarget = target as string;
                console.log(`[AUTO] ${task.botUsername} processing ${currentTarget} (${task.type})...`);
                if (task.type === 'AUTO_LIKE_TARGETS') {
                    const user = await bot.getUserMedia(currentTarget);
                    if (!user) {
                        console.log(`[AUTO-LIKE] Target ${currentTarget} not found.`);
                        return;
                    }

                    const edgeMedia = user.edge_owner_to_timeline_media || user.edge_owner_to_timeline_media_connection;
                    const edges = edgeMedia?.edges || [];

                    if (edges.length === 0) {
                        const reason = user.is_private ? 'Private Account' : (user.media_count === 0 ? 'No Posts' : 'Access Restricted/Hidden');
                        console.log(`[AUTO-LIKE] ${target} has no accessible media. Reason: ${reason}`);
                        return;
                    }

                    // Find first media NOT liked yet
                    let targetMedia = null;
                    for (const edge of edges) {
                        if (!edge.node.viewer_has_liked) {
                            targetMedia = edge.node;
                            break;
                        }
                    }

                    if (targetMedia) {
                        const success = await bot.likeMedia(targetMedia.id);
                        if (success) {
                            console.log(`[AUTO-LIKE] ${task.botUsername} LIKED ${target} post ${targetMedia.id}`);
                            await logAction(task.botUsername, 'AUTO_LIKE', { target, mediaId: targetMedia.id }, 'SUCCESS');
                        }
                    } else {
                        console.log(`[AUTO-LIKE] All recent posts of ${target} are already liked by ${task.botUsername}.`);
                    }
                } else if (task.type === 'AUTO_FOLLOW_TARGETS') {
                    const user = await bot.getUserMedia(currentTarget);
                    const userId = user?.id || user?.pk;
                    if (userId) {
                        const success = await bot.followUser(userId);
                        if (success) {
                            console.log(`[AUTO-FOLLOW] ${task.botUsername} FOLLOWED ${currentTarget}`);
                            await logAction(task.botUsername, 'AUTO_FOLLOW', { target: currentTarget }, 'SUCCESS');
                        }
                    } else {
                        console.log(`[AUTO-FOLLOW] ${currentTarget} profile ID not found.`);
                    }
                }
            } catch (e: any) {
                const needsLogin = e.message === 'IG_SESSION_EXPIRED' ||
                    e.message.toLowerCase().includes('login_required') ||
                    e.message.toLowerCase().includes('require_login');

                if (!isRetry && needsLogin) {
                    console.log(`[AUTO] Session expired for ${task.botUsername}, attempting auto-login...`);
                    const acc = await getAccount(task.botUsername);
                    if (acc && acc.password) {
                        const loginRes = await bot.login(task.botUsername, acc.password);
                        if (loginRes.authenticated) {
                            console.log(`[AUTO] Auto-login success for ${task.botUsername}, retrying action...`);
                            return await perform(true);
                        }
                    }
                }
                throw e;
            }
        };

        try {
            await perform();
        } catch (e: any) {
            const msg = e.message;
            console.error(`[AUTO] Error in cycle for ${task.botUsername}:`, msg);

            if (msg === 'IG_SUSPENDED' || msg.startsWith('IG_CHECKPOINT') || msg === 'IG_SESSION_EXPIRED') {
                const note = msg === 'IG_SUSPENDED' ? 'SUSPENDED' : (msg.startsWith('IG_CHECKPOINT') ? 'CHECKPOINT' : 'EXPIRED');
                await updateAccountState(task.botUsername, {
                    status_note: note,
                    last_error: `Automation stopped: ${msg}`
                });
                this.stopTask(task.botUsername);
            }
        }
    }
}

export const automationService = new AutomationService();
