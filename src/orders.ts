import { SessionManager } from './session';
import { updateOrder, getPendingOrders, getAllAccounts, updateUserCredits, getAccount, updateAccountState } from './database';
import { InstagramClient } from './Library/Instagram';

export class OrderManager {
    private sessionManager: SessionManager;
    private isPolling: boolean = false;
    private activeWorkshops: number = 0;
    private activeOrderIds: Set<string> = new Set();
    private readonly MAX_CONCURRENT_ORDERS = 3; // How many orders to process at once
    private readonly BOT_DELAY_MS = 2000;       // Delay between each bot's action in an order

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Start the order processing loop
     */
    startPolling(intervalMs: number = 30000) {
        console.log(`[ORDERS] Starting order polling every ${intervalMs / 1000}s. Concurrency: ${this.MAX_CONCURRENT_ORDERS}`);
        setInterval(() => this.processOrders(), intervalMs);
        // Also run immediately
        this.processOrders();
    }

    async processOrders() {
        if (this.isPolling) return;
        this.isPolling = true;

        try {
            // Check if we have capacity in the queue
            if (this.activeWorkshops >= this.MAX_CONCURRENT_ORDERS) {
                return;
            }

            const pending = await getPendingOrders();
            if (pending.length === 0) return;

            for (const orderData of pending) {
                if (this.activeWorkshops >= this.MAX_CONCURRENT_ORDERS) break;

                const order = orderData as any;

                // CRITICAL: Prevent processing the SAME order multi-times if it's already in flight
                if (this.activeOrderIds.has(order.id)) continue;

                // Mark as processing immediately in memory to avoid double pick-up
                this.activeWorkshops++;
                this.activeOrderIds.add(order.id);

                // Process in background (async)
                this.runOrderTask(order).finally(() => {
                    this.activeWorkshops--;
                    this.activeOrderIds.delete(order.id);
                });
            }
        } catch (e: any) {
            console.error('[ORDERS] Critical failure in processOrders:', e.message);
        } finally {
            this.isPolling = false;
        }
    }

    private async runOrderTask(order: any) {
        try {
            await this.handleOrder(order);
        } catch (e: any) {
            console.error(`[ORDERS] Error processing order ${order.id}:`, e.message);
            await updateOrder(order.id, {
                status: 'FAILED',
                error_log: e.message,
                updated_at: new Date()
            });

            // Refund logic: If order failed completely, refund everything.
            if (order.user_id && order.cost) {
                console.log(`[ORDERS] Refunding ${order.cost} credits to ${order.user_id} due to failure.`);
                await updateUserCredits(order.user_id, order.cost);
            }
        }
    }

    private async handleOrder(order: any) {
        console.log(`[ORDERS] [QUEUE-START] Order ${order.id} (${order.type}) for ${order.target}. Targets: ${order.quantity}`);

        if (order.status === 'PENDING') {
            await updateOrder(order.id, { status: 'PROCESSING', updated_at: new Date() });
        }

        // Step 1: Resolve Target and Get Initial Counts (ONLY IF NOT ALREADY RESOLVED)
        let startCount = order.start_count;
        let targetId = order.target_id;
        let targetEndCount = order.target_end_count;

        const accounts = await getAllAccounts() as any[];
        // Filter: Must be marked as active and NOT in a restricted status
        const activeAccounts = accounts.filter(a => {
            const status = (a.status || '').toUpperCase();
            const isRestricted = ['SUSPENDED', 'CHECKPOINT', 'EXPIRED', 'DISABLED', 'BANNED'].includes(status);
            // We use !!a.is_active to handle cases where it might be undefined or 1/0
            return !!a.is_active && !isRestricted;
        });

        if (activeAccounts.length === 0) {
            console.warn(`[ORDERS] Filtering Breakdown: Total: ${accounts.length}, Active Flags: ${accounts.filter(a => a.is_active).length}`);
            throw new Error(`No active bot accounts available (Active & Not Restricted). Total accounts in DB: ${accounts.length}`);
        }

        let resolved = (startCount !== undefined && startCount !== null && !!targetId);
        let resolutionError = '';

        if (!resolved) {
            console.log(`[ORDERS] Resolving target info for the first time...`);
            resolved = false;
            resolutionError = '';
            let targetData: any = null;
            const candidateBots = activeAccounts.sort(() => 0.5 - Math.random()).slice(0, 3);

            for (const infoBotData of candidateBots) {
                try {
                    const infoClient = await this.sessionManager.getSession(infoBotData.username, infoBotData.proxy);

                    if (order.type === 'LIKE' || order.type === 'COMMENT') {
                        targetId = await infoClient.getMediaIdFromUrl(order.target);
                        if (!targetId) {
                            resolutionError = `Could not resolve media ID for URL: ${order.target}`;
                            continue;
                        }

                        const details = await infoClient.getMediaDetail(targetId);
                        if (details) {
                            const count = order.type === 'LIKE' ? details.like_count : details.comment_count;
                            if (count !== undefined && count !== null) {
                                startCount = count;
                                targetData = details;
                                resolved = true;
                                break;
                            } else {
                                resolutionError = `Resolved media but ${order.type.toLowerCase()} count is missing.`;
                            }
                        }
                    } else if (order.type === 'FOLLOW') {
                        const username = (order.target || '').replace('@', '').split('/').filter(Boolean).pop();
                        const user = await infoClient.getUserMedia(username || '');
                        if (user) {
                            const count = user.edge_followed_by?.count ?? user.follower_count ?? user.followerCount;
                            if (count !== undefined && count !== null) {
                                targetId = user.id || user.pk;
                                startCount = count;
                                targetData = user;
                                resolved = true;
                                break;
                            } else {
                                resolutionError = `Resolved user @${username} but follower count is missing.`;
                            }
                        } else {
                            resolutionError = `Could not find profile for: ${username}`;
                        }
                    }
                } catch (e: any) {
                    const errMsg = e.message || '';
                    resolutionError = errMsg;
                    console.warn(`[ORDERS] Resolution attempt with ${infoBotData.username} failed: ${errMsg}`);

                    // --- UPDATE ACCOUNT STATUS IF CRITICAL ERROR ---
                    if (errMsg === 'IG_SUSPENDED') {
                        await updateAccountState(infoBotData.username, { is_active: false, status_note: 'SUSPENDED', last_error: 'Suspended during target resolution' });
                    } else if (errMsg.startsWith('IG_CHECKPOINT')) {
                        const checkpointUrl = errMsg.replace('IG_CHECKPOINT:', '');
                        await updateAccountState(infoBotData.username, { is_active: false, status_note: 'CHECKPOINT', last_error: 'Checkpoint during target resolution', checkpoint_url: checkpointUrl });
                    } else if (errMsg === 'IG_SESSION_EXPIRED') {
                        await updateAccountState(infoBotData.username, { status_note: 'EXPIRED', last_error: 'Session expired during target resolution' });
                    } else if (errMsg.startsWith('IG_LIMIT_EXCEEDED')) {
                        await updateAccountState(infoBotData.username, { status_note: 'Cooling Down...', last_error: errMsg.replace('IG_LIMIT_EXCEEDED:', '') });
                    }
                }
            }

            if (!resolved) {
                throw new Error(`Target Resolution Failed: ${resolutionError || 'Unknown Error'}`);
            }

            // Step 1.5: Private Account Logic
            const isPrivate = targetData?.is_private || targetData?.user?.is_private;

            if (isPrivate) {
                if (order.type === 'LIKE' || order.type === 'COMMENT') {
                    throw new Error(`ORDER CANCELLED: Target account ${order.target} is PRIVATE. Bots cannot like/comment on private accounts.`);
                } else if (order.type === 'FOLLOW') {
                    console.log(`[ORDERS] [WARNING] Target ${order.target} is PRIVATE. Follow requests will be sent, but follower count will ONLY increase after the owner accepts the requests.`);
                    // We allow FOLLOW but warn that progress tracking will look stuck
                }
            }

            targetEndCount = startCount + order.quantity;

            await updateOrder(order.id, {
                start_count: startCount,
                target_id: targetId,
                target_end_count: targetEndCount,
                current_count: startCount
            });
        } else {
            console.log(`[ORDERS] Resuming order. Start Count fixed at: ${startCount}`);
        }

        // Step 2: Select Bots for execution
        const botPool = activeAccounts.sort(() => 0.5 - Math.random());
        const alreadyWorkedFull = (order.execution_log || []).map((l: any) => l.username);
        const alreadyWorkedSuccess = (order.execution_log || [])
            .filter((l: any) => l.status === 'SUCCESS')
            .map((l: any) => l.username);

        let successCount = alreadyWorkedSuccess.length;
        const availablePool = botPool.filter(b => !alreadyWorkedFull.includes(b.username));

        console.log(`[ORDERS] Order ${order.id}: Aiming for ${order.quantity} successes. Progress: ${successCount}/${order.quantity}. Pool: ${availablePool.length} new bots.`);

        let botIndex = 0;
        const results: any[] = order.execution_log || [];

        while (successCount < order.quantity && botIndex < availablePool.length) {
            const botData = availablePool[botIndex];
            botIndex++;

            try {
                const client = await this.sessionManager.getSession(botData.username, botData.proxy);

                const perform = async (isRetry = false): Promise<boolean> => {
                    try {
                        if (order.type === 'LIKE') {
                            return await client.likeMedia(targetId, order.target);
                        }
                        if (order.type === 'FOLLOW') {
                            const username = (order.target || '').replace('@', '').split('/').filter(Boolean).pop();
                            return await client.followUser(targetId, username);
                        }
                        if (order.type === 'COMMENT') {
                            const commentLines = Array.isArray(order.comments) ? order.comments : (order.comments || "Great!").split('\n').filter((l: string) => l.trim());
                            const comment = commentLines[successCount % commentLines.length] || "Nice!";
                            return await client.commentMedia(targetId, comment, order.target);
                        }
                        return false;
                    } catch (e: any) {
                        const needsLogin = e.message === 'IG_SESSION_EXPIRED' ||
                            e.message.toLowerCase().includes('login_required') ||
                            e.message.toLowerCase().includes('require_login');

                        if (!isRetry && needsLogin) {
                            console.log(`[ORDERS] Session expired for ${botData.username}, attempting auto-login...`);
                            const acc = await getAccount(botData.username);
                            if (acc && acc.password) {
                                const loginRes = await client.login(botData.username, acc.password);
                                if (loginRes.authenticated) return await perform(true);
                            }
                        }
                        throw e;
                    }
                };

                const success = await perform();
                if (success) {
                    successCount++;
                    results.push({ username: botData.username, status: 'SUCCESS', timestamp: new Date().toISOString() });

                    await updateOrder(order.id, {
                        current_count: startCount + successCount,
                        actual_quantity: successCount,
                        execution_log: results
                    });

                    if (successCount < order.quantity) {
                        await this.sleep(this.BOT_DELAY_MS);
                    }
                } else {
                    results.push({ username: botData.username, status: 'FAILED', timestamp: new Date().toISOString() });
                    await updateOrder(order.id, { execution_log: results });
                }
            } catch (e: any) {
                const errMsg = e.message || '';
                console.warn(`[ORDERS] Bot ${botData.username} error for order ${order.id}: ${errMsg}`);

                // --- UPDATE ACCOUNT STATUS BASED ON ERROR ---
                if (errMsg === 'IG_SUSPENDED') {
                    console.log(`[ORDERS] Marking ${botData.username} as SUSPENDED in DB.`);
                    await updateAccountState(botData.username, { is_active: false, status_note: 'SUSPENDED', last_error: 'Account Suspended' });
                } else if (errMsg.startsWith('IG_CHECKPOINT')) {
                    const checkpointUrl = errMsg.replace('IG_CHECKPOINT:', '');
                    console.log(`[ORDERS] Marking ${botData.username} as CHECKPOINT in DB.`);
                    await updateAccountState(botData.username, { is_active: false, status_note: 'CHECKPOINT', last_error: 'Security Checkpoint Required', checkpoint_url: checkpointUrl });
                } else if (errMsg === 'IG_SESSION_EXPIRED') {
                    console.log(`[ORDERS] Marking ${botData.username} as EXPIRED in DB.`);
                    await updateAccountState(botData.username, { status_note: 'EXPIRED', last_error: 'Session Expired' });
                } else if (errMsg.startsWith('IG_LIMIT_EXCEEDED')) {
                    console.log(`[ORDERS] Marking ${botData.username} as RATE LIMITED in DB.`);
                    await updateAccountState(botData.username, { status_note: 'Cooling Down...', last_error: errMsg.replace('IG_LIMIT_EXCEEDED:', '') });
                }

                results.push({ username: botData.username, status: 'ERROR', error: errMsg, timestamp: new Date().toISOString() });
                await updateOrder(order.id, { execution_log: results });
            }
        }

        const finalStatus = successCount >= order.quantity ? 'COMPLETED' : 'PARTIAL';
        await updateOrder(order.id, {
            status: finalStatus,
            current_count: startCount + successCount,
            actual_quantity: successCount,
            execution_log: results,
            updated_at: new Date()
        });

        if (finalStatus === 'PARTIAL' && order.user_id && order.cost_per_item) {
            const failed = order.quantity - successCount;
            const refundAmount = failed * order.cost_per_item;
            if (refundAmount > 0) {
                await updateUserCredits(order.user_id, refundAmount);
            }
        }

        console.log(`[ORDERS] [QUEUE-FINISH] Order ${order.id} complete. Status: ${finalStatus} (${successCount}/${order.quantity})`);
    }
}
